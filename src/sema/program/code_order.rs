use super::code_load::{AddFile, CodeEntry, LoadKey, ModuleSlots};
use super::*;

impl CodeEntry<'_, '_> {
    fn has_code(&self) -> bool {
        match self.role {
            FileRole::Checked | FileRole::Inferred => true,
            FileRole::TypesOnly => false,
        }
    }

    fn is_types_root(&self) -> bool {
        match self.role {
            FileRole::Checked | FileRole::TypesOnly => true,
            FileRole::Inferred => false,
        }
    }
}

impl<'s, 'r> CodeFiles<'s, 'r> {
    pub(super) fn register(
        &mut self,
        ahead: &Prefetch<'s, 'r>,
        add: AddFile<'_, 's>,
        mut tables: RootTables<'_, 's>,
    ) {
        for index in 0..self.entries.len() {
            let key = self.entries[index].key;
            let id = match key.loader == HostLoader::default() {
                true => add(key.path, false, tables.modules, tables.depths, tables.found),
                false => self.add_with_loader(key, &mut tables),
            };
            let entry = &mut self.entries[index];
            let file = match entry.has_code() {
                true => {
                    let first = tables.found.files[id.idx()].first;
                    tables.found.files[first.idx()].named = Some(first);
                    first
                }
                false => id,
            };
            entry.file = Some(file);
            if entry.is_types_root() {
                let task = SubTask {
                    file,
                    increases_depth: false,
                    is_elided_on_depth: false,
                    package: None,
                };
                tables.queued.push((task, entry.package_depth));
                tables.root_tasks.push(Some(file));
                continue;
            }
            let resolutions = entry
                .loaded
                .get_mut()
                .iter()
                .flat_map(|loaded| &loaded.imports);
            for resolution in resolutions.filter(|it| {
                it.should_add_file && it.is_importable && it.unsupported_extension.is_none()
            }) {
                let path = resolution.path;
                let target = add(path, false, tables.modules, tables.depths, tables.found);
                entry
                    .jsdoc_imports
                    .push((resolution.spec, resolution.mode, target));
                let task = SubTask {
                    file: target,
                    increases_depth: resolution.increases_depth,
                    is_elided_on_depth: resolution.increases_depth
                        && is_javascript_file(tables.host, path)
                        && strings::contains(path, b"/node_modules/"),
                    package: tables.found.package_of_task(target, resolution.package_id),
                };
                tables.queued.push((task, entry.package_depth));
                tables.root_tasks.push(Some(target));
            }
        }
        self.index_entries(tables.modules.len());
        self.seed_type_files(ahead, tables.found);
    }

    pub(super) fn take_loaded(&mut self, file: FileId) -> Option<Box<Loaded<'s, 'r>>> {
        let index = self.entry_of(file)?;
        self.entries[index].loaded.get_mut().take()
    }

    pub(super) fn has_loaded(code_files: &Option<CodeFiles<'s, 'r>>, file: FileId) -> bool {
        let Some(code_files) = code_files else {
            return false;
        };
        let entry = code_files.entry_of(file);
        entry.is_some_and(|index| code_files.entries[index].loaded.lock().is_some())
    }

    pub(super) fn install_remaining_files(
        &mut self,
        arena: &'s Arena,
        modules: &mut ModuleSlots<'s>,
        depths: &mut [u32],
        found: &Found<'s>,
        seen: &mut [bool],
    ) {
        for entry in &mut self.entries {
            let Some(file) = entry.file else {
                continue;
            };
            if let Some(loaded) = entry.loaded.get_mut().take() {
                let mut loaded = *loaded;
                loaded.module.path = found.files[file.idx()].path;
                loaded.module.imports = map_in(arena);
                let imports = entry.jsdoc_imports.iter();
                (loaded.module.imports).extend(imports.map(|it| ((it.0, it.1), it.2)));
                let edges: Vec<FileId> = entry.jsdoc_imports.iter().map(|it| it.2).collect();
                loaded.module.edges = slice_in(&edges, arena);
                modules[file.idx()] = Some(loaded.module);
            }
            if entry.has_code() {
                seen[file.idx()] = true;
            }
            let lowest_depth = &mut depths[found.files[file.idx()].first.idx()];
            *lowest_depth = (*lowest_depth).min(entry.package_depth);
        }
        let is_loaded = |file: &FoundFile<'s>| found.files[file.first.idx()].is_loaded;
        self.is_in_types_program = found.files.iter().map(is_loaded).collect();
    }

    pub(super) fn renumber(&mut self, renumbered: &[Option<FileId>]) {
        for entry in &mut self.entries {
            entry.file = entry.file.and_then(|file| renumbered[file.idx()]);
        }
        let new_ids = renumbered.iter().flatten();
        let file_count = new_ids.map(|file| file.idx() + 1).max().unwrap_or(0);
        let mut is_in_types_program = vec![false; file_count];
        for (new, &was_in_types_program) in renumbered.iter().zip(&self.is_in_types_program) {
            if let Some(new) = new {
                is_in_types_program[new.idx()] |= was_in_types_program;
            }
        }
        self.is_in_types_program = is_in_types_program;
        self.index_entries(file_count);
    }

    pub(super) fn entry_of(&self, file: FileId) -> Option<usize> {
        let index = self.entry_of_file.get(file.idx()).copied().flatten()?;
        Some(index as usize)
    }

    fn add_with_loader(&self, key: LoadKey<'r>, tables: &mut RootTables<'_, 's>) -> FileId {
        let arena = self.session.arena();
        let path = slice_in(key.path, arena);
        let id = FileId(tables.modules.len() as u32);
        tables.modules.push(None);
        tables.depths.push(u32::MAX);
        tables.found.files.push(FoundFile {
            path: file_path(path, self.is_case_sensitive, arena),
            is_lib: false,
            package: None,
            first: id,
            is_read: true,
            parse: None,
            is_loaded: false,
            named: Some(id),
        });
        id
    }

    fn index_entries(&mut self, file_count: usize) {
        let mut entry_of_file = vec![None; file_count];
        for (index, entry) in self.entries.iter().enumerate() {
            if let Some(file) = entry.file {
                entry_of_file[file.idx()].get_or_insert(index as u32);
            }
        }
        self.entry_of_file = entry_of_file;
    }

    fn seed_type_files(&self, ahead: &Prefetch<'s, 'r>, found: &Found<'s>) {
        let mut code_paths: Vec<&'r [u8]> = Vec::new();
        let mut registered_paths: FxHashSet<&'s [u8]> = FxHashSet::default();
        for entry in &self.entries {
            if let Some(file) = entry.file
                && entry.has_code()
                && entry.key.loader == HostLoader::default()
            {
                code_paths.push(entry.key.path);
                registered_paths.insert(found.files[file.idx()].path.text);
            }
        }
        let is_code_path = |path: &[u8]| {
            if self.is_case_sensitive {
                return registered_paths.contains(path);
            }
            let mut buffer = path_buffer_pool::get();
            let text = to_path_in(path, false, &mut buffer[..]);
            registered_paths.contains(&text[..])
        };
        ahead.skip_code_files(&is_code_path, &code_paths);
        for entry in &self.entries {
            if !entry.has_code() {
                ahead.add_seed(entry.key.path, false);
            }
            for &(path, is_lib) in &entry.predicted_type_files {
                if !is_code_path(path) {
                    ahead.add_seed(path, is_lib);
                }
            }
        }
    }
}

impl<'r> Prefetch<'_, 'r> {
    fn skip_code_files(&self, is_code_path: &dyn Fn(&[u8]) -> bool, code_paths: &[&'r [u8]]) {
        let mut state = self.state.lock();
        for &path in code_paths {
            let next = state.seen.len() as u32;
            state.seen.entry(path).or_insert(next);
        }
        state.to_read.retain(|file| !is_code_path(file.path));
    }

    pub(super) fn add_seed(&self, path: &'r [u8], is_lib: bool) {
        let mut state = self.state.lock();
        let next = state.seen.len() as u32;
        if *state.seen.entry(path).or_insert(next) == next {
            let seed = ToLoad {
                path,
                is_lib,
                package: None,
            };
            match is_lib {
                true => state.to_read.push_front(seed),
                false => state.to_read.push_back(seed),
            }
            if state.expects_seeds {
                self.has_to_read.notify_one();
                self.has_work.notify_one();
            }
        }
    }
}

#[cfg(test)]
mod tests;
