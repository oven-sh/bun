//! ESLint's `Variable`, one to one. See [the guide](super#eslints-variables).

use super::{Declaration, DeclarationKinds, Reference, Scope, ScopeKind, Symbol};
use crate::ast::{Class, File, Name, Node};
use crate::language::SourceType;
use crate::utils::oxlint::source_type;
use bun_sema::atom::known;

/// How a [`Variable`] is represented here.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum VariableKind<'a> {
    /// Declared by the file. For a class declaration's name, this is the variable in the scope around the class.
    Declared(Symbol<'a>),
    /// The variable a class declaration has for its name in its own scope, which is what the name resolves to inside
    /// the class. `outer` is the symbol, which lives in the enclosing scope.
    NameInClass { class: Class<'a>, outer: Symbol<'a> },
    /// A global-scope variable that the file doesn't declare: [`File::global`].
    Global(Name<'a>),
    /// With an oxlint config, the `arguments` at the top level of a file whose name makes it CommonJS.
    /// typescript-eslint treats that scope as a function scope.
    FileArguments,
}

/// ESLint's `Variable`. Returned by [`Reference::variable`], [`Scope::variable`] and [`Scope::find_variable`].
#[derive(Copy, Clone)]
pub struct Variable<'a> {
    file: &'a File<'a>,
    kind: VariableKind<'a>,
}

impl PartialEq for Variable<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.kind == other.kind
    }
}
impl Eq for Variable<'_> {}
impl std::hash::Hash for Variable<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.kind.hash(state);
    }
}
impl std::fmt::Debug for Variable<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.kind.fmt(f)
    }
}

#[inline]
fn is_class_name(symbol: Symbol) -> bool {
    (symbol.declaration_kinds()).contains(DeclarationKinds::CLASS_NAME)
}

/// Returns the class declaration that declares `symbol` and contains `from`.
fn enclosing_class<'a>(symbol: Symbol<'a>, from: Scope<'a>) -> Option<Class<'a>> {
    if !is_class_name(symbol) {
        return None;
    }
    let declared_in = symbol.scope();
    symbol.declarations().find_map(|it| match it {
        // A class expression's name is declared only once, in the class's own scope.
        Declaration::Class(class) => (class.scope())
            .filter(|inside| *inside != declared_in && inside.contains(from))
            .map(|_| class),
        _ => None,
    })
}

fn has_file_arguments<'a>(file: &'a File<'a>) -> bool {
    file.language().is_oxlint && source_type(file) == SourceType::CommonJs
}

impl<'a> Variable<'a> {
    #[inline]
    pub fn kind(self) -> VariableKind<'a> {
        self.kind
    }

    /// Returns the symbol the file declares under this name, if any. For `NameInClass` that's the symbol in the
    /// enclosing scope.
    pub fn symbol(self) -> Option<Symbol<'a>> {
        match self.kind {
            VariableKind::Declared(symbol) | VariableKind::NameInClass { outer: symbol, .. } => {
                Some(symbol)
            }
            VariableKind::Global(_) | VariableKind::FileArguments => None,
        }
    }

    /// `variable.name`
    pub fn name(self) -> Name<'a> {
        match self.kind {
            VariableKind::Declared(symbol) | VariableKind::NameInClass { outer: symbol, .. } => {
                symbol.name()
            }
            VariableKind::Global(name) => name,
            VariableKind::FileArguments => self.file.name(known::arguments),
        }
    }

    /// `variable.scope`
    pub fn scope(self) -> Scope<'a> {
        match self.kind {
            VariableKind::Declared(symbol) => symbol.scope(),
            VariableKind::NameInClass { class, outer } => {
                class.scope().unwrap_or_else(|| outer.scope())
            }
            VariableKind::Global(_) => self.file.scope(),
            VariableKind::FileArguments => self.file.top_level_scope(),
        }
    }

    /// `variable.defs`. Empty for a global variable and for `arguments`.
    pub fn declarations(self) -> impl Iterator<Item = Declaration<'a>> + 'a {
        let all = self.symbol().into_iter().flat_map(Symbol::declarations);
        all.filter(move |it| match (self.kind, it) {
            (VariableKind::NameInClass { class, .. }, Declaration::Class(it)) => class == *it,
            (VariableKind::NameInClass { .. }, _) => false,
            _ => true,
        })
    }

    /// `variable.references`, in the order of [`Symbol::references`].
    pub fn references(self) -> impl DoubleEndedIterator<Item = Reference<'a>> + 'a {
        let list = self.file.reference_list();
        let candidates = match self.symbol() {
            Some(symbol) => list.of_variable(symbol.index),
            None => list.unresolved_named(self.name().atom()),
        };
        // Every candidate matches, unless the name belongs to a class, or to a global variable that's only a type or
        // only a value.
        let is_all = match self.kind {
            VariableKind::Declared(symbol) => !is_class_name(symbol),
            VariableKind::FileArguments => true,
            VariableKind::NameInClass { .. } | VariableKind::Global(_) => false,
        };
        Reference::all_at(self.file, candidates)
            .filter(move |it| is_all || it.variable() == Some(self))
    }
}

impl<'a> File<'a> {
    /// Returns the global-scope variable `name` that the file doesn't declare: [`File::global`].
    pub fn global_variable(&'a self, name: &[u8]) -> Option<Variable<'a>> {
        self.global(name)?;
        let kind = VariableKind::Global(self.name(self.atoms.intern(name)));
        Some(Variable { file: self, kind })
    }
}

impl<'a> Symbol<'a> {
    /// Returns the variable this symbol is for code in `from`. Inside a class declaration that it names, that's the one
    /// in the class's scope.
    pub fn variable_in(self, from: Scope<'a>) -> Variable<'a> {
        let kind = match enclosing_class(self, from) {
            Some(class) => VariableKind::NameInClass { class, outer: self },
            None => VariableKind::Declared(self),
        };
        let file = self.file;
        Variable { file, kind }
    }
}

impl<'a> Reference<'a> {
    /// `reference.resolved`
    pub fn variable(self) -> Option<Variable<'a>> {
        let kind = match self.symbol() {
            Some(symbol) if is_class_name(symbol) => {
                return Some(symbol.variable_in(self.scope()));
            }
            Some(symbol) => VariableKind::Declared(symbol),
            None if self.raw().name == known::arguments && has_file_arguments(self.file) => {
                VariableKind::FileArguments
            }
            None => VariableKind::Global(self.global().map(|_| self.name())?),
        };
        let file = self.file;
        Some(Variable { file, kind })
    }
}

impl<'a> Scope<'a> {
    /// `scope.set.get(name)`
    pub fn variable(self, name: Name<'a>) -> Option<Variable<'a>> {
        let file = self.file;
        let class_name = || match self.node() {
            Node::Class(class) => class
                .symbol()
                .filter(|outer| outer.name() == name && outer.scope() != self)
                .map(|outer| VariableKind::NameInClass { class, outer }),
            _ => None,
        };
        let file_arguments = || {
            let is_arguments = name.atom() == known::arguments && has_file_arguments(file);
            (is_arguments && self == file.top_level_scope()).then_some(VariableKind::FileArguments)
        };
        let global = || {
            let is_defined = self.kind() == ScopeKind::Global && file.global_named(name).is_some();
            is_defined.then_some(VariableKind::Global(name))
        };
        let kind = class_name()
            .or_else(|| self.get_name(name).map(VariableKind::Declared))
            .or_else(file_arguments)
            .or_else(global)?;
        Some(Variable { file, kind })
    }

    /// eslint-utils' `findVariable(scope, name)`, ESLint's `getVariableByName`. Walks outward from this scope and
    /// returns the first variable with that name.
    pub fn find_variable(self, name: Name<'a>) -> Option<Variable<'a>> {
        self.chain().find_map(|it| it.variable(name))
    }
}
