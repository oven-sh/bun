use crate::bind::{Decl, SymFlags};
use crate::check::{Checker, Program};
use crate::hir::{TypeNodeId, TypeNodeKind};
use crate::program::{FileId, Files, Sym};
use crate::types::{SigData, SigId};
use smallvec::SmallVec;

pub const COMPILER_DECLARATIONS_PATH: &[u8] = b"/$bun/types/compiler.d.ts";

pub(in crate::check) struct ProgramSymbols {
    compiler_declarations: Option<FileId>,
    int32: Option<Sym>,
    int32_tag: Option<(FileId, TypeNodeId)>,
}

impl ProgramSymbols {
    fn resolve(files: &Files<'_>) -> ProgramSymbols {
        let declared_in = files.by_path.get(COMPILER_DECLARATIONS_PATH);
        let mut symbols = ProgramSymbols {
            compiler_declarations: declared_in,
            int32: None,
            int32_tag: None,
        };
        let bun_module = files
            .atoms
            .lookup(b"bun")
            .and_then(|name| files.try_find_ambient_module(name));
        let Some(bun_module) = bun_module else {
            return symbols;
        };
        symbols.int32 = find_type_alias(files, bun_module, b"int32", declared_in);
        symbols.int32_tag = symbols
            .int32
            .and_then(|int32| find_tag_literal(files, int32));
        symbols
    }

    pub(super) fn int32_alias(&self) -> Option<Sym> {
        self.int32
    }

    pub(super) fn is_int32_tag(&self, file: FileId, literal: TypeNodeId) -> bool {
        self.int32_tag == Some((file, literal))
    }
}

fn find_export(
    files: &Files<'_>,
    container: Sym,
    name: &[u8],
    declared_in: Option<FileId>,
) -> Option<Sym> {
    let name = files.atoms.lookup(name)?;
    let Some(file) = declared_in else {
        return files.export(container, name);
    };
    let parts = files.parts(container);
    let part = parts.iter().find(|part| part.file == file)?;
    let bound = files.bound(file);
    let id = bound.lookup(bound.symbol(part.id).exports, name)?;
    Some(Sym { file, id })
}

fn find_type_alias(
    files: &Files<'_>,
    container: Sym,
    name: &[u8],
    declared_in: Option<FileId>,
) -> Option<Sym> {
    let alias = find_export(files, container, name, declared_in)?;
    files
        .flags(alias)
        .contains(SymFlags::TYPE_ALIAS)
        .then(|| files.canonical(alias))
}

fn find_tag_literal(files: &Files<'_>, int32: Sym) -> Option<(FileId, TypeNodeId)> {
    let declarations = files.decls_of(int32);
    let (file, alias) = declarations.iter().find_map(|&(file, decl)| match decl {
        Decl::Alias(alias) => Some((file, alias)),
        _ => None,
    })?;
    let hir = files.hir(file);
    let TypeNodeKind::Intersection(parts) = hir[hir[alias].ty].kind else {
        return None;
    };
    let mut literals = hir
        .ids(parts)
        .filter(|&part| matches!(hir[part].kind, TypeNodeKind::Object(_)));
    let literal = literals.next()?;
    literals.next().is_none().then_some((file, literal))
}

impl Checker<'_, '_> {
    pub(in crate::check) fn remove_compiler_signatures(
        &self,
        signatures: &mut SmallVec<[SigId; 4]>,
    ) {
        let Some(compiler_declarations) = self.p.aot_symbols().compiler_declarations else {
            return;
        };
        let is_of_program = |&signature: &SigId| {
            let declaration = self.types().sig(signature);
            !matches!(*declaration, SigData::Decl { file, .. } if file == compiler_declarations)
        };
        if signatures.iter().any(is_of_program) {
            signatures.retain(|signature| is_of_program(signature));
        }
    }
}

impl<'s> Program<'s> {
    pub(in crate::check) fn aot_symbols(&self) -> &ProgramSymbols {
        self.aot_symbols
            .get_or_init(|| ProgramSymbols::resolve(self.files))
    }
}
