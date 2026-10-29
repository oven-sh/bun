use super::answers::FunctionRef;
use crate::atom::Atom;
use crate::hir::File;
use crate::program::{Files, Sym};
use crate::util::FxHashMap;
use smallvec::SmallVec;
use std::sync::OnceLock;

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

/// Lists the paths of the values, in the order in which they claim a signature.
pub type BuiltinValuePathList = Box<dyn Fn() -> &'static [BuiltinValuePath<'static>] + Send + Sync>;

pub struct BuiltinTypeSymbols {
    classes: FxHashMap<Sym, BuiltinTypeClass>,
    values: BuiltinValuePathList,
    /// What is asked about a method is answered from the paths that end in its name.
    methods: OnceLock<resolve::MethodsByName>,
    call_signatures: OnceLock<FxHashMap<FunctionRef, BuiltinValueIndex>>,
    program_subtypes: Vec<Sym>,
    classes_with_exact_type: Vec<BuiltinClassIndex>,
    classes_by_static_member: FxHashMap<Atom, SmallVec<[Sym; 2]>>,
}

impl BuiltinTypeSymbols {
    pub fn compute(
        files: &Files<'_>,
        types: &[BuiltinTypePath<'_>],
        values: BuiltinValuePathList,
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
            values,
            methods: OnceLock::new(),
            call_signatures: OnceLock::new(),
        }
    }

    pub fn can_list_declarations_of(file: &File<'_>) -> bool {
        resolve::can_list_declarations_of(file)
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

    /// `files`: what `compute` was given.
    pub fn value_of_call_signature(
        &self,
        files: &Files<'_>,
        signature: FunctionRef,
    ) -> Option<BuiltinValueIndex> {
        match resolve::find_claimants(files, signature) {
            resolve::Claimants::None => None,
            resolve::Claimants::Named(name) => {
                let group = || resolve::MethodsByName::group(files, (self.values)());
                let methods = self.methods.get_or_init(group);
                methods.value_of(files, (self.values)(), name, signature)
            }
            resolve::Claimants::Any => {
                let collect = || resolve::collect_call_signatures(files, (self.values)());
                let signatures = self.call_signatures.get_or_init(collect);
                signatures.get(&signature).copied()
            }
        }
    }
}
