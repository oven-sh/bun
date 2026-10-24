use super::answers::FunctionRef;
use crate::atom::Atom;
use crate::program::{FileId, Files, Sym};
use crate::util::FxHashMap;
use smallvec::SmallVec;

mod resolve;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct BuiltinClassIndex(pub u32);

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct BuiltinValueIndex(pub u32);

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug, Default)]
#[repr(u8)]
pub enum Denotation {
    #[default]
    View,
    Exact,
}

#[derive(Copy, Clone, Debug)]
pub struct BuiltinTypePath<'a> {
    pub class: BuiltinClassIndex,
    pub type_name: u32,
    pub module: Option<&'a str>,
    pub names: &'a [&'a str],
    pub denotation: Denotation,
}

#[derive(Copy, Clone, Debug)]
pub struct BuiltinValuePath<'a> {
    pub value: BuiltinValueIndex,
    pub module: Option<&'a str>,
    pub names: &'a [&'a str],
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct BuiltinTypeClass {
    pub class: BuiltinClassIndex,
    pub type_name: u32,
    pub denotation: Denotation,
}

#[derive(Default)]
pub struct BuiltinTypeSymbols {
    classes: FxHashMap<Sym, BuiltinTypeClass>,
    call_signatures: FxHashMap<FunctionRef, BuiltinValueIndex>,
    program_subtypes: Vec<Sym>,
    classes_with_exact_type: Vec<BuiltinClassIndex>,
    classes_by_static_member: FxHashMap<Atom, SmallVec<[Sym; 2]>>,
}

impl BuiltinTypeSymbols {
    pub fn compute(
        files: &Files<'_>,
        types: &[BuiltinTypePath<'_>],
        values: &[BuiltinValuePath<'_>],
    ) -> BuiltinTypeSymbols {
        let classes = resolve::resolve_type_classes(files, types);
        let exact_types = types
            .iter()
            .filter(|path| path.denotation == Denotation::Exact);
        let mut classes_with_exact_type: Vec<BuiltinClassIndex> =
            exact_types.map(|path| path.class).collect();
        classes_with_exact_type.sort_unstable();
        classes_with_exact_type.dedup();
        BuiltinTypeSymbols {
            classes_with_exact_type,
            classes_by_static_member: resolve::collect_static_members(files),
            program_subtypes: resolve::collect_program_subtypes(files, &classes),
            classes,
            call_signatures: resolve::collect_call_signatures(files, values),
        }
    }

    pub fn can_list_declarations_of(files: &Files<'_>, file: FileId) -> bool {
        resolve::can_list_declarations_of(files, file)
    }

    pub fn class_of(&self, symbol: Sym) -> Option<BuiltinTypeClass> {
        self.classes.get(&symbol).copied()
    }

    pub fn classes(&self) -> impl Iterator<Item = (Sym, BuiltinTypeClass)> + '_ {
        let classes = self.classes.iter();
        classes.map(|(&symbol, &class)| (symbol, class))
    }

    pub fn program_subtypes(&self) -> &[Sym] {
        &self.program_subtypes
    }

    pub fn classes_with_static_member(&self, name: Atom) -> &[Sym] {
        self.classes_by_static_member
            .get(&name)
            .map_or(&[], |classes| &classes[..])
    }

    pub fn has_exact_type(&self, class: BuiltinClassIndex) -> bool {
        self.classes_with_exact_type.binary_search(&class).is_ok()
    }

    pub fn value_of_call_signature(&self, signature: FunctionRef) -> Option<BuiltinValueIndex> {
        self.call_signatures.get(&signature).copied()
    }
}
