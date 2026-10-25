mod walk;

use super::{BindingStability, Bound, SymbolId};
use crate::atom::Atom;
use crate::check::aot::{ClassRef, FunctionRef};
use crate::hir::{ExprId, File};
use crate::program::{FileId, Sym};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum ReferentCertainty {
    Expected,
    Proven,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum NamespaceReferent<M> {
    Module(M),
    Declared(Sym),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum UnknownReferent {
    NotAReference,
    FreeName,
    DynamicScope,
    NotCompiled,
    UnstableBinding(BindingStability),
    OpaqueInitializer,
    DecoratedClass,
    UnlinkedImport,
    MemberOfValue,
    MissingMember,
    Cycle,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum StaticReferent<B, M> {
    Class(ClassRef),
    Function(FunctionRef),
    Builtin(B),
    Namespace(NamespaceReferent<M>),
    Unknown(UnknownReferent),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct ResolvedReferent<B, M> {
    pub referent: StaticReferent<B, M>,
    pub certainty: ReferentCertainty,
}

// The expression whose value a name has for as long as the program runs.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct StaticInitializer {
    pub file: FileId,
    pub expr: ExprId,
    // The binding that the expression initializes. `None`: the expression was asked about itself.
    pub holder: Option<Sym>,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum LinkedBinding<B, M> {
    Binding(Sym),
    Namespace(M),
    Builtin(B),
    Unknown,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum LoadedValue<M> {
    Namespace(M),
    DefaultExport(FileId),
    ModuleExports(FileId),
}

pub trait ReferentContext<'s> {
    type Builtin: Copy;
    type Module: Copy;

    fn hir(&self, file: FileId) -> &File<'s>;

    fn bound(&self, file: FileId) -> &Bound<'s>;

    fn builtin_of_expression(&self, file: FileId, expr: ExprId) -> Option<Self::Builtin>;

    fn builtin_member(&self, holder: Self::Builtin, name: Atom) -> Option<Self::Builtin>;

    fn linked_binding(
        &self,
        file: FileId,
        import: SymbolId,
    ) -> LinkedBinding<Self::Builtin, Self::Module>;

    fn module_export(
        &self,
        module: Self::Module,
        name: Atom,
    ) -> LinkedBinding<Self::Builtin, Self::Module>;

    fn loaded_value(&self, file: FileId, call: ExprId) -> Option<LoadedValue<Self::Module>>;

    fn is_dead_store(&self, file: FileId, target: ExprId) -> bool;

    fn find_target_of_copied_properties(&self, _: Self::Builtin) -> Option<u32> {
        None
    }
}

pub fn static_referent<'s, C: ReferentContext<'s>>(
    context: &C,
    file: FileId,
    expr: ExprId,
) -> ResolvedReferent<C::Builtin, C::Module> {
    walk::ReferentWalk::new(context).resolve_expression(file, expr)
}

pub fn static_initializer<'s, C: ReferentContext<'s>>(
    context: &C,
    file: FileId,
    expr: ExprId,
) -> Option<StaticInitializer> {
    walk::ReferentWalk::new(context).resolve_initializer(file, expr)
}

pub fn export_referent<'s, C: ReferentContext<'s>>(
    context: &C,
    file: FileId,
    name: Atom,
    member: Option<Atom>,
) -> ResolvedReferent<C::Builtin, C::Module> {
    walk::ReferentWalk::new(context).resolve_export(file, name, member)
}

pub fn symbol_referent<'s, C: ReferentContext<'s>>(
    context: &C,
    symbol: Sym,
) -> ResolvedReferent<C::Builtin, C::Module> {
    walk::ReferentWalk::new(context).resolve_symbol(symbol)
}
