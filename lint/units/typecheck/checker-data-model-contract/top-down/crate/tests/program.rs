//! A test target without the libtest harness: it links the package, reads a dump of TypeScript and answers on stdout.

#[path = "../src/native_test_shims.rs"]
mod native_test_shims;

use bun_typecheck_cdm::ast::file::IdAllocator;
use bun_typecheck_cdm::ast::open::Open;
use bun_typecheck_cdm::ast::reader::{Ast, Frozen};
use bun_typecheck_cdm::bindprobe::bind_probe;
use bun_typecheck_cdm::checker::checker::Checker;
use bun_typecheck_cdm::checker::flags_generated::TypeFlags;
use bun_typecheck_cdm::checker::program::{Program, ResolvedProgram};
use bun_typecheck_cdm::testimport::{ImportStats, import_dump};
use bun_typecheck_cdm::tscore::golang::{List, Map};
use bun_typecheck_cdm::tscore::stable::Arena;
use std::io::Write;

const DUMP: &[u8] = include_bytes!("../testdata/lib.decorators.legacy.d.ts.ast.json");

fn main() {
    let ids = IdAllocator::new();
    let mut stats = ImportStats::default();
    let Ok(files) = import_dump(DUMP, &ids, &mut stats) else {
        std::process::exit(1);
    };
    let mut symbols = 0;
    for file in &files {
        let root = file.source_file.root;
        file.bind_once(&ids, |a| {
            symbols += bind_probe(a, root).symbols;
        });
    }
    let borrowed: Vec<_> = files.iter().collect();
    let Ok(frozen) = Frozen::of_files(&borrowed) else {
        std::process::exit(1);
    };
    let arena = Arena::new();
    let open = Open::new(&arena, &ids);
    let a = Ast::new(&frozen, &open);
    let roots: Vec<_> = files.iter().map(|file| file.source_file.root).collect();
    let mut default_library_files = Map::make();
    for &root in &roots {
        let _ = default_library_files.set(root, true);
    }
    let program = ResolvedProgram {
        files: List::from_slice(arena.alloc_slice_copy(&roots)),
        default_library_files,
        ..Default::default()
    };
    let mut checker = Checker::zero(a, &arena, &program, bun_core::StackCheck::init());
    checker.files = program.source_files();
    checker.error_type = checker.new_intrinsic_type(TypeFlags::ANY, b"error");
    let libs = roots
        .iter()
        .filter(|root| checker.program.is_source_file_default_library(**root))
        .count();
    let mut out = std::io::stdout().lock();
    let _ = writeln!(
        out,
        "program: files {} libs {} symbols {} types {} faults {}",
        checker.files.len(),
        libs,
        symbols,
        checker.type_count,
        a.open().faults.count()
    );
    if libs != roots.len() || a.open().faults.count() != 0 {
        std::process::exit(1);
    }
}
