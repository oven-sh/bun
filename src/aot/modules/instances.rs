use bun_sema::bind::SymbolId;
use bun_sema::program::FileId;

use super::graph::{FileRow, ModuleGraph};
use super::{ExportBinding, ImportBinding, ModuleKind, ModuleRef};

pub struct InstanceLayout {
    exports: Vec<SymbolId>,
    links: Vec<FileId>,
}

impl InstanceLayout {
    pub fn exports(&self) -> &[SymbolId] {
        &self.exports
    }

    pub fn links(&self) -> &[FileId] {
        &self.links
    }

    pub fn field_of_export(&self, symbol: SymbolId) -> Option<u32> {
        let place = self.exports.binary_search(&symbol).ok()?;
        Some(place as u32)
    }

    pub fn field_of_link(&self, target: FileId) -> Option<u32> {
        let place = self.links.binary_search(&target).ok()?;
        Some((self.exports.len() + place) as u32)
    }

    pub fn field_of_scope(&self) -> u32 {
        (self.exports.len() + self.links.len()) as u32
    }
}

fn find_files_of_imports(row: &FileRow) -> Vec<FileId> {
    let imports = row.imports.iter().map(|import| import.1);
    let members = row.members.iter().map(|member| member.1);
    let jsx = row.jsx.iter().map(|import| import.1);
    let bindings = imports.chain(members).chain(jsx);
    let files = bindings.filter_map(|binding| match binding {
        ImportBinding::Variable(variable) => Some(variable.file),
        _ => None,
    });
    let mut files: Vec<FileId> = files.filter(|&file| file != row.file).collect();
    files.sort_unstable();
    files.dedup();
    files
}

impl ModuleGraph {
    pub fn has_instances(&self, file: FileId) -> bool {
        self.is_reloadable(file)
            && self.kind(file) == ModuleKind::SourceText
            && !self.is_left_out(ModuleRef::File(file))
    }

    pub fn instance_layout(&self, file: FileId) -> Option<&InstanceLayout> {
        if !self.has_instances(file) {
            return None;
        }
        Some(self.instance_layouts[file.idx()].get_or_init(|| self.compute_instance_layout(file)))
    }

    fn compute_instance_layout(&self, file: FileId) -> InstanceLayout {
        let own_variables = self.exports(file).iter().filter_map(|export| {
            let ExportBinding::Variable(variable) = export.binding else {
                return None;
            };
            let is_declared_here = variable.file == file
                && self.import_binding(file, variable.id) == ImportBinding::Local;
            is_declared_here.then_some(variable.id)
        });
        let mut exports: Vec<SymbolId> = own_variables.collect();
        exports.sort_unstable();
        exports.dedup();
        let row = self.row(file);
        let mut links = find_files_of_imports(row);
        links.retain(|&target| {
            self.has_instances(target) && row.unread_instances.binary_search(&target).is_err()
        });
        InstanceLayout { exports, links }
    }

    pub fn limit_instance_links(&mut self, is_read: &dyn Fn(FileId, FileId) -> bool) {
        for index in 0..self.rows.len() {
            let file = self.rows[index].file;
            if !self.is_reloadable(file) {
                continue;
            }
            let mut unread = find_files_of_imports(&self.rows[index]);
            unread.retain(|&target| !is_read(file, target));
            self.rows[index].unread_instances = unread;
        }
    }
}
