use super::answers::FunctionRef;
use crate::bind::FnOwner;
use crate::check::Checker;
use crate::hir::{Flags, FnId, FnKind};
use crate::program::FileId;
use crate::util::SharedSort;

#[derive(Default)]
pub struct LeftOutBodies {
    functions: Box<[FunctionRef]>,
    files: Box<[FileId]>,
}

impl LeftOutBodies {
    pub fn new(functions: impl IntoIterator<Item = FunctionRef>) -> LeftOutBodies {
        let mut functions: Vec<FunctionRef> = functions.into_iter().collect();
        functions.shared_sort_unstable();
        functions.dedup();
        LeftOutBodies {
            functions: functions.into_boxed_slice(),
            files: Box::default(),
        }
    }

    pub fn with_files(self, files: impl IntoIterator<Item = FileId>) -> LeftOutBodies {
        let mut files: Vec<FileId> = files.into_iter().collect();
        files.shared_sort_unstable();
        files.dedup();
        LeftOutBodies {
            files: files.into_boxed_slice(),
            ..self
        }
    }

    pub fn is_empty(&self) -> bool {
        self.functions.is_empty() && self.files.is_empty()
    }

    pub fn contains_file(&self, file: FileId) -> bool {
        self.files.binary_search(&file).is_ok()
    }

    pub fn contains(&self, function: FunctionRef) -> bool {
        self.functions.binary_search(&function).is_ok()
    }

    fn of_file(&self, file: FileId) -> &[FunctionRef] {
        let first = self
            .functions
            .partition_point(|function| function.file < file);
        let count = self.functions[first..].partition_point(|function| function.file == file);
        &self.functions[first..first + count]
    }
}

#[derive(Default)]
pub(in crate::check) struct LeftOutOfCheck<'p> {
    bodies: Option<&'p LeftOutBodies>,
    ranges: Vec<(u32, u32)>,
}

impl<'p> Checker<'p, '_> {
    pub fn set_left_out_bodies(&mut self, bodies: Option<&'p LeftOutBodies>) {
        self.left_out.bodies = bodies.filter(|bodies| !bodies.is_empty());
    }
}

impl Checker<'_, '_> {
    pub(in crate::check) fn is_left_out(&self, file: FileId, function: FnId) -> bool {
        let bodies = self.left_out.bodies;
        let written = self.hir(file).fns.get(function.idx());
        written.is_some_and(|it| it.flags.contains(Flags::REPLACED_BODY))
            || bodies.is_some_and(|bodies| bodies.contains(FunctionRef { file, function }))
                && !self.may_have_parameters_evaluated_with_class(file, function)
    }

    fn may_have_parameters_evaluated_with_class(&self, file: FileId, function: FnId) -> bool {
        !self.hir(file).decorators.is_empty()
            && matches!(
                self.bound(file).fns[function.idx()].owner,
                FnOwner::Member(_)
            )
    }

    fn left_out_range(&self, file: FileId, function: FnId) -> (u32, u32) {
        let hir = self.hir(file);
        let written = &hir[function];
        let start = match (written.kind, written.type_params.iter().next()) {
            (FnKind::Arrow, _) => written.start,
            (_, Some(first)) => hir[first].start,
            (_, None) => written.anchor,
        };
        (start, self.end_of_node(file, hir.node(function)))
    }

    pub(in crate::check) fn find_left_out_ranges(&mut self, file: FileId) {
        let mut ranges = std::mem::take(&mut self.left_out.ranges);
        ranges.clear();
        let functions = self
            .left_out
            .bodies
            .map_or(&[][..], |bodies| bodies.of_file(file));
        let functions = functions.iter().map(|it| it.function);
        let functions =
            functions.filter(|&it| !self.may_have_parameters_evaluated_with_class(file, it));
        ranges.extend(functions.map(|it| self.left_out_range(file, it)));
        let hir = self.hir(file);
        let replaced = (0..hir.fns.len() as u32).map(FnId);
        let replaced = replaced.filter(|&it| hir[it].flags.contains(Flags::REPLACED_BODY));
        ranges.extend(replaced.map(|it| (hir[it].start, self.end_of_node(file, hir.node(it)))));
        ranges.shared_sort_unstable();
        let mut end_of_outermost = 0;
        ranges.retain(|&(_, end)| {
            let is_outermost = end > end_of_outermost;
            end_of_outermost = end_of_outermost.max(end);
            is_outermost
        });
        self.left_out.ranges = ranges;
    }

    pub(in crate::check) fn has_left_out_functions(&self) -> bool {
        !self.left_out.ranges.is_empty()
    }

    pub(in crate::check) fn is_in_left_out_function(&self, position: u32) -> bool {
        let ranges = &self.left_out.ranges;
        let after = ranges.partition_point(|&(start, _)| start <= position);
        after != 0 && position < ranges[after - 1].1
    }

    pub(in crate::check) fn push_left_out_functions(&self, ranges: &mut Vec<(u32, u32)>) {
        ranges.extend_from_slice(&self.left_out.ranges);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn function(file: u32, function: u32) -> FunctionRef {
        FunctionRef {
            file: FileId(file),
            function: FnId(function),
        }
    }

    #[test]
    fn contains_what_it_was_made_of() {
        let bodies = LeftOutBodies::new([
            function(2, 1),
            function(0, 7),
            function(2, 0),
            function(2, 1),
        ]);
        assert!(!bodies.is_empty());
        assert!(bodies.contains(function(0, 7)));
        assert!(bodies.contains(function(2, 0)));
        assert!(!bodies.contains(function(0, 0)));
        assert!(!bodies.contains(function(1, 7)));
    }

    #[test]
    fn lists_functions_of_one_file() {
        let bodies = LeftOutBodies::new([
            function(2, 1),
            function(0, 7),
            function(2, 0),
            function(3, 4),
        ]);
        assert_eq!(bodies.of_file(FileId(2)), [function(2, 0), function(2, 1)]);
        assert_eq!(bodies.of_file(FileId(1)), []);
        assert_eq!(bodies.of_file(FileId(4)), []);
    }

    #[test]
    fn contains_files_it_was_given() {
        let bodies =
            LeftOutBodies::new([function(2, 1)]).with_files([FileId(5), FileId(3), FileId(5)]);
        assert!(bodies.contains_file(FileId(3)));
        assert!(bodies.contains_file(FileId(5)));
        assert!(!bodies.contains_file(FileId(2)));
        assert!(bodies.contains(function(2, 1)));
        assert!(!LeftOutBodies::default().with_files([FileId(0)]).is_empty());
    }

    #[test]
    fn default_is_empty() {
        let bodies = LeftOutBodies::default();
        assert!(bodies.is_empty());
        assert!(!bodies.contains(function(0, 0)));
    }
}
