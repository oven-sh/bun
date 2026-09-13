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
mod codegen;
mod constexpr;
mod diagnostics;
mod dts;
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
mod unroll;
mod x86_encode;
mod x87;

use std::cell::RefCell;
use std::rc::Rc;

use bun_ast::{Kind, Log, Msg};

pub use files::system_include_dirs;
use pp::{FileTable, Preprocessor, SearchDir};
pub use types::{Arch, Os, Target};

pub struct CompileOptions {
    pub target: Target,
    /// Searched for `<...>` headers, and for `"..."` ones not found next to their includer, after
    /// the compiler's own headers.
    pub system_include_dirs: Vec<String>,
    /// Claim to be that GNU C, the way Clang claims 4.2.1, by predefining `__GNUC__` and the
    /// macros that go with it. Code written for GCC then takes its GCC paths (builtins,
    /// attributes, `always_inline`).
    pub gnu_version: Option<(u32, u32, u32)>,
}

impl CompileOptions {
    /// For compiling for `target` with the headers this machine has for it.
    pub fn new(target: Target) -> CompileOptions {
        CompileOptions {
            target,
            system_include_dirs: system_include_dirs(target),
            // Apple's SDK headers are written for a GNU C compatible compiler: without the claim
            // `NAN` is a call to a function that exists only on x86 and `va_list` is `void *`.
            gnu_version: if target.os == Os::MacOs {
                Some((9, 0, 0))
            } else {
                None
            },
        }
    }
}

/// A Windows target is compiled as Microsoft C (its predefined macros, its C runtime's own
/// standard headers, its `inline`) unless a GNU C version is claimed, the way MinGW does.
fn is_microsoft_c(options: &CompileOptions) -> bool {
    options.target.os == Os::Windows && options.gnu_version.is_none()
}

/// Stack for the compiler thread. The parser, code generator and AST destructors recurse
/// once per nesting level of the input; their depth limits (`parser::MAX_NESTING`,
/// `sema::MAX_EXPR_DEPTH`) are sized for this stack, not for whatever the caller has left.
const COMPILER_STACK_BYTES: usize = 64 << 20;

/// Runs `work` on a thread with [`COMPILER_STACK_BYTES`] of stack, or says in `log` why not.
fn on_compiler_thread<T: Send>(
    filename: &str,
    log: &mut Log,
    work: impl FnOnce(&mut Log) -> T + Send,
) -> Option<T> {
    let outcome = std::thread::scope(|scope| {
        let worker = std::thread::Builder::new()
            .name("bun-cc".to_string())
            .stack_size(COMPILER_STACK_BYTES)
            .spawn_scoped(scope, || work(&mut *log));
        match worker {
            Ok(handle) => handle
                .join()
                .map_err(|_| "internal compiler error: the compiler panicked".to_string()),
            Err(e) => Err(format!("cannot start the compiler thread: {e}")),
        }
    });
    match outcome {
        Ok(value) => Some(value),
        Err(text) => {
            let msg = diagnostics::message_in_file(Kind::Err, filename, text);
            diagnostics::add(log, msg);
            None
        }
    }
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
    /// `#pragma comment(lib, "name")`: the shared libraries to search for the module's
    /// externs, in source order without duplicates. The same list is in the BIR.
    pub libraries: Vec<String>,
}

/// One translation unit after code generation.
struct Compiled {
    unit: codegen::Unit,
    /// For every entry of `unit.tls_externs`, what to say if nothing defines it.
    undefined_tls: Vec<Msg>,
}

/// Compiles the translation units (contents and path of each) and links them into one BIR
/// module: a function or object one unit defines and another declares `extern` is resolved
/// inside the module, `static` names stay private to their unit, and tentative definitions of
/// one object merge. Defining a symbol twice is an error. Errors and warnings go to `log`.
pub fn compile_many(
    units: &[(&[u8], &str)],
    options: &CompileOptions,
    log: &mut Log,
) -> Compilation {
    let mut files_read = Vec::new();
    let output = compile_and_link(units, options, log, &mut files_read);
    Compilation { output, files_read }
}

fn compile_and_link(
    units: &[(&[u8], &str)],
    options: &CompileOptions,
    log: &mut Log,
    files_read: &mut Vec<String>,
) -> Option<Output> {
    let mut compiled = Vec::with_capacity(units.len());
    let mut undefined_tls = Vec::with_capacity(units.len());
    let names: Vec<String> = units.iter().map(|(_, name)| (*name).to_string()).collect();
    for (source, filename) in units {
        files_read.push((*filename).to_string());
        let one = compile_unit(source, filename, options, log, files_read)?;
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
    Some(Output {
        libraries: linked.module.libraries.clone(),
        bir: linked.module.encode(),
    })
}

/// Compiles one translation unit to its in-memory module.
fn compile_unit(
    source: &[u8],
    filename: &str,
    options: &CompileOptions,
    log: &mut Log,
    files_read: &mut Vec<String>,
) -> Option<Compiled> {
    let (compiled, mut read) = on_compiler_thread(filename, log, |log| {
        let files = Rc::new(RefCell::new(FileTable::default()));
        let compiled = compile_unit_with(source, filename, options, log, &files);
        let read = std::mem::take(&mut files.borrow_mut().read);
        (compiled, read)
    })?;
    files_read.append(&mut read);
    compiled
}

fn compile_unit_with(
    source: &[u8],
    filename: &str,
    options: &CompileOptions,
    log: &mut Log,
    files: &Rc<RefCell<FileTable>>,
) -> Option<Compiled> {
    let result = (|| {
        let tokens = preprocessor(source, filename, options, files)?;
        let mut program = parser::Parser::new(tokens, options.target)?
            .microsoft_c(is_microsoft_c(options))
            .parse_program()?;
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

/// TypeScript declarations (the text of a `.d.ts` file) for the functions the unit lets
/// JavaScript call: `export function name(a: number, p: Pointer | ...): number;` with the
/// C prototype as a doc comment, and a default export that has them all.
pub fn typescript_declarations(
    source: &[u8],
    filename: &str,
    options: &CompileOptions,
    log: &mut Log,
) -> Option<String> {
    on_compiler_thread(filename, log, |log| {
        let files = Rc::new(RefCell::new(FileTable::default()));
        let result = (|| {
            let tokens = preprocessor(source, filename, options, &files)?;
            let program = parser::Parser::new(tokens, options.target)?
                .microsoft_c(is_microsoft_c(options))
                .parse_program()?;
            Ok(dts::typescript_declarations(&program))
        })();
        match result {
            Ok(text) => Some(text),
            Err(e) => {
                let e: token::Error = e;
                let msg = diagnostics::message(&files.borrow(), Kind::Err, e.loc, e.msg, e.note);
                diagnostics::add(log, msg);
                None
            }
        }
    })?
}

fn preprocessor(
    source: &[u8],
    filename: &str,
    options: &CompileOptions,
    files: &Rc<RefCell<FileTable>>,
) -> token::Res<Preprocessor> {
    let mut search: Vec<SearchDir> = vec![SearchDir::Builtin];
    for dir in &options.system_include_dirs {
        search.push(SearchDir::Dir(Rc::from(dir.as_str())));
    }
    let mut pp = Preprocessor::new(Rc::clone(files), options.target, search, filename);
    pp.msvc = is_microsoft_c(options);
    pp.define_builtins();

    // Sources are stacked, so the last one pushed is read first.
    pp.push_source(filename, Rc::from(source), None, None);
    if options.target.os == Os::Windows {
        // What Microsoft's intrinsics do: see `parser_ms.rs`.
        let prelude = format!(
            "#define __BUN_MS(ret, name, params, ...) static __inline __attribute__((__always_inline__, __unused__)) ret __bun_ms_##name params __VA_ARGS__\n{}\n#undef __BUN_MS\n",
            pp_directive::MS_INTRINSICS
        );
        pp.push_source("<intrinsics>", Rc::from(prelude.as_bytes()), None, None);
    }
    pp.push_source(
        "<built-in>",
        Rc::from(pp_predef::predefined_macros(options.target, options.gnu_version).as_bytes()),
        None,
        None,
    );
    Ok(pp)
}

/// Decodes and checks a serialized BIR module.
pub fn validate(bir: &[u8]) -> Result<(), String> {
    bir::validate(&bir::Module::decode(bir)?)
}

/// The names a serialized BIR module exports to JavaScript, in table order.
pub fn export_names(bir: &[u8]) -> Result<Vec<String>, String> {
    Ok(bir::Module::decode(bir)?
        .exports
        .into_iter()
        .map(|export| export.name)
        .collect())
}

/// Renders a serialized BIR module as text.
pub fn disassemble(bir: &[u8]) -> Result<String, String> {
    bir::disassemble(&bir::Module::decode(bir)?)
}
