//! Libraries that the toolchain vouches for, as it does for what the engine implements: see `trust.rs`.
//!
//! A library is JavaScript behind declarations without bodies, so what it yields is a prediction. Not where an entry here says what the
//! library does with what the program hands it. Then the export is trusted like a built-in: a call of it yields what it is declared to
//! yield, which is tested where it comes out, and a callback is called with what it is declared to take.
//!
//! An entry is found by the module specifier and the name of the export, as the program imports them. Another library is more data.

use super::storage::Recovery;
use crate::atom::{Atom, known};
use crate::bind::{Decl, SymFlags};
use crate::check::Checker;
use crate::hir::{Chain, ExprId, ExprKind, ImportEqualsTarget};
use crate::program::{FileId, Sym};

/// What an export does with what the program hands it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Vouched {
    /// It keeps what the program puts in, and yields that, like `Map.get`. What comes out is asserted to be of the declared type, which
    /// the program supplied by an argument or a type argument. Only a library that breaks its contract, or a wrong type argument, throws.
    Container,
    /// A container that may forget what it kept. So there is something to go on with where the wrong thing comes out, and nothing throws.
    Cache(Recovery),
}

pub(super) struct Export {
    name: &'static str,
    pub(super) what: Vouched,
    /// The positions of the arguments that the library calls with values of its own making, which nothing here vouches for: see
    /// `Checker::is_host_callback`.
    pub(super) host_callbacks: &'static [usize],
}

const fn container(name: &'static str) -> Export {
    Export { name, what: Vouched::Container, host_callbacks: &[] }
}

const fn cache(name: &'static str, recovery: Recovery) -> Export {
    Export { name, what: Vouched::Cache(recovery), host_callbacks: &[] }
}

const LIBRARIES: &[(&str, &[Export])] = &[(
    "react",
    // Not `createContext`, `memo`, `forwardRef`, `lazy`: they are declared to yield something that can be called, and yield plain objects, which
    // nobody calls. Those stay predictions. What `useContext` yields has its type from the checker's type of the context all the same.
    &[
        container("use"),
        container("useActionState"),
        cache("useCallback", Recovery::Argument),
        container("useContext"),
        container("useDeferredValue"),
        container("useId"),
        cache("useMemo", Recovery::CallArgument),
        container("useOptimistic"),
        container("useReducer"),
        container("useRef"),
        container("useState"),
        // `subscribe` is handed a function of React's.
        Export { name: "useSyncExternalStore", what: Vouched::Container, host_callbacks: &[0] },
        container("useTransition"),
    ],
)];

impl<'p, 's> Checker<'p, 's> {
    /// The entry for what the expression names: `useState` or an alias of it, imported from a module that has entries, or `React.useState`,
    /// where `React` is the namespace, the default export or the `import =` of such a module.
    pub(super) fn vouched_export(&mut self, file: FileId, e: ExprId) -> Option<&'static Export> {
        let hir = self.hir(file);
        let (module, name) = match hir[e].kind {
            ExprKind::Ident(local) => {
                let import = self.symbol_of_identifier(file, e, local)?;
                let (module, name) = self.module_and_name_imported_by(import)?;
                (module, name.filter(|&name| name != known::default)?)
            }
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => {
                let ExprKind::Ident(local) = hir[obj].kind else { return None };
                let import = self.symbol_of_identifier(file, obj, local)?;
                let (module, whole) = self.module_and_name_imported_by(import)?;
                if whole.is_some_and(|whole| whole != known::default) {
                    return None;
                }
                (module, name)
            }
            _ => return None,
        };
        if module.is_none() || name.is_none() {
            return None;
        }
        let (module, name) = (self.atoms().bytes(module), self.atoms().bytes(name));
        let exports = LIBRARIES.iter().find(|library| library.0.as_bytes() == module)?.1;
        exports.iter().find(|export| export.name.as_bytes() == name)
    }

    /// The module specifier of the import declaration that declares the symbol, and the name it imports. No name: the namespace.
    fn module_and_name_imported_by(&self, import: Sym) -> Option<(Atom, Option<Atom>)> {
        if !self.files.flags(import).contains(SymFlags::ALIAS) {
            return None;
        }
        self.files.decls(import).into_iter().find_map(|(file, decl)| {
            let hir = self.hir(file);
            match decl {
                Decl::ImportDefault(import) => Some((hir[import].spec, Some(known::default))),
                Decl::ImportNamespace(import) => Some((hir[import].spec, None)),
                Decl::ImportSpec(spec) => Some((hir[hir[spec].import].spec, Some(hir[spec].imported))),
                Decl::ImportEquals(import) => match hir[import].target {
                    ImportEqualsTarget::Require(module) if module.is_some() => Some((module, None)),
                    _ => None,
                },
                _ => None,
            }
        })
    }
}
