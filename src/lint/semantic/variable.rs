//! ESLint's `Variable`, one for one: see [the guide](super#eslints-variables).

use super::{Declaration, DeclarationKinds, Reference, Scope, ScopeKind, Symbol};
use crate::ast::{Class, File, Name, Node};
use crate::language::SourceType;
use crate::utils::oxlint::source_type;
use bun_sema::atom::known;

/// What a [`Variable`] is here.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum VariableKind<'a> {
    /// What the file declares. For the name of a class declaration: the variable in the scope around the class.
    Declared(Symbol<'a>),
    /// The variable that a class declaration has for its name in its own scope, which is what the name means in the class.
    /// `outer`: the symbol, which is in the scope around.
    NameInClass { class: Class<'a>, outer: Symbol<'a> },
    /// A variable of the global scope that the file does not declare: [`File::global`].
    Global(Name<'a>),
    /// With a configuration of oxlint, the `arguments` at the top level of a file that is CommonJS by its name. For
    /// typescript-eslint that is the scope of a function.
    ArgumentsOfFile,
}

/// ESLint's `Variable`. From [`Reference::variable`], [`Scope::variable`] and [`Scope::find_variable`].
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
fn is_name_of_class(symbol: Symbol) -> bool {
    (symbol.declaration_kinds()).contains(DeclarationKinds::CLASS_NAME)
}

/// The class declaration that declares `symbol` and that `from` is in.
fn class_around<'a>(symbol: Symbol<'a>, from: Scope<'a>) -> Option<Class<'a>> {
    if !is_name_of_class(symbol) {
        return None;
    }
    let declared_in = symbol.scope();
    symbol.declarations().find_map(|it| match it {
        // The name of a class expression is declared in the scope of the class, once.
        Declaration::Class(class) => (class.scope())
            .filter(|inside| *inside != declared_in && inside.contains(from))
            .map(|_| class),
        _ => None,
    })
}

fn has_arguments_of_file<'a>(file: &'a File<'a>) -> bool {
    file.language().is_oxlint && source_type(file) == SourceType::CommonJs
}

impl<'a> Variable<'a> {
    #[inline]
    pub fn kind(self) -> VariableKind<'a> {
        self.kind
    }

    /// What the file declares under the name, if anything. In a class that is the symbol around it.
    pub fn symbol(self) -> Option<Symbol<'a>> {
        match self.kind {
            VariableKind::Declared(symbol) | VariableKind::NameInClass { outer: symbol, .. } => {
                Some(symbol)
            }
            VariableKind::Global(_) | VariableKind::ArgumentsOfFile => None,
        }
    }

    /// `variable.name`
    pub fn name(self) -> Name<'a> {
        match self.kind {
            VariableKind::Declared(symbol) | VariableKind::NameInClass { outer: symbol, .. } => {
                symbol.name()
            }
            VariableKind::Global(name) => name,
            VariableKind::ArgumentsOfFile => self.file.name(known::arguments),
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
            VariableKind::ArgumentsOfFile => self.file.top_level_scope(),
        }
    }

    /// `variable.defs`. A global variable and an `arguments` have none.
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
        // All of them, unless the name is that of a class, or of a global variable that is only a type or only a value.
        let is_all = match self.kind {
            VariableKind::Declared(symbol) => !is_name_of_class(symbol),
            VariableKind::ArgumentsOfFile => true,
            VariableKind::NameInClass { .. } | VariableKind::Global(_) => false,
        };
        Reference::all_at(self.file, candidates)
            .filter(move |it| is_all || it.variable() == Some(self))
    }
}

impl<'a> File<'a> {
    /// The variable of the global scope that the file does not declare: [`File::global`].
    pub fn global_variable(&'a self, name: &[u8]) -> Option<Variable<'a>> {
        self.global(name)?;
        let kind = VariableKind::Global(self.name(self.atoms.intern(name)));
        Some(Variable { file: self, kind })
    }
}

impl<'a> Symbol<'a> {
    /// The variable that it is for what is written in `from`: in a class declaration that it is the name of, the one in the scope
    /// of the class.
    pub fn variable_in(self, from: Scope<'a>) -> Variable<'a> {
        let kind = match class_around(self, from) {
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
            Some(symbol) if is_name_of_class(symbol) => {
                return Some(symbol.variable_in(self.scope()));
            }
            Some(symbol) => VariableKind::Declared(symbol),
            None if self.raw().name == known::arguments && has_arguments_of_file(self.file) => {
                VariableKind::ArgumentsOfFile
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
        let name_of_class = || match self.node() {
            Node::Class(class) => class
                .symbol()
                .filter(|outer| outer.name() == name && outer.scope() != self)
                .map(|outer| VariableKind::NameInClass { class, outer }),
            _ => None,
        };
        let of_file = || {
            let is_arguments = name.atom() == known::arguments && has_arguments_of_file(file);
            (is_arguments && self == file.top_level_scope())
                .then_some(VariableKind::ArgumentsOfFile)
        };
        let global = || {
            let is_defined = self.kind() == ScopeKind::Global && file.global_named(name).is_some();
            is_defined.then_some(VariableKind::Global(name))
        };
        let kind = name_of_class()
            .or_else(|| self.get_name(name).map(VariableKind::Declared))
            .or_else(of_file)
            .or_else(global)?;
        Some(Variable { file, kind })
    }

    /// eslint-utils' `findVariable(scope, name)`, ESLint's `getVariableByName`: the first of the scopes from this one outwards
    /// that has a variable of that name decides.
    pub fn find_variable(self, name: Name<'a>) -> Option<Variable<'a>> {
        self.chain().find_map(|it| it.variable(name))
    }
}
