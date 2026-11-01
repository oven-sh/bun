use crate::builtins::id::BuiltinId;
use crate::ir::generated::{FunctionReferenceKind, ModuleReferenceKind};
use crate::ir::ids::{
    DataId, EvalScopeId, ExpectedResultId, FunctionId, Id, LayoutId, ModuleFailureId, ModuleId,
    PropertyKeyId, StringId, TypeId, TypeSiteId, VariableId,
};
use crate::ir::references::{IdMap, Reference, ReferenceKind, remap, remap_optional};

pub(super) struct IdMapStorage {
    strings: Vec<Option<StringId>>,
    property_keys: Vec<Option<PropertyKeyId>>,
    types: Vec<Option<TypeId>>,
    type_sites: Vec<Option<TypeSiteId>>,
    expected_results: Vec<Option<ExpectedResultId>>,
    layouts: Vec<Option<LayoutId>>,
    variables: Vec<Option<VariableId>>,
    modules: Vec<Option<ModuleId>>,
    module_failures: Vec<Option<ModuleFailureId>>,
    eval_scopes: Vec<Option<EvalScopeId>>,
    functions: Vec<Option<FunctionId>>,
    data: Vec<Option<DataId>>,
}

fn shift_ids<I: Id>(count: usize, offset: usize) -> Vec<Option<I>> {
    (0..count)
        .map(|index| Some(I::new(index + offset)))
        .collect()
}

impl IdMapStorage {
    pub(super) fn new(count: usize, offset_of_slice: impl Fn(usize) -> usize) -> IdMapStorage {
        IdMapStorage {
            strings: shift_ids(count, offset_of_slice(0)),
            property_keys: shift_ids(count, offset_of_slice(1)),
            types: shift_ids(count, offset_of_slice(2)),
            type_sites: shift_ids(count, offset_of_slice(3)),
            expected_results: shift_ids(count, offset_of_slice(4)),
            layouts: shift_ids(count, offset_of_slice(5)),
            variables: shift_ids(count, offset_of_slice(6)),
            modules: shift_ids(count, offset_of_slice(7)),
            module_failures: shift_ids(count, offset_of_slice(8)),
            eval_scopes: shift_ids(count, offset_of_slice(9)),
            functions: shift_ids(count, offset_of_slice(10)),
            data: shift_ids(count, offset_of_slice(11)),
        }
    }

    pub(super) fn as_id_map(&self) -> IdMap<'_> {
        IdMap {
            strings: &self.strings,
            property_keys: &self.property_keys,
            types: &self.types,
            type_sites: &self.type_sites,
            expected_results: &self.expected_results,
            layouts: &self.layouts,
            variables: &self.variables,
            modules: &self.modules,
            module_failures: &self.module_failures,
            eval_scopes: &self.eval_scopes,
            functions: &self.functions,
            data: &self.data,
        }
    }
}

const WORD: u32 = 3;

fn references_of_word() -> Vec<(ReferenceKind, Reference)> {
    let mut references = vec![
        (
            ReferenceKind::String,
            Reference::String(StringId::from_word(WORD)),
        ),
        (
            ReferenceKind::PropertyKey,
            Reference::PropertyKey(PropertyKeyId::from_word(WORD)),
        ),
        (
            ReferenceKind::Type,
            Reference::Type(TypeId::from_word(WORD)),
        ),
        (
            ReferenceKind::TypeSite,
            Reference::TypeSite(TypeSiteId::from_word(WORD)),
        ),
        (
            ReferenceKind::ExpectedResult,
            Reference::ExpectedResult(ExpectedResultId::from_word(WORD)),
        ),
        (
            ReferenceKind::Layout,
            Reference::Layout(LayoutId::from_word(WORD)),
        ),
        (
            ReferenceKind::Variable,
            Reference::Variable(VariableId::from_word(WORD)),
        ),
        (
            ReferenceKind::ModuleFailure,
            Reference::ModuleFailure(ModuleFailureId::from_word(WORD)),
        ),
        (
            ReferenceKind::EvalScope,
            Reference::EvalScope(EvalScopeId::from_word(WORD)),
        ),
        (
            ReferenceKind::Data,
            Reference::Data(DataId::from_word(WORD)),
        ),
    ];
    for role in ModuleReferenceKind::ALL {
        let reference = Reference::Module(ModuleId::from_word(WORD), role);
        references.push((ReferenceKind::Module(role), reference));
    }
    for role in FunctionReferenceKind::ALL {
        let reference = Reference::Function(FunctionId::from_word(WORD), role);
        references.push((ReferenceKind::Function(role), reference));
    }
    let builtin = BuiltinId::from_wire(WORD).expect("the table has more than three built-ins");
    references.push((ReferenceKind::Builtin, Reference::Builtin(builtin)));
    references
}

#[test]
fn from_word_gives_the_reference_of_the_kind() {
    let references = references_of_word();
    assert_eq!(references.len(), 17);
    for (kind, reference) in references {
        assert_eq!(Reference::from_word(kind, WORD), Some(reference));
    }
}

#[test]
fn builtin_word_past_table_is_no_reference() {
    let last = BuiltinId::COUNT - 1;
    let reference = Reference::from_word(ReferenceKind::Builtin, last);
    assert!(matches!(reference, Some(Reference::Builtin(_))));
    assert_eq!(
        Reference::from_word(ReferenceKind::Builtin, BuiltinId::COUNT),
        None
    );
    assert_eq!(Reference::from_word(ReferenceKind::Builtin, u32::MAX), None);
}

#[test]
fn remap_replaces_id_by_map_entry() {
    let map = [Some(LayoutId::new(7)), None, Some(LayoutId::new(0))];
    let mut first = LayoutId::new(0);
    remap(&mut first, &map);
    assert_eq!(first, LayoutId::new(7));
    let mut last = LayoutId::new(2);
    remap(&mut last, &map);
    assert_eq!(last, LayoutId::new(0));
}

#[test]
fn remap_optional_keeps_absent_id() {
    let map = [Some(StringId::new(4))];
    let mut present = Some(StringId::new(0));
    remap_optional(&mut present, &map);
    assert_eq!(present, Some(StringId::new(4)));
    let mut absent: Option<StringId> = None;
    remap_optional(&mut absent, &map);
    assert_eq!(absent, None);
    remap_optional(&mut absent, &[]);
    assert_eq!(absent, None);
}

#[test]
#[should_panic(expected = "retained code names a dropped item")]
fn remap_of_dropped_id_panics() {
    let mut id = FunctionId::new(1);
    remap(&mut id, &[Some(FunctionId::new(0)), None]);
}

#[test]
#[should_panic(expected = "retained code names a dropped item")]
fn remap_optional_of_dropped_id_panics() {
    remap_optional(&mut Some(ModuleId::new(0)), &[None]);
}

fn slice_of(kind: ReferenceKind) -> Option<usize> {
    match kind {
        ReferenceKind::String => Some(0),
        ReferenceKind::PropertyKey => Some(1),
        ReferenceKind::Type => Some(2),
        ReferenceKind::TypeSite => Some(3),
        ReferenceKind::ExpectedResult => Some(4),
        ReferenceKind::Layout => Some(5),
        ReferenceKind::Variable => Some(6),
        ReferenceKind::Module(_) => Some(7),
        ReferenceKind::ModuleFailure => Some(8),
        ReferenceKind::EvalScope => Some(9),
        ReferenceKind::Function(_) => Some(10),
        ReferenceKind::Data => Some(11),
        ReferenceKind::Builtin => None,
    }
}

#[test]
fn remap_word_uses_slice_of_kind() {
    let offset_of_slice = |slice: usize| 10 * (slice + 1);
    let storage = IdMapStorage::new(WORD as usize + 1, offset_of_slice);
    let map = storage.as_id_map();
    for (kind, _) in references_of_word() {
        let offset = slice_of(kind).map_or(0, offset_of_slice);
        assert_eq!(map.remap_word(kind, WORD), WORD + offset as u32, "{kind:?}");
    }
}

#[test]
fn remap_word_keeps_builtin_past_every_slice() {
    let storage = IdMapStorage::new(0, |_| 0);
    let word = BuiltinId::COUNT - 1;
    assert_eq!(
        storage.as_id_map().remap_word(ReferenceKind::Builtin, word),
        word
    );
}
