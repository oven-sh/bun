use bun_sema::check::aot::{Blocks, ClassRef, RowsCarriedOver, ShapeKind};

use super::shape_edges::collect_edges;
use super::{ExploredType, MappedType};
use crate::ir::{FunctionId, Id, LayoutId, Mapped, TypeId, TypeTable};
use crate::lower::{CheckerTypeId, FileLowering};

const NO_WEIGHT: u32 = u32::MAX;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum LeftInFile {
    Unknown,
    Nothing,
    Class(ClassRef),
    ObjectType(Option<LayoutId>),
}

#[derive(Copy, Clone)]
pub(super) struct MemoEntry {
    mapped: Mapped,
    weight: u32,
    seen_in: u32,
    found_in: u32,
    shallow: Mapped,
    shallow_seen_in: u32,
    is_alike_in_every_file: bool,
    left_in_file: LeftInFile,
    first_function_type: u32,
    function_type_count: u32,
    object_type: Option<LayoutId>,
    object_type_found_in: u32,
    said_by: [u32; 2],
    said_in: u32,
}

impl MemoEntry {
    const EMPTY: MemoEntry = MemoEntry {
        mapped: Mapped::UNKNOWN,
        weight: NO_WEIGHT,
        seen_in: 0,
        found_in: 0,
        shallow: Mapped::UNKNOWN,
        shallow_seen_in: 0,
        is_alike_in_every_file: false,
        left_in_file: LeftInFile::Unknown,
        first_function_type: 0,
        function_type_count: 0,
        object_type: None,
        object_type_found_in: 0,
        said_by: [0; 2],
        said_in: 0,
    };

    fn names_type_from(&self, first: u32) -> bool {
        self.mapped.ty.to_word() >= first || self.shallow.ty.to_word() >= first
    }

    fn is_stamped_by(&self, visit: u32) -> bool {
        self.seen_in == visit
            || self.shallow_seen_in == visit
            || self.object_type_found_in == visit
            || self.said_in == visit
    }

    fn last_stamp(&self) -> u32 {
        self.seen_in
            .max(self.shallow_seen_in)
            .max(self.object_type_found_in)
            .max(self.said_in)
    }
}

impl Default for MemoEntry {
    fn default() -> MemoEntry {
        MemoEntry::EMPTY
    }
}

#[derive(Default)]
pub(in crate::lower) struct TypeMemo {
    rows: Blocks<MemoEntry>,
    is_plain: Vec<bool>,
    function_types: Vec<FunctionId>,
}

impl TypeMemo {
    #[inline]
    fn entry_at(&mut self, row: usize) -> &mut MemoEntry {
        if self.rows.len() <= row {
            self.rows.grow_to(row + 1);
        }
        &mut self.rows[row]
    }

    fn is_alike_in_every_file(&self, row: usize) -> bool {
        self.rows
            .get(row)
            .is_some_and(|entry| entry.is_alike_in_every_file)
    }

    fn is_plain(&mut self, types: &TypeTable, ty: TypeId) -> bool {
        if let Some(&is_plain) = self.is_plain.get(ty.index()) {
            return is_plain;
        }
        let described_types = types.types().first(ty.index() + 1);
        for described in described_types.skip(self.is_plain.len()).iter() {
            let known = &self.is_plain;
            let mut contents = described.classes.iter().flat_map(|part| &part.contents);
            let is_plain = described.layouts.is_empty()
                && described.functions.is_empty()
                && described.environment.is_none()
                && contents.all(|held| known[held.index()]);
            self.is_plain.push(is_plain);
        }
        self.is_plain[ty.index()]
    }

    pub(in crate::lower) fn hand_on(self, carried: Option<&RowsCarriedOver<'_>>) -> TypeMemo {
        let TypeMemo {
            rows,
            is_plain,
            function_types,
        } = self;
        let mut next = TypeMemo {
            rows,
            is_plain,
            function_types: Vec::new(),
        };
        let Some(carried) = carried else {
            next.rows.truncate(0);
            return next;
        };
        let mut carried_count = 0;
        for old_row in 0..next.rows.len() {
            let Some(new_row) = carried.new_row(old_row as u32) else {
                continue;
            };
            debug_assert_eq!(new_row as usize, carried_count);
            let entry = *next.entry_at(old_row);
            let first = entry.first_function_type as usize;
            let first_function_type = next.function_types.len() as u32;
            if entry.function_type_count != 0 {
                let count = entry.function_type_count as usize;
                next.function_types
                    .extend_from_slice(&function_types[first..][..count]);
            }
            *next.entry_at(new_row as usize) = MemoEntry {
                first_function_type,
                ..entry
            };
            carried_count = new_row as usize + 1;
        }
        next.rows.truncate(carried_count);
        next
    }

    pub(in crate::lower) fn forget_types_from(&mut self, first: u32) {
        let stamps = self.rows.iter().map(MemoEntry::last_stamp);
        let last_visit = stamps.max().unwrap_or(0);
        for entry in self.rows.iter_mut() {
            if entry.names_type_from(first) || entry.is_stamped_by(last_visit) {
                *entry = MemoEntry::EMPTY;
            }
        }
        self.is_plain.truncate(first as usize);
    }
}

fn depends_on_file(kind: ShapeKind<'_>) -> bool {
    match kind {
        ShapeKind::AnyObject
        | ShapeKind::Function(_)
        | ShapeKind::ClassConstructor(_)
        | ShapeKind::Class(_)
        | ShapeKind::Object => true,
        ShapeKind::Anything(_)
        | ShapeKind::TypeVariable { .. }
        | ShapeKind::Never
        | ShapeKind::Undefined
        | ShapeKind::Null
        | ShapeKind::Boolean
        | ShapeKind::BooleanLiteral(_)
        | ShapeKind::Number
        | ShapeKind::NumberLiteral(_)
        | ShapeKind::NumericEnumMember(_)
        | ShapeKind::BigInt
        | ShapeKind::BigIntLiteral { .. }
        | ShapeKind::String
        | ShapeKind::StringLiteral(_)
        | ShapeKind::TemplateLiteral { .. }
        | ShapeKind::Symbol
        | ShapeKind::Array { .. }
        | ShapeKind::Tuple { .. }
        | ShapeKind::Builtin { .. }
        | ShapeKind::Union(_)
        | ShapeKind::Int32 { .. } => false,
    }
}

fn has_only_parts_alike_in_every_file(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    let Ok(shape) = file.queries.type_shape(ty) else {
        return true;
    };
    !depends_on_file(shape.kind)
        && collect_edges(file, ty).iter().all(|edge| {
            let row = file.queries.row_of_type(edge.target) as usize;
            file.task.memo.is_alike_in_every_file(row)
        })
}

fn is_mapped_alike_in_every_file(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    entry: MappedType,
    unstable_answers_before: u64,
) -> bool {
    entry.weight.is_some()
        && file.queries.count_unstable_answers() == unstable_answers_before
        && file
            .task
            .memo
            .is_plain(&file.fragment.types, entry.mapped.ty)
        && has_only_parts_alike_in_every_file(file, ty)
}

fn find_what_is_left_in_file(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> LeftInFile {
    let Ok(shape) = file.queries.type_shape(ty) else {
        return LeftInFile::Nothing;
    };
    match shape.kind {
        ShapeKind::AnyObject if file.is_type_of_module(ty) => LeftInFile::Unknown,
        ShapeKind::Class(class) => LeftInFile::Class(class),
        ShapeKind::Object => LeftInFile::ObjectType(file.object_type_layout(ty)),
        _ => LeftInFile::Nothing,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn meet_again(&mut self, explored: &ExploredType, row: usize) -> bool {
        if self.queries.answers_only_what_is_known() {
            return false;
        }
        let ty = explored.ty;
        let Some(&entry) = self.task.memo.rows.get(row) else {
            return false;
        };
        if entry.left_in_file == LeftInFile::Unknown {
            return false;
        }
        for edge in explored.edges.iter() {
            let part = self.queries.row_of_type(edge.target) as usize;
            let part = self.task.memo.rows.get(part);
            if edge.target == ty || part.is_none_or(|part| part.found_in > entry.found_in) {
                return false;
            }
        }
        match entry.left_in_file {
            LeftInFile::Unknown | LeftInFile::Nothing => {}
            LeftInFile::Class(class) => _ = self.class_type_layout(class, ty),
            LeftInFile::ObjectType(layout) => {
                if self.object_type_layout(ty) != layout {
                    return false;
                }
            }
        }
        let first = entry.first_function_type as usize;
        for index in first..first + entry.function_type_count as usize {
            let function_type = self.task.memo.function_types[index];
            self.declare_function_type_again(function_type);
        }
        self.task.memo.entry_at(row).seen_in = self.task.visit;
        true
    }

    pub(in crate::lower) fn is_said_by_an_earlier_file(&mut self, ty: CheckerTypeId) -> bool {
        let row = self.queries.row_of_type(ty) as usize;
        let entry = self.task.memo.rows.get(row);
        let said_by = entry.map_or(0, |entry| entry.said_by[usize::from(self.is_checked())]);
        if said_by != 0 && said_by - 1 < self.file.0 {
            return true;
        }
        let said_by = self.inputs.said_types.find(ty, self.is_checked());
        said_by.is_some_and(|said_by| said_by < self.file)
    }

    pub(in crate::lower) fn note_that_the_file_has_said(&mut self, ty: CheckerTypeId) {
        let row = self.queries.row_of_type(ty) as usize;
        let (is_checked, file, visit) = (self.is_checked(), self.file.0, self.task.visit);
        let kept = self.task.memo.entry_at(row);
        kept.said_by[usize::from(is_checked)] = file + 1;
        kept.said_in = visit;
        if self.queries.is_known_to_every_task(ty) {
            self.fragment.note_said_type(ty);
        }
    }

    pub(in crate::lower) fn find_number_of_object_type(
        &mut self,
        ty: CheckerTypeId,
    ) -> Option<Option<LayoutId>> {
        let row = self.queries.row_of_type(ty) as usize;
        let entry = self.task.memo.rows.get(row)?;
        (entry.object_type_found_in != 0).then_some(entry.object_type)
    }

    pub(in crate::lower) fn keep_number_of_object_type(
        &mut self,
        ty: CheckerTypeId,
        layout: Option<LayoutId>,
    ) {
        let row = self.queries.row_of_type(ty) as usize;
        let visit = self.task.visit;
        let kept = self.task.memo.entry_at(row);
        kept.object_type = layout;
        kept.object_type_found_in = visit;
    }

    pub(super) fn find_mapped(&mut self, ty: CheckerTypeId) -> Option<MappedType> {
        let row = self.queries.row_of_type(ty) as usize;
        self.find_mapped_in_row(row)
    }

    #[inline]
    pub(super) fn find_mapped_in_row(&mut self, row: usize) -> Option<MappedType> {
        let visit = self.task.visit;
        let entry = self.task.memo.rows.get_mut(row)?;
        if entry.seen_in != visit && !entry.is_alike_in_every_file {
            return None;
        }
        entry.seen_in = visit;
        Some(MappedType {
            mapped: entry.mapped,
            weight: (entry.weight != NO_WEIGHT).then_some(entry.weight),
        })
    }

    pub(super) fn keep_mapped(
        &mut self,
        ty: CheckerTypeId,
        row: usize,
        entry: MappedType,
        unstable_answers_before: u64,
        function_types: Option<&[FunctionId]>,
    ) {
        debug_assert!(
            entry.weight != Some(NO_WEIGHT),
            "a weight is at most the limit on the types of one walk"
        );
        let is_alike = is_mapped_alike_in_every_file(self, ty, entry, unstable_answers_before);
        let can_say = function_types.is_some()
            && entry.weight.is_some()
            && self.queries.count_unstable_answers() == unstable_answers_before;
        let mut left_in_file = match can_say {
            true => find_what_is_left_in_file(self, ty),
            false => LeftInFile::Unknown,
        };
        if self.queries.count_unstable_answers() != unstable_answers_before {
            left_in_file = LeftInFile::Unknown;
        }
        let visit = self.task.visit;
        let weight = entry.weight.unwrap_or(NO_WEIGHT);
        let memo = &mut self.task.memo;
        let first_function_type = memo.function_types.len() as u32;
        let function_types = function_types.filter(|_| left_in_file != LeftInFile::Unknown);
        let function_types = function_types.unwrap_or_default();
        if !function_types.is_empty() {
            memo.function_types.extend_from_slice(function_types);
        }
        let function_type_count = memo.function_types.len() as u32 - first_function_type;
        let kept = memo.entry_at(row);
        if kept.seen_in == 0 || kept.mapped != entry.mapped || kept.weight != weight {
            kept.found_in = visit;
        }
        kept.mapped = entry.mapped;
        kept.weight = weight;
        kept.seen_in = visit;
        kept.is_alike_in_every_file = is_alike;
        kept.left_in_file = left_in_file;
        kept.first_function_type = first_function_type;
        kept.function_type_count = function_type_count;
    }

    pub(super) fn find_shallow(&mut self, ty: CheckerTypeId) -> Option<Mapped> {
        let row = self.queries.row_of_type(ty) as usize;
        let entry = self.task.memo.rows.get(row)?;
        (entry.shallow_seen_in == self.task.visit).then_some(entry.shallow)
    }

    pub(super) fn keep_shallow(&mut self, ty: CheckerTypeId, mapped: Mapped) {
        let row = self.queries.row_of_type(ty) as usize;
        let visit = self.task.visit;
        let kept = self.task.memo.entry_at(row);
        kept.shallow = mapped;
        kept.shallow_seen_in = visit;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::id::BuiltinClass;
    use crate::ir::{FunctionId, LayoutId, Type};

    fn entry_mapped_to(ty: TypeId, seen_in: u32) -> MemoEntry {
        MemoEntry {
            mapped: Mapped::checked(ty),
            weight: 1,
            seen_in,
            is_alike_in_every_file: true,
            ..MemoEntry::EMPTY
        }
    }

    fn intern_lists_of(types: &mut TypeTable, contents: TypeId) -> TypeId {
        let list = types.intern(Type::class(BuiltinClass::Array, &[contents]));
        types.intern(Type::class(BuiltinClass::Array, &[list]))
    }

    #[test]
    fn plain_type_names_no_layout_function_or_environment_at_any_depth() {
        let mut types = TypeTable::new();
        let lists_of_numbers = intern_lists_of(&mut types, TypeTable::NUMBER);
        let record = types.intern(Type::layout(LayoutId::new(0)));
        let function = types.intern(Type::function(FunctionId::new(0)));
        let environment = types.intern(Type::environment(LayoutId::new(0)));
        let lists_of_records = intern_lists_of(&mut types, record);
        let lists_of_functions = intern_lists_of(&mut types, function);

        let mut memo = TypeMemo::default();
        assert!(!memo.is_plain(&types, lists_of_records));
        for ty in [TypeTable::ANYTHING, TypeTable::ARRAY, lists_of_numbers] {
            assert!(memo.is_plain(&types, ty), "{ty}");
        }
        for ty in [record, function, environment, lists_of_functions] {
            assert!(!memo.is_plain(&types, ty), "{ty}");
        }
    }

    #[test]
    fn roll_back_forgets_the_cut_types_and_the_visit_that_made_them() {
        let first = TypeTable::WELL_KNOWN_COUNT as u32 + 1;
        let staying = TypeId::from_word(first - 1);
        let cut = TypeId::from_word(first);
        let mut memo = TypeMemo::default();
        *memo.entry_at(0) = entry_mapped_to(staying, 1);
        *memo.entry_at(1) = entry_mapped_to(cut, 2);
        *memo.entry_at(2) = entry_mapped_to(staying, 2);
        *memo.entry_at(4) = MemoEntry {
            shallow: Mapped::checked(cut),
            shallow_seen_in: 2,
            ..entry_mapped_to(staying, 1)
        };
        memo.is_plain = vec![true; first as usize + 1];

        memo.forget_types_from(first);

        let stamps: Vec<u32> = memo.rows.iter().map(|entry| entry.seen_in).collect();
        assert_eq!(stamps, [1, 0, 0, 0, 0]);
        assert!(memo.is_alike_in_every_file(0));
        assert!((1..6).all(|row| !memo.is_alike_in_every_file(row)));
        assert!(memo.rows.iter().all(|entry| entry.shallow_seen_in == 0));
        assert_eq!(memo.is_plain.len(), first as usize);
    }

    #[test]
    fn rows_cut_at_the_edge_of_a_block_grow_again_empty() {
        let mut memo = TypeMemo::default();
        memo.entry_at(2499);
        for (entry, stamp) in memo.rows.iter_mut().zip(1..) {
            entry.seen_in = stamp;
        }
        assert_eq!(memo.rows.iter().count(), 2500);

        memo.rows.truncate(1024);

        assert_eq!(memo.rows.len(), 1024);
        let stamp_of = |memo: &TypeMemo, row: usize| memo.rows.get(row).map(|entry| entry.seen_in);
        assert_eq!(stamp_of(&memo, 0), Some(1));
        assert_eq!(stamp_of(&memo, 1023), Some(1024));
        assert_eq!(stamp_of(&memo, 1024), None);
        assert_eq!(memo.entry_at(2047).seen_in, 0);
        assert_eq!(memo.rows.len(), 2048);
        assert_eq!(stamp_of(&memo, 1023), Some(1024));
        assert!(memo.rows.iter().skip(1024).all(|entry| entry.seen_in == 0));
        assert_eq!(stamp_of(&memo, 2048), None);
    }
}
