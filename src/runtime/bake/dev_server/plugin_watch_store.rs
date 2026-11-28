use bun_paths::dirname_or_root;

use super::bundle::entry_point_list;
use super::*;

#[derive(Default)]
pub(crate) struct PluginWatchStore {
    pub(crate) modules: [StringArrayHashMap<Dependencies>; 3],
}

#[derive(Default)]
pub(crate) struct Dependencies {
    pub(crate) is_virtual: bool,
    pub(crate) entry_points: Vec<PluginEntryPoint>,
    pub(crate) files: Vec<WatchedFile>,
    pub(crate) dirs: Vec<WatchedDirectory>,
}

pub(crate) struct WatchedDirectory {
    pub(crate) path: Box<[u8]>,
    pub(crate) watching: Box<[u8]>,
}

pub(crate) struct WatchedFile {
    pub(crate) path: Box<[u8]>,
    pub(crate) recovery_dir: Option<Box<[u8]>>,
}

pub(crate) struct PluginEntryPoint {
    pub(crate) path: Box<[u8]>,
    flags: entry_point_list::Flags,
}

impl PluginWatchStore {
    fn graph_index(graph: bake::Graph) -> usize {
        match graph {
            bake::Graph::Client => 0,
            bake::Graph::Server => 1,
            bake::Graph::Ssr => 2,
        }
    }

    pub(crate) fn replace(
        &mut self,
        module: &[u8],
        graph: bake::Graph,
        mut dependencies: Dependencies,
    ) -> Option<Dependencies> {
        let modules = &mut self.modules[Self::graph_index(graph)];
        if let Some(previous) = modules.get_mut(module) {
            dependencies.entry_points = core::mem::take(&mut previous.entry_points);
        }
        if !dependencies.is_virtual && dependencies.files.is_empty() && dependencies.dirs.is_empty()
        {
            modules
                .fetch_swap_remove(module)
                .map(|previous| previous.value)
        } else {
            modules.insert(module, dependencies)
        }
    }

    pub(crate) fn track_entry_point(
        &mut self,
        module: &[u8],
        graph: bake::Graph,
        original_path: &[u8],
        is_html: bool,
    ) -> crate::Result<()> {
        let modules = &mut self.modules[Self::graph_index(graph)];
        let dependencies = modules.get_or_put(module)?.value_ptr;
        dependencies.is_virtual = true;
        let flags = if is_html {
            entry_point_list::Flags::CLIENT | entry_point_list::Flags::HTML
        } else {
            match graph {
                bake::Graph::Client => entry_point_list::Flags::CLIENT,
                bake::Graph::Server => entry_point_list::Flags::SERVER,
                bake::Graph::Ssr => entry_point_list::Flags::SSR,
            }
        };
        if let Some(entry) = dependencies
            .entry_points
            .iter_mut()
            .find(|entry| entry.path.as_ref() == original_path)
        {
            entry.flags |= flags;
        } else {
            dependencies.entry_points.push(PluginEntryPoint {
                path: Box::from(original_path),
                flags,
            });
        }
        Ok(())
    }

    pub(crate) fn commit_entry_point(
        &mut self,
        module: &[u8],
        graph: bake::Graph,
        original_path: Option<&[u8]>,
    ) {
        let modules = &mut self.modules[Self::graph_index(graph)];
        let entry_points = modules
            .get_mut(module)
            .map(|dependencies| core::mem::take(&mut dependencies.entry_points))
            .unwrap_or_default();
        if !entry_points.is_empty() || original_path.is_some() {
            for index in 0..modules.len() {
                if modules.keys()[index].as_ref() != module {
                    modules.values_mut()[index].entry_points.retain(|entry| {
                        original_path != Some(entry.path.as_ref())
                            && !entry_points
                                .iter()
                                .any(|current| current.path == entry.path)
                    });
                }
            }
        }
        if let Some(dependencies) = modules.get_mut(module) {
            dependencies.entry_points = entry_points;
        }
    }

    pub(crate) fn append_entry_points(
        &self,
        module: &[u8],
        side: bake::Side,
        is_css: bool,
        entry_points: &mut EntryPointList,
    ) -> crate::Result<()> {
        let graphs = match side {
            bake::Side::Client => &self.modules[..1],
            bake::Side::Server => &self.modules[1..],
        };
        for modules in graphs {
            if let Some(dependencies) = modules.get(module) {
                for entry in &dependencies.entry_points {
                    if is_css {
                        entry_points.append_css(&entry.path)?;
                    } else {
                        entry_points.append(&entry.path, entry.flags)?;
                    }
                }
            }
        }
        Ok(())
    }

    pub(crate) fn is_virtual(&self, module: &[u8], side: bake::Side) -> bool {
        match side {
            bake::Side::Client => self.modules[0]
                .get(module)
                .is_some_and(|dependencies| dependencies.is_virtual),
            bake::Side::Server => self.modules[1..].iter().any(|modules| {
                modules
                    .get(module)
                    .is_some_and(|dependencies| dependencies.is_virtual)
            }),
        }
    }

    pub(crate) fn has_directory(&self, path: &[u8]) -> bool {
        self.modules.iter().any(|modules| {
            modules.values().iter().any(|dependencies| {
                dependencies.dirs.iter().any(|directory| {
                    directory.watching.as_ref() == path
                        || (cfg!(any(target_os = "linux", target_os = "android"))
                            && dirname_or_root(&directory.path) == path)
                }) || dependencies.files.iter().any(|file| {
                    file.recovery_dir
                        .as_ref()
                        .is_some_and(|dir| dir.as_ref() == path)
                })
            })
        })
    }

    pub(crate) fn invalidate(
        &mut self,
        event: &mut HotReloadEvent,
        watcher: &Watcher,
        directory_watchers: &DirectoryWatchStore,
    ) -> Result<(), AllocError> {
        let mut modules = Vec::new();
        let mut released_directories = Vec::new();
        for graph in &mut self.modules {
            for index in 0..graph.len() {
                let dependencies = &mut graph.values_mut()[index];
                let mut changed = false;
                for directory in &mut dependencies.dirs {
                    let parent_event = cfg!(any(target_os = "linux", target_os = "android"))
                        && (event.files.contains_key(&directory.path)
                            || event
                                .dirs
                                .get(dirname_or_root(&directory.path))
                                .is_some_and(|op| op.contains(bun_watcher::Op::WATCH_INVALIDATED)));
                    if event.directory_entries_changed(&directory.watching) || parent_event {
                        if let Some(watching) = watch_plugin_directory(watcher, &directory.path) {
                            changed |= directory.path == directory.watching
                                || watching != directory.watching;
                            if watching != directory.watching {
                                released_directories
                                    .push(core::mem::replace(&mut directory.watching, watching));
                            }
                        }
                    }
                }
                for file in &mut dependencies.files {
                    let file_changed = event.files.contains_key(&file.path);
                    let recover = file
                        .recovery_dir
                        .as_ref()
                        .is_some_and(|directory| event.directory_entries_changed(directory));
                    if file_changed || recover {
                        if watcher.add_file_by_path_slow(&file.path) {
                            released_directories.extend(file.recovery_dir.take());
                            changed = true;
                        } else {
                            let parent = dirname_or_root(&file.path);
                            let recovery_dir = watch_plugin_directory(watcher, parent);
                            if recovery_dir != file.recovery_dir {
                                released_directories.extend(core::mem::replace(
                                    &mut file.recovery_dir,
                                    recovery_dir,
                                ));
                            }
                            changed |= file_changed;
                        }
                    }
                }
                if changed {
                    modules.push(graph.keys()[index].clone());
                }
            }
        }
        for module in modules {
            event.files.put(&module, ())?;
        }
        for directory in released_directories {
            self.release_directory(&directory, watcher, directory_watchers);
        }
        Ok(())
    }

    fn release_directory(
        &self,
        path: &[u8],
        watcher: &Watcher,
        directory_watchers: &DirectoryWatchStore,
    ) {
        if !self.has_directory(path) && !directory_watchers.watches.contains_key(path) {
            watcher.remove_directory(path);
        }
    }
}

impl DevServer {
    fn release_plugin_watch_dependencies(&self, dependencies: &Dependencies) {
        self.graph_safety_lock.assert_locked();
        for directory in &dependencies.dirs {
            self.plugin_watchers.release_directory(
                &directory.watching,
                &self.bun_watcher,
                &self.directory_watchers,
            );
            #[cfg(any(target_os = "linux", target_os = "android"))]
            self.plugin_watchers.release_directory(
                dirname_or_root(&directory.path),
                &self.bun_watcher,
                &self.directory_watchers,
            );
        }
        for file in &dependencies.files {
            if !self.plugin_watchers.modules.iter().any(|modules| {
                modules.values().iter().any(|dependencies| {
                    dependencies
                        .files
                        .iter()
                        .any(|current| current.path == file.path)
                })
            }) && !self.graphs.client.bundled_files.contains_key(&file.path)
                && !self.graphs.server.bundled_files.contains_key(&file.path)
            {
                self.bun_watcher.remove_file(&file.path);
                self.plugin_watchers.release_directory(
                    dirname_or_root(&file.path),
                    &self.bun_watcher,
                    &self.directory_watchers,
                );
            }
            if let Some(directory) = &file.recovery_dir {
                self.plugin_watchers.release_directory(
                    directory,
                    &self.bun_watcher,
                    &self.directory_watchers,
                );
            }
        }
    }
    pub(crate) fn remove_client_plugin_watch_dependencies(
        &mut self,
        file: incremental_graph::ClientFileIndex,
    ) {
        if let Some(previous) = self.plugin_watchers.modules[0]
            .fetch_swap_remove(&self.graphs.client.bundled_files.keys()[file.get() as usize])
        {
            self.release_plugin_watch_dependencies(&previous.value);
        }
    }

    pub(crate) fn track_plugin_entry_point(
        &mut self,
        module: &[u8],
        graph: bake::Graph,
        original_path: &[u8],
        is_html: bool,
    ) -> crate::Result<()> {
        self.plugin_watchers
            .track_entry_point(module, graph, original_path, is_html)
    }

    pub(crate) fn replace_plugin_watch_dependencies(
        &mut self,
        module: &[u8],
        graph: bake::Graph,
        is_virtual: bool,
        files: &[Box<[u8]>],
        dirs: &[Box<[u8]>],
    ) -> Result<(), AllocError> {
        let _graph_lock = self.graph_safety_lock.guard();
        let mut dependencies = Dependencies {
            is_virtual,
            ..Default::default()
        };
        for file in files {
            let registered = self.bun_watcher.add_file_by_path_slow(file);
            let recovery_dir = if registered {
                None
            } else {
                let parent = dirname_or_root(file);
                watch_plugin_directory(&self.bun_watcher, parent)
            };
            if registered || recovery_dir.is_some() {
                dependencies.files.push(WatchedFile {
                    path: file.clone(),
                    recovery_dir,
                });
            }
        }
        for directory in dirs {
            if let Some(watched) = watch_plugin_directory(&self.bun_watcher, directory) {
                if !dependencies
                    .dirs
                    .iter()
                    .any(|entry| &entry.path == directory)
                {
                    #[cfg(any(target_os = "linux", target_os = "android"))]
                    {
                        // Other owners can keep the inode alive and defer IN_DELETE_SELF.
                        let parent = dirname_or_root(directory);
                        if !parent.is_empty() && parent != directory.as_ref() {
                            let _ = watch_plugin_directory(&self.bun_watcher, parent);
                        }
                    }
                    dependencies.dirs.push(WatchedDirectory {
                        path: directory.clone(),
                        watching: watched,
                    });
                }
            }
        }
        if let Some(previous) = self.plugin_watchers.replace(module, graph, dependencies) {
            self.release_plugin_watch_dependencies(&previous);
        }
        Ok(())
    }
}

fn watch_plugin_directory(watcher: &Watcher, mut directory: &[u8]) -> Option<Box<[u8]>> {
    loop {
        match watcher.add_directory(directory, Watcher::get_hash(directory)) {
            Ok(index) if index != bun_watcher::NO_WATCH_ITEM => return Some(Box::from(directory)),
            Ok(_) => return None,
            Err(error) if error.get_errno() == bun_sys::E::ENOENT => {
                let parent = dirname_or_root(directory);
                if parent == directory || parent.is_empty() {
                    return None;
                }
                directory = parent;
            }
            Err(error) => {
                Output::err(
                    error,
                    "failed to watch {} for hot-reloading",
                    (bun_core::fmt::quote(directory),),
                );
                return None;
            }
        }
    }
}
