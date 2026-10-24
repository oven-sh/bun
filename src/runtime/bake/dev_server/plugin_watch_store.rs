use super::*;

#[derive(Default)]
pub(crate) struct PluginWatchStore {
    pub(crate) modules: [StringArrayHashMap<Dependencies>; 3],
}

#[derive(Default)]
pub(crate) struct Dependencies {
    pub(crate) is_virtual: bool,
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
        dependencies: Dependencies,
    ) -> Result<(), AllocError> {
        let modules = &mut self.modules[Self::graph_index(graph)];
        if !dependencies.is_virtual && dependencies.files.is_empty() && dependencies.dirs.is_empty()
        {
            modules.swap_remove(module);
        } else {
            modules.put(module, dependencies)?;
        }
        Ok(())
    }

    pub(crate) fn remove_module(&mut self, module: &[u8], side: bake::Side) {
        match side {
            bake::Side::Client => {
                self.modules[0].swap_remove(module);
            }
            bake::Side::Server => {
                self.modules[1].swap_remove(module);
                self.modules[2].swap_remove(module);
            }
        }
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
                            && bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                                &directory.path,
                            ) == path)
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
        watcher: &mut Watcher,
    ) -> Result<(), AllocError> {
        let mut modules = Vec::new();
        for graph in &mut self.modules {
            for index in 0..graph.len() {
                let dependencies = &mut graph.values_mut()[index];
                let mut changed = false;
                for directory in &mut dependencies.dirs {
                    let parent_event = cfg!(any(target_os = "linux", target_os = "android"))
                        && (event.files.contains_key(&directory.path)
                            || event
                                .dirs
                                .get(
                                    bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                                        &directory.path,
                                    ),
                                )
                                .is_some_and(|op| op.contains(bun_watcher::Op::WATCH_INVALIDATED)));
                    if event.directory_entries_changed(&directory.watching) || parent_event {
                        if let Some(watching) = watch_plugin_directory(watcher, &directory.path) {
                            changed |= directory.path == directory.watching
                                || watching != directory.watching;
                            directory.watching = watching;
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
                            file.recovery_dir = None;
                            changed = true;
                        } else {
                            let parent = bun_paths::resolve_path::dirname::<
                                bun_paths::platform::Auto,
                            >(&file.path);
                            file.recovery_dir = watch_plugin_directory(watcher, parent);
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
        Ok(())
    }
}

impl DevServer {
    pub(crate) fn replace_plugin_watch_dependencies(
        &mut self,
        module: &[u8],
        graph: bake::Graph,
        is_virtual: bool,
        files: &[Box<[u8]>],
        dirs: &[Box<[u8]>],
    ) -> Result<(), AllocError> {
        let mut dependencies = Dependencies {
            is_virtual,
            ..Default::default()
        };
        for file in files {
            let recovery_dir = if self.bun_watcher.add_file_by_path_slow(file) {
                None
            } else {
                let parent = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(file);
                watch_plugin_directory(&mut self.bun_watcher, parent)
            };
            dependencies.files.push(WatchedFile {
                path: file.clone(),
                recovery_dir,
            });
        }
        for directory in dirs {
            if let Some(watched) = watch_plugin_directory(&mut self.bun_watcher, directory) {
                if !dependencies
                    .dirs
                    .iter()
                    .any(|entry| &entry.path == directory)
                {
                    #[cfg(any(target_os = "linux", target_os = "android"))]
                    {
                        // Other owners can keep the inode alive and defer IN_DELETE_SELF.
                        let parent = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                            directory,
                        );
                        if !parent.is_empty() && parent != directory.as_ref() {
                            let _ = watch_plugin_directory(&mut self.bun_watcher, parent);
                        }
                    }
                    dependencies.dirs.push(WatchedDirectory {
                        path: directory.clone(),
                        watching: watched,
                    });
                }
            }
        }
        self.plugin_watchers.replace(module, graph, dependencies)
    }
}

fn watch_plugin_directory(watcher: &mut Watcher, mut directory: &[u8]) -> Option<Box<[u8]>> {
    loop {
        match watcher.add_directory::<true>(
            bun_sys::Fd::INVALID,
            directory,
            Watcher::get_hash(directory),
        ) {
            Ok(_) => return Some(Box::from(directory)),
            Err(error) if error.get_errno() == bun_sys::E::ENOENT => {
                let parent =
                    bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(directory);
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
