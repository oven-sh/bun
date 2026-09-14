//! A C compiler frontend: C source -> BIR, the IR JavaScriptCore lowers to B3.
//!
//! Pipeline: `lexer` (bytes -> preprocessing tokens) -> `pp` (the preprocessor, token ->
//! token) -> `parser` (tokens -> typed AST, with `sema` deciding types and conversions) ->
//! `codegen` (typed AST -> `bir::Module`) -> `bir` (binary encoding, validation,
//! disassembly).

mod abi;
mod asm_stmt;
mod ast;
mod bir;
pub use bir::MAGIC as BIR_MAGIC;
mod codegen;
mod constexpr;
mod diagnostics;
mod extended;
mod files;
mod init;
mod lexer;
mod link;
mod parser;
mod pp;
mod pp_directive;
mod pp_expr;
mod pp_predef;
mod sema;
mod token;
mod types;
mod x86_encode;
mod x87;

use std::cell::RefCell;
use std::rc::Rc;

use bun_ast::{Kind, Log, Msg};

// The listing of each module made: `BUN_DEBUG_cc=1`.
bun_core::declare_scope!(cc, hidden);

use pp::{FileTable, Preprocessor, SearchDir};
pub use types::{Arch, Os, Target};

/// One translation unit: a C file and the path it is known by.
pub struct Unit<'a> {
    pub path: &'a str,
    pub contents: &'a [u8],
}

/// What compiling produced.
pub struct Compilation {
    /// The module; `None` when it could not be made, and the log says why (the first error of
    /// the first unit that has one).
    pub output: Option<Output>,
    /// Every file read that is not one of the system's headers: the sources and what they
    /// `#include`, whether or not compiling succeeded.
    pub files_read: Vec<String>,
}

pub struct Output {
    /// The serialized BIR module.
    pub bir: Vec<u8>,
    /// The functions JavaScript can call, in the order of the module's export table.
    pub exports: Vec<String>,
}

/// One translation unit after code generation.
struct Compiled {
    unit: codegen::Unit,
    /// For every entry of `unit.tls_externs`, what to say if nothing defines it.
    undefined_tls: Vec<Msg>,
}

/// Compiles the translation units for `target` and links them into one BIR module: a function or object one unit defines and another declares `extern` is resolved
/// inside the module, `static` names stay private to their unit, and tentative definitions of
/// one object merge. Defining a symbol twice is an error. Errors and warnings go to `log`.
pub fn compile(units: &[Unit<'_>], target: Target, log: &mut Log) -> Compilation {
    let mut files_read = Vec::new();
    let output = compile_and_link(units, target, log, &mut files_read);
    Compilation { output, files_read }
}

fn compile_and_link(
    units: &[Unit<'_>],
    target: Target,
    log: &mut Log,
    files_read: &mut Vec<String>,
) -> Option<Output> {
    let mut compiled = Vec::with_capacity(units.len());
    let mut undefined_tls = Vec::with_capacity(units.len());
    let names: Vec<String> = units.iter().map(|unit| unit.path.to_string()).collect();
    let system_include_dirs = files::system_include_dirs(target);
    for unit in units {
        files_read.push(unit.path.to_string());
        // (What `#include` would say of a file like it.)
        if unit.contents.len() as u64 > files::MAX_SOURCE_BYTES {
            let text = format!(
                "'{}' cannot be read: larger than {} bytes",
                unit.path,
                files::MAX_SOURCE_BYTES
            );
            diagnostics::add(
                log,
                diagnostics::message_in_file(Kind::Err, unit.path, text),
            );
            return None;
        }
        let one = compile_unit(unit, target, &system_include_dirs, log, files_read)?;
        compiled.push(one.unit);
        undefined_tls.push(one.undefined_tls);
    }
    let name_of = |unit: usize| names.get(unit).map_or("<no input>", String::as_str);
    let linked = match link::link(&compiled, &names) {
        Ok(linked) => linked,
        Err(e) => {
            // A use of a thread-local object nothing defines has a source location.
            let located = e.undefined_tls.and_then(|position| {
                let of_unit = undefined_tls.get_mut(e.unit)?;
                (position < of_unit.len()).then(|| of_unit.swap_remove(position))
            });
            let msg = match located {
                Some(msg) => msg,
                None => diagnostics::message_in_file(Kind::Err, name_of(e.unit), e.message),
            };
            diagnostics::add(log, msg);
            return None;
        }
    };
    if let Err(text) = bir::validate(&linked.module) {
        let text = format!("internal compiler error: the linker produced invalid BIR: {text}");
        let msg = diagnostics::message_in_file(Kind::Err, name_of(0), text);
        diagnostics::add(log, msg);
        return None;
    }
    for (unit, text) in linked.warnings {
        let msg = diagnostics::message_in_file(Kind::Warn, name_of(unit), text);
        diagnostics::add(log, msg);
    }
    bun_core::scoped_log!(
        cc,
        "{}",
        bir::disassemble(&linked.module).unwrap_or_else(|e| e)
    );
    Some(Output {
        bir: linked.module.encode(),
        exports: linked
            .module
            .exports
            .into_iter()
            .map(|export| export.name)
            .collect(),
    })
}

/// Compiles one translation unit to its in-memory module.
fn compile_unit(
    unit: &Unit<'_>,
    target: Target,
    system_include_dirs: &[String],
    log: &mut Log,
    files_read: &mut Vec<String>,
) -> Option<Compiled> {
    let files = Rc::new(RefCell::new(FileTable::default()));
    let compiled = compile_unit_with(unit, target, system_include_dirs, log, &files);
    files_read.append(&mut files.borrow_mut().read);
    compiled
}

fn compile_unit_with(
    unit: &Unit<'_>,
    target: Target,
    system_include_dirs: &[String],
    log: &mut Log,
    files: &Rc<RefCell<FileTable>>,
) -> Option<Compiled> {
    let filename = unit.path;
    let result = (|| {
        let tokens = preprocessor(unit.contents, filename, target, system_include_dirs, files);
        let mut program = parser::Parser::new(tokens, target)?.parse_program()?;
        files.borrow_mut().warnings.append(&mut program.warnings);
        codegen::generate(&program)
    })();
    let mut files = files.borrow_mut();
    for (loc, text) in std::mem::take(&mut files.warnings) {
        let msg = diagnostics::message(&files, Kind::Warn, loc, text, None);
        diagnostics::add(log, msg);
    }
    let mut unit = match result {
        Ok(unit) => unit,
        Err(e) => {
            let msg = diagnostics::message(&files, Kind::Err, e.loc, e.msg, e.note);
            diagnostics::add(log, msg);
            return None;
        }
    };
    unit.module.libraries.clone_from(&files.libraries);
    let module = &unit.module;
    if let Some(text) = link::past_the_loader(module.data.size, module.tls.size) {
        let msg = diagnostics::message_in_file(Kind::Err, filename, text);
        diagnostics::add(log, msg);
        return None;
    }
    if let Err(text) = bir::validate(&unit.module) {
        let text = format!("internal compiler error: generated invalid BIR: {text}");
        let msg = diagnostics::message_in_file(Kind::Err, filename, text);
        diagnostics::add(log, msg);
        return None;
    }
    let undefined_tls = unit
        .tls_externs
        .iter()
        .map(|t| {
            let text = format!(
                "thread-local variable '{}' is declared but not defined in any translation unit",
                t.name
            );
            diagnostics::message(&files, Kind::Err, t.loc, text, None)
        })
        .collect();
    Some(Compiled {
        unit,
        undefined_tls,
    })
}

fn preprocessor(
    source: &[u8],
    filename: &str,
    target: Target,
    system_include_dirs: &[String],
    files: &Rc<RefCell<FileTable>>,
) -> Preprocessor {
    // `<...>` headers, and `"..."` ones not found next to their includer: the compiler's own,
    // then the system's.
    let mut search: Vec<SearchDir> = vec![SearchDir::Builtin];
    for dir in system_include_dirs {
        search.push(SearchDir::Dir(Rc::from(dir.as_str())));
    }
    let mut pp = Preprocessor::new(Rc::clone(files), target, search, filename);
    pp.define_builtins();

    // Sources are stacked, so the last one pushed is read first.
    pp.push_source(filename, Rc::from(source), None, None);
    if target.os == Os::Windows {
        // What Microsoft's intrinsics do: see `parser_ms.rs`.
        let mut prelude = b"#define __BUN_MS(ret, name, params, ...) static __inline __attribute__((__always_inline__, __unused__)) ret __bun_ms_##name params __VA_ARGS__\n".to_vec();
        prelude.extend_from_slice(pp_directive::ms_intrinsics());
        prelude.extend_from_slice(b"\n#undef __BUN_MS\n");
        pp.push_source("<intrinsics>", Rc::from(prelude), None, None);
    }
    pp.push_source(
        "<built-in>",
        Rc::from(pp_predef::predefined_macros(target).as_bytes()),
        None,
        None,
    );
    pp
}
