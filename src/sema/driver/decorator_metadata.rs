//! Checks the types in decorated signatures for the transpiler, which has one file: no libraries, no import resolves.

use bun_ast::Loc;
use bun_ast::ts::{CheckedTypeReference, TypeReferenceKind};
use bun_sema::atom::Interner;
use bun_sema::check::Program;
use bun_sema::check::decorator_metadata::TypeReferenceSerializationKind as Kind;
use bun_sema::hir;
use bun_sema::json::Json;
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{
    Host, ModuleDetection, ModuleKind, Options, ParseOptions, ScriptKind, ScriptTarget,
};
use bun_sema::session::{Arena, Session};
use std::borrow::Cow;

struct OneFile<'a> {
    path: &'static [u8],
    text: &'a [u8],
}

impl Host for OneFile<'_> {
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        (path == self.path).then(|| Cow::Owned(self.text.to_vec()))
    }
    fn is_file(&self, path: &[u8]) -> bool {
        path == self.path
    }
    fn is_dir(&self, path: &[u8]) -> bool {
        path == b"/"
    }
    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        path.to_vec()
    }
    fn list_dir(&self, _: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }
    fn script_kind(&self, _: &[u8]) -> Option<ScriptKind> {
        None
    }
    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &[]
    }
    fn scripts_of_page(&self, _: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }
    fn parse<'s>(
        &self,
        arena: &'s Arena,
        path: &[u8],
        text: &[u8],
        atoms: &Interner<'s>,
        options: ParseOptions,
    ) -> hir::File<'s> {
        bun_sema_parser::summarize(
            arena,
            path,
            None,
            text,
            atoms,
            options.experimental_decorators,
            options.module_detection == ModuleDetection::Force,
        )
    }
    fn parse_package_json(&self, _: &Arena, _: &[u8]) -> Option<Json> {
        None
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        (0..count).for_each(work);
    }
}

/// The type references in the signatures of decorated classes, sorted by position. For `bun_js_parser`.
#[unsafe(no_mangle)]
pub fn __bun_check_decorator_metadata(
    text: &[u8],
    is_tsx: bool,
    strict_null_checks: bool,
) -> Vec<CheckedTypeReference> {
    let path: &[u8] = if is_tsx { b"/file.tsx" } else { b"/file.ts" };
    let host = OneFile { path, text };
    let options = Options {
        base_dir: b"/".to_vec(),
        current_directory: b"/".to_vec(),
        no_lib: true,
        no_resolve: true,
        no_check: true,
        isolated_modules: true,
        types: Some(Vec::new()),
        target: ScriptTarget::ESNext,
        module: ModuleKind::EsNext,
        module_detection: ModuleDetection::Force,
        experimental_decorators: true,
        emit_decorator_metadata: true,
        strict_null_checks,
        ..Options::default()
    };
    let session = Session::new();
    let files = Files::load(&session, None, &host, options, &[path.to_vec()], &|_| ());
    let files = session.arena().alloc(files);
    let program = session.arena().alloc(Program::new(&session, files));
    let references = program.checker().decorator_metadata_references(FileId(0));
    program.release();
    let checked = references.into_iter().map(|it| CheckedTypeReference {
        loc: Loc {
            start: it.pos as i32,
        },
        kind: match it.kind {
            Kind::Unknown => TypeReferenceKind::Unknown,
            Kind::TypeWithConstructSignatureAndValue => {
                TypeReferenceKind::TypeWithConstructSignatureAndValue
            }
            Kind::VoidNullableOrNeverType => TypeReferenceKind::VoidNullableOrNever,
            Kind::NumberLikeType => TypeReferenceKind::Global(b"Number"),
            Kind::BigIntLikeType => TypeReferenceKind::Global(b"BigInt"),
            Kind::StringLikeType => TypeReferenceKind::Global(b"String"),
            Kind::BooleanType => TypeReferenceKind::Global(b"Boolean"),
            Kind::ArrayLikeType => TypeReferenceKind::Global(b"Array"),
            Kind::ESSymbolType => TypeReferenceKind::Global(b"Symbol"),
            Kind::Promise => TypeReferenceKind::Global(b"Promise"),
            Kind::TypeWithCallSignature => TypeReferenceKind::Global(b"Function"),
            Kind::ObjectType => TypeReferenceKind::Global(b"Object"),
        },
        keeps_import: it.marks_alias_as_referenced,
    });
    checked.collect()
}
