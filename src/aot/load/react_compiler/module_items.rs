use bun_core::fmt::{ItoaBuf, itoa};
use bun_lint_react_compiler::code_generation::{GeneratedSymbol, SymbolOrigin};
use bun_react_compiler::JsxImportKind;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::hir::{
    Call, Chain, ExprId, ExprKind, FileBuilder, Flags, Import, ImportId, ImportSpec, ListAt,
    PatKind, ResolutionMode, StmtId, StmtKind, TextRange, TypeNodeId, VarDecl, VarKind,
};
use bun_sema::import_sites::JsxImport;
use bun_sema::resolve::JsxSettings;
use std::borrow::Cow;

const NAME_PREFIX: &[u8] = b"%react:";
const SYMBOL_KEY_PREFIX: &[u8] = b"react.";
const MEMO_CACHE_SENTINEL: &[u8] = b"memo_cache_sentinel";
const EARLY_RETURN_SENTINEL: &[u8] = b"early_return_sentinel";

#[derive(Default)]
pub(super) struct ModuleItems {
    imports: Vec<ModuleImport>,
    needs_memo_cache_sentinel: bool,
    needs_early_return_sentinel: bool,
    pub(super) outlined: Vec<StmtId>,
    outlined_count: u32,
}

struct ModuleImport {
    path: Box<[u8]>,
    imported: Box<[u8]>,
    local: Atom,
}

impl ModuleItems {
    pub(super) fn name_of(
        &mut self,
        atoms: &Interner<'_>,
        jsx: &JsxSettings,
        symbol: &GeneratedSymbol,
    ) -> Atom {
        match symbol.origin {
            SymbolOrigin::Source | SymbolOrigin::Local => atoms.intern(&symbol.name),
            SymbolOrigin::ImportItem => intern_item_name(atoms, b"import:", &symbol.name),
            SymbolOrigin::JsxImport(kind) => self.name_jsx_import(atoms, jsx, jsx_import_of(kind)),
            SymbolOrigin::MemoCacheSentinel => {
                self.needs_memo_cache_sentinel = true;
                intern_item_name(atoms, MEMO_CACHE_SENTINEL, b"")
            }
            SymbolOrigin::EarlyReturnSentinel => {
                self.needs_early_return_sentinel = true;
                intern_item_name(atoms, EARLY_RETURN_SENTINEL, b"")
            }
            SymbolOrigin::Outlined => {
                let mut digits = ItoaBuf::new();
                let number = itoa(&mut digits, self.outlined_count);
                self.outlined_count += 1;
                intern_item_name(atoms, b"outlined:", number)
            }
            SymbolOrigin::ImportNamespace => intern_item_name(atoms, b"namespace:", &symbol.name),
            SymbolOrigin::ClassicFactory | SymbolOrigin::ClassicFragment => {
                intern_item_name(atoms, b"classic:", &symbol.name)
            }
        }
    }

    pub(super) fn name_shadowing_local(atoms: &Interner<'_>, symbol: &GeneratedSymbol) -> Atom {
        intern_item_name(atoms, b"local:", &symbol.name)
    }

    pub(super) fn add_import(&mut self, path: &[u8], imported: &[u8], local: Atom) {
        if let Some(existing) = self.imports.iter().find(|import| import.local == local) {
            debug_assert!(*existing.path == *path && *existing.imported == *imported);
            return;
        }
        self.imports.push(ModuleImport {
            path: path.into(),
            imported: imported.into(),
            local,
        });
    }

    pub(super) fn write(
        &mut self,
        file: &mut FileBuilder,
        atoms: &Interner<'_>,
        position: u32,
    ) -> (Vec<StmtId>, Vec<StmtId>) {
        // Every function names the `Fragment` import, also one without a fragment.
        self.imports.retain(|import| is_referenced(file, import.local));
        let mut before = Vec::new();
        for (index, first) in self.imports.iter().enumerate() {
            let (earlier, rest) = self.imports.split_at(index);
            if earlier.iter().any(|import| import.path == first.path) {
                continue;
            }
            let from_path = rest.iter().filter(|import| import.path == first.path);
            before.push(write_import(file, atoms, &first.path, from_path, position));
        }
        if !before.is_empty() {
            file.has_module_syntax = true;
            file.is_forced_module = false;
        }
        if self.needs_memo_cache_sentinel {
            before.push(write_sentinel(file, atoms, MEMO_CACHE_SENTINEL, position));
        }
        if self.needs_early_return_sentinel {
            before.push(write_sentinel(file, atoms, EARLY_RETURN_SENTINEL, position));
        }
        (before, std::mem::take(&mut self.outlined))
    }

    fn name_jsx_import(
        &mut self,
        atoms: &Interner<'_>,
        jsx: &JsxSettings,
        import: JsxImport,
    ) -> Atom {
        let local = intern_item_name(atoms, import.export_name(), b"");
        let path: Cow<'_, [u8]> = match import {
            JsxImport::Jsx | JsxImport::Jsxs | JsxImport::JsxDev | JsxImport::Fragment => {
                Cow::Owned(jsx.runtime_specifier())
            }
            JsxImport::CreateElement => Cow::Borrowed(jsx.import_source.as_slice()),
        };
        self.add_import(&path, import.export_name(), local);
        local
    }
}

fn jsx_import_of(kind: JsxImportKind) -> JsxImport {
    match kind {
        JsxImportKind::Jsx => JsxImport::Jsx,
        JsxImportKind::Jsxs => JsxImport::Jsxs,
        JsxImportKind::JsxDEV => JsxImport::JsxDev,
        JsxImportKind::Fragment => JsxImport::Fragment,
        JsxImportKind::CreateElement => JsxImport::CreateElement,
    }
}

fn intern_item_name(atoms: &Interner<'_>, item: &[u8], detail: &[u8]) -> Atom {
    atoms.intern(&[NAME_PREFIX, item, detail].concat())
}

fn is_referenced(file: &FileBuilder, name: Atom) -> bool {
    let mut expressions = file.exprs.iter();
    expressions.any(|it| matches!(it.kind, ExprKind::Ident(written) if written == name))
}

fn add_statement(file: &mut FileBuilder, kind: StmtKind, position: u32) -> StmtId {
    let statement = file.stmt(kind, position);
    file[statement].loc = TextRange {
        pos: position,
        end: position,
    };
    statement
}

fn add_member(file: &mut FileBuilder, object: ExprId, name: Atom, position: u32) -> ExprId {
    let kind = file.dot((object, Chain::No), (name, position), position);
    file.expr(kind, position, position)
}

fn write_import<'i>(
    file: &mut FileBuilder,
    atoms: &Interner<'_>,
    path: &[u8],
    imports: impl Iterator<Item = &'i ModuleImport>,
    position: u32,
) -> StmtId {
    let import = ImportId(file.imports.len() as u32);
    let specifiers: Vec<ImportSpec> = imports
        .map(|item| ImportSpec {
            start: position,
            imported: atoms.intern(&item.imported),
            local: item.local,
            pos: position,
            type_only: false,
            imported_pos: position,
            end: position,
            import,
        })
        .collect();
    let named = file.add_import_specs(&specifiers);
    let added = file.add_import(Import {
        spec: atoms.intern(path),
        default: Atom::NONE,
        default_pos: position,
        namespace: Atom::NONE,
        namespace_pos: position,
        clause_start: position,
        clause_end: position,
        namespace_start: position,
        named,
        has_named_imports: true,
        type_only: false,
        is_deferred: false,
        mode: ResolutionMode::None,
        stmt: StmtId::NONE,
        attributes: ExprId::NONE,
    });
    debug_assert_eq!(added, import);
    add_statement(file, StmtKind::Import(import), position)
}

fn write_sentinel(
    file: &mut FileBuilder,
    atoms: &Interner<'_>,
    sentinel: &[u8],
    position: u32,
) -> StmtId {
    let global = file.expr(ExprKind::Ident(known::globalThis), position, position);
    let constructor = add_member(file, global, known::Symbol, position);
    let callee = add_member(file, constructor, atoms.intern(b"for"), position);
    let key = atoms.intern(&[SYMBOL_KEY_PREFIX, sentinel].concat());
    let key = file.expr(ExprKind::String(key), position, position);
    let args = file.list(&[key]);
    let call = file.add_call(Call {
        callee,
        args,
        type_args: ListAt::EMPTY,
        close_pos: position,
        chain: Chain::No,
        is_pure: false,
    });
    let init = file.expr(ExprKind::Call(call), position, position);
    let name = intern_item_name(atoms, sentinel, b"");
    let pat = file.pat(PatKind::Ident(name), position, position);
    let declarations = file.add_var_decls(&[VarDecl {
        pat,
        ty: TypeNodeId::NONE,
        init,
        kind: VarKind::Const,
        flags: Flags::empty(),
        loc: TextRange {
            pos: position,
            end: position,
        },
    }]);
    add_statement(file, StmtKind::Var(declarations), position)
}
