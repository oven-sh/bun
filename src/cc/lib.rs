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
use std::fmt;
use std::rc::Rc;

pub use files::system_include_dirs;
use pp::{FileTable, Preprocessor, SearchDir};
pub use types::{Arch, Os, Target};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Severity {
    #[default]
    Error,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagnostic {
    pub severity: Severity,
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub message: String,
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}:{}:{}: {}: {}",
            self.file,
            self.line,
            self.col,
            match self.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            },
            self.message
        )
    }
}

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

fn on_compiler_thread<T: Send>(
    filename: &str,
    work: impl FnOnce() -> T + Send,
) -> Result<T, Vec<Diagnostic>> {
    std::thread::scope(|scope| {
        let worker = std::thread::Builder::new()
            .name("bun-cc".to_string())
            .stack_size(COMPILER_STACK_BYTES)
            .spawn_scoped(scope, work);
        let failed = |message: String| {
            vec![Diagnostic {
                severity: Severity::Error,
                file: filename.to_string(),
                line: 0,
                col: 0,
                message,
            }]
        };
        match worker {
            Ok(handle) => handle
                .join()
                .map_err(|_| failed("internal compiler error: the compiler panicked".to_string())),
            Err(e) => Err(failed(format!("cannot start the compiler thread: {e}"))),
        }
    })
}

/// What compiling produced.
pub struct Compilation {
    /// The module, or what stopped the compiler. At most one error is reported per unit.
    pub result: Result<Output, Vec<Diagnostic>>,
    /// Every file read that is not one of the system's headers: the sources and what they
    /// `#include`, whether or not compiling succeeded.
    pub files_read: Vec<String>,
}

/// A successful compilation: the module plus anything the compiler wanted to say.
pub struct Output {
    /// The serialized BIR module.
    pub bir: Vec<u8>,
    /// Non-fatal diagnostics such as `#warning`, in source order.
    pub warnings: Vec<Diagnostic>,
    /// `#pragma comment(lib, "name")`: the shared libraries to search for the module's
    /// externs, in source order without duplicates. The same list is in the BIR.
    pub libraries: Vec<String>,
}

/// One translation unit after code generation.
struct Compiled {
    unit: codegen::Unit,
    warnings: Vec<Diagnostic>,
    /// For every entry of `unit.tls_externs`, what to say if nothing defines it.
    undefined_tls: Vec<Diagnostic>,
}

/// Compiles the translation units and links them into one BIR module: a function or object
/// one unit defines and another declares `extern` is resolved inside the module, `static`
/// names stay private to their unit, and tentative definitions of one object merge. Defining
/// a symbol twice is an error.
pub fn compile_many(units: &[(&[u8], &str)], options: &CompileOptions) -> Compilation {
    let mut files_read = Vec::new();
    let result = compile_and_link(units, options, &mut files_read);
    Compilation { result, files_read }
}

fn compile_and_link(
    units: &[(&[u8], &str)],
    options: &CompileOptions,
    files_read: &mut Vec<String>,
) -> Result<Output, Vec<Diagnostic>> {
    let link_error = |file: &str, message: String| Diagnostic {
        severity: Severity::Error,
        file: file.to_string(),
        line: 0,
        col: 0,
        message,
    };
    let mut compiled = Vec::with_capacity(units.len());
    let mut warnings = Vec::new();
    let mut undefined_tls = Vec::with_capacity(units.len());
    let names: Vec<String> = units.iter().map(|(_, name)| (*name).to_string()).collect();
    for (source, filename) in units {
        files_read.push((*filename).to_string());
        let one = compile_unit(source, filename, options, files_read)?;
        compiled.push(one.unit);
        warnings.extend(one.warnings);
        undefined_tls.push(one.undefined_tls);
    }
    let name_of = |unit: usize| names.get(unit).map_or("<no input>", String::as_str);
    let linked = match link::link(&compiled, &names) {
        Ok(linked) => linked,
        Err(e) => {
            // A use of a thread-local object nothing defines has a source location.
            let located = e
                .undefined_tls
                .and_then(|position| undefined_tls.get(e.unit)?.get(position).cloned());
            return Err(vec![
                located.unwrap_or_else(|| link_error(name_of(e.unit), e.message)),
            ]);
        }
    };
    if let Err(msg) = bir::validate(&linked.module) {
        return Err(vec![link_error(
            name_of(0),
            format!("internal compiler error: the linker produced invalid BIR: {msg}"),
        )]);
    }
    warnings.extend(
        linked
            .warnings
            .into_iter()
            .map(|(unit, message)| Diagnostic {
                severity: Severity::Warning,
                file: name_of(unit).to_string(),
                line: 0,
                col: 0,
                message,
            }),
    );
    Ok(Output {
        libraries: linked.module.libraries.clone(),
        bir: linked.module.encode(),
        warnings,
    })
}

/// Compiles one translation unit to its in-memory module.
fn compile_unit(
    source: &[u8],
    filename: &str,
    options: &CompileOptions,
    files_read: &mut Vec<String>,
) -> Result<Compiled, Vec<Diagnostic>> {
    let (result, mut read) = on_compiler_thread(filename, || {
        let files = Rc::new(RefCell::new(FileTable::default()));
        let result = compile_unit_with(source, filename, options, &files);
        let read = std::mem::take(&mut files.borrow_mut().read);
        (result, read)
    })?;
    files_read.append(&mut read);
    result
}

fn compile_unit_with(
    source: &[u8],
    filename: &str,
    options: &CompileOptions,
    files: &Rc<RefCell<FileTable>>,
) -> Result<Compiled, Vec<Diagnostic>> {
    let result = (|| {
        let tokens = preprocessor(source, filename, options, files)?;
        let mut program = parser::Parser::new(tokens, options.target)?
            .microsoft_c(is_microsoft_c(options))
            .parse_program()?;
        files.borrow_mut().warnings.append(&mut program.warnings);
        codegen::generate(&program)
    })();
    let mut unit = result.map_err(|e| diagnostic(&files.borrow(), e))?;
    unit.module.libraries.clone_from(&files.borrow().libraries);
    if let Err(msg) = bir::validate(&unit.module) {
        return Err(vec![Diagnostic {
            severity: Severity::Error,
            file: filename.to_string(),
            line: 0,
            col: 0,
            message: format!("internal compiler error: generated invalid BIR: {msg}"),
        }]);
    }
    let files = files.borrow();
    let warnings = files
        .warnings
        .iter()
        .map(|(loc, message)| Diagnostic {
            severity: Severity::Warning,
            file: files.name(loc.file).to_string(),
            line: loc.line,
            col: loc.col,
            message: message.clone(),
        })
        .collect();
    let undefined_tls = unit
        .tls_externs
        .iter()
        .map(|t| Diagnostic {
            severity: Severity::Error,
            file: files.name(t.loc.file).to_string(),
            line: t.loc.line,
            col: t.loc.col,
            message: format!(
                "thread-local variable '{}' is declared but not defined in any translation unit",
                t.name
            ),
        })
        .collect();
    Ok(Compiled {
        unit,
        warnings,
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
) -> Result<String, Vec<Diagnostic>> {
    on_compiler_thread(filename, || {
        let files = Rc::new(RefCell::new(FileTable::default()));
        let result = (|| {
            let tokens = preprocessor(source, filename, options, &files)?;
            let program = parser::Parser::new(tokens, options.target)?
                .microsoft_c(is_microsoft_c(options))
                .parse_program()?;
            Ok(dts::typescript_declarations(&program))
        })();
        result.map_err(|e| diagnostic(&files.borrow(), e))
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
    pp.push_source(filename, Rc::from(source), None);
    if options.target.os == Os::Windows {
        // What Microsoft's intrinsics do: see `parser_ms.rs`.
        let prelude = format!(
            "#define __BUN_MS(ret, name, params, ...) static __inline __attribute__((__always_inline__, __unused__)) ret __bun_ms_##name params __VA_ARGS__\n{}\n#undef __BUN_MS\n",
            pp_directive::MS_INTRINSICS
        );
        pp.push_source("<intrinsics>", Rc::from(prelude.as_bytes()), None);
    }
    pp.push_source(
        "<built-in>",
        Rc::from(pp_predef::predefined_macros(options.target, options.gnu_version).as_bytes()),
        None,
    );
    Ok(pp)
}

fn diagnostic(files: &FileTable, e: token::Error) -> Vec<Diagnostic> {
    vec![Diagnostic {
        severity: Severity::Error,
        file: files.name(e.loc.file).to_string(),
        line: e.loc.line,
        col: e.loc.col,
        message: e.msg,
    }]
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
