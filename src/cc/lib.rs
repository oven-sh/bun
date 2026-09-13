//! A C compiler frontend: C source -> BIR, the IR JavaScriptCore lowers to B3.
//!
//! Pipeline: `lexer` (bytes -> preprocessing tokens) -> `pp` (the preprocessor, token ->
//! token) -> `parser` (tokens -> typed AST, with `sema` deciding types and conversions) ->
//! `codegen` (typed AST -> `bir::Module`) -> `bir` (binary encoding, validation,
//! disassembly).
//!
//! This crate depends on Rust `std` only so that `bun-cc` links standalone.

mod abi;
mod asm_stmt;
mod ast;
mod bir;
mod codegen;
mod constexpr;
mod dts;
mod extended;
mod init;
mod lexer;
mod link;
mod parser;
mod pp;
mod pp_directive;
mod pp_expr;
mod pp_predef;
mod sema;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_phase13;
#[cfg(test)]
mod tests_phase14;
#[cfg(test)]
mod tests_phase2;
#[cfg(test)]
mod tests_phase3;
#[cfg(test)]
mod tests_phase4;
#[cfg(test)]
mod tests_phase5;
#[cfg(test)]
mod tests_phase5_atomics;
#[cfg(test)]
mod tests_phase6;
#[cfg(test)]
mod tests_phase6_link;
#[cfg(test)]
mod tests_phase7;
#[cfg(test)]
mod tests_phase8;
mod token;
mod types;
mod unroll;
mod x86_encode;
mod x87;

use std::cell::RefCell;
use std::fmt;
use std::rc::Rc;

pub use pp::FileProvider;
use pp::{FileTable, Preprocessor, SearchDir};
use token::{PpKind, TokenSource};
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

/// A [`FileProvider`] with no files: every `#include` of a non-builtin header fails.
pub struct NoFiles;

impl FileProvider for NoFiles {
    fn read(&self, _path: &str) -> Option<Vec<u8>> {
        None
    }
}

/// A [`FileProvider`] backed by the host file system.
pub struct HostFiles;

impl FileProvider for HostFiles {
    // This crate is std-only by design, so it reads files with std rather than bun_sys.
    #[allow(clippy::disallowed_methods)]
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        std::fs::read(path).ok()
    }
}

pub struct CompileOptions<'a> {
    pub target: Target,
    /// `-I`: searched for both `"..."` and `<...>`, before everything else.
    pub include_dirs: Vec<String>,
    /// `-isystem` and the platform's default directories, searched after the compiler's
    /// own headers.
    pub system_include_dirs: Vec<String>,
    /// `-D name` / `-D name=value`.
    pub defines: Vec<(String, Option<String>)>,
    /// `-U name`, applied after `defines`.
    pub undefines: Vec<String>,
    /// `-fgnuc-version=major.minor.patch`: claim to be that GNU C, the way Clang claims
    /// 4.2.1, by predefining `__GNUC__` and the macros that go with it. Code written for
    /// GCC then takes its GCC paths (builtins, attributes, `always_inline`).
    pub gnu_version: Option<(u32, u32, u32)>,
    /// `-fno-replace-aggregates` clears it: local arrays and structures then always live
    /// in memory, and no loop is unrolled to make them replaceable.
    pub replace_aggregates: bool,
    pub file_provider: &'a (dyn FileProvider + Sync),
}

impl CompileOptions<'_> {
    pub fn new(target: Target) -> CompileOptions<'static> {
        CompileOptions {
            target,
            include_dirs: Vec::new(),
            system_include_dirs: Vec::new(),
            defines: Vec::new(),
            undefines: Vec::new(),
            // Apple's SDK headers are written for a GNU C compatible compiler: without the claim
            // `NAN` is a call to a function that exists only on x86 and `va_list` is `void *`.
            gnu_version: if target.os == Os::MacOs {
                Some((9, 0, 0))
            } else {
                None
            },
            replace_aggregates: true,
            file_provider: &NoFiles,
        }
    }
}

/// The directories a hosted compiler searches for `<...>` headers on this machine.
pub fn default_system_include_dirs(target: Target) -> Vec<String> {
    if target.os == Os::MacOs && cfg!(target_os = "macos") {
        // The C library's headers are in the SDK, which `xcrun --show-sdk-path` would name; these
        // are the places it names. (A caller that honours `SDKROOT` adds that one itself.)
        let roots = [
            "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
            "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
        ];
        let mut dirs: Vec<String> = ["/usr/local/include", "/opt/homebrew/include"]
            .into_iter()
            .filter(|dir| std::path::Path::new(dir).is_dir())
            .map(str::to_string)
            .collect();
        if let Some(root) = roots
            .into_iter()
            .find(|root| std::path::Path::new(&format!("{root}/usr/include/stdio.h")).is_file())
        {
            dirs.push(format!("{root}/usr/include"));
        }
        return dirs;
    }
    if target.os != Os::Linux || !cfg!(target_os = "linux") {
        return Vec::new();
    }
    let multiarch = match target.arch {
        Arch::X86_64 => "/usr/include/x86_64-linux-gnu",
        Arch::Aarch64 => "/usr/include/aarch64-linux-gnu",
    };
    ["/usr/local/include", multiarch, "/usr/include"]
        .into_iter()
        .filter(|dir| std::path::Path::new(dir).is_dir())
        .map(str::to_string)
        .collect()
}

/// Stack for the compiler thread. The parser, code generator and AST destructors recurse
/// once per nesting level of the input; their depth limits (`parser::MAX_NESTING`,
/// `sema::MAX_EXPR_DEPTH`) are sized for this stack, not for whatever the caller has left.
const COMPILER_STACK_BYTES: usize = 64 << 20;

fn on_compiler_thread<T: Send>(
    filename: &str,
    work: impl FnOnce() -> Result<T, Vec<Diagnostic>> + Send,
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
            Ok(handle) => handle.join().unwrap_or_else(|_| {
                Err(failed(
                    "internal compiler error: the compiler panicked".to_string(),
                ))
            }),
            Err(e) => Err(failed(format!("cannot start the compiler thread: {e}"))),
        }
    })
}

/// Compiles one C translation unit to a serialized BIR module, with no include path.
pub fn compile(source: &[u8], filename: &str, target: Target) -> Result<Vec<u8>, Vec<Diagnostic>> {
    compile_with(source, filename, &CompileOptions::new(target))
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
    /// How many local arrays and structures the compiler replaced by their elements (a
    /// statistic, for `bun-cc --stats`).
    pub replaced_aggregates: usize,
    /// How many byte-by-byte reads and writes of an integer became one load, one store.
    pub combined_accesses: (usize, usize),
}

/// One translation unit after code generation.
struct Compiled {
    unit: codegen::Unit,
    warnings: Vec<Diagnostic>,
    /// For every entry of `unit.tls_externs`, what to say if nothing defines it.
    undefined_tls: Vec<Diagnostic>,
}

/// Compiles one C translation unit to a serialized BIR module.
pub fn compile_with(
    source: &[u8],
    filename: &str,
    options: &CompileOptions<'_>,
) -> Result<Vec<u8>, Vec<Diagnostic>> {
    compile_with_warnings(source, filename, options).map(|output| output.bir)
}

/// Like [`compile_with`], and also returns the warnings.
pub fn compile_with_warnings(
    source: &[u8],
    filename: &str,
    options: &CompileOptions<'_>,
) -> Result<Output, Vec<Diagnostic>> {
    let compiled = compile_unit(source, filename, options)?;
    // Nothing else can define what this unit only declares.
    if !compiled.undefined_tls.is_empty() {
        return Err(compiled.undefined_tls);
    }
    Ok(Output {
        replaced_aggregates: compiled.unit.replaced_aggregates,
        combined_accesses: compiled.unit.combined_accesses,
        libraries: compiled.unit.module.libraries.clone(),
        bir: compiled.unit.module.encode(),
        warnings: compiled.warnings,
    })
}

/// Compiles several translation units and links them into one BIR module: a function or
/// object one unit defines and another declares `extern` is resolved inside the module,
/// `static` names stay private to their unit, and tentative definitions of one object
/// merge. Defining a symbol twice is an error.
pub fn compile_many(
    units: &[(&[u8], &str)],
    options: &CompileOptions<'_>,
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
        let one = compile_unit(source, filename, options)?;
        compiled.push(one.unit);
        warnings.extend(one.warnings);
        undefined_tls.push(one.undefined_tls);
    }
    let name_of = |unit: usize| names.get(unit).map_or("<no input>", String::as_str);
    let replaced_aggregates = compiled.iter().map(|u| u.replaced_aggregates).sum();
    let combined_accesses = compiled.iter().fold((0, 0), |sum, u| {
        (sum.0 + u.combined_accesses.0, sum.1 + u.combined_accesses.1)
    });
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
        replaced_aggregates,
        combined_accesses,
        libraries: linked.module.libraries.clone(),
        bir: linked.module.encode(),
        warnings,
    })
}

/// Compiles one translation unit to its in-memory module.
fn compile_unit(
    source: &[u8],
    filename: &str,
    options: &CompileOptions<'_>,
) -> Result<Compiled, Vec<Diagnostic>> {
    on_compiler_thread(filename, || {
        let files = Rc::new(RefCell::new(FileTable::default()));
        let result = (|| {
            let tokens = preprocessor(source, filename, options, &files)?;
            let mut program = parser::Parser::new(tokens, options.target)?
                .replacing_aggregates(options.replace_aggregates)
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
    })
}

/// TypeScript declarations (the text of a `.d.ts` file) for the functions the unit lets
/// JavaScript call: `export function name(a: number, p: Pointer | ...): number;` with the
/// C prototype as a doc comment, and a default export that has them all.
pub fn typescript_declarations(
    source: &[u8],
    filename: &str,
    options: &CompileOptions<'_>,
) -> Result<String, Vec<Diagnostic>> {
    on_compiler_thread(filename, || {
        let files = Rc::new(RefCell::new(FileTable::default()));
        let result = (|| {
            let tokens = preprocessor(source, filename, options, &files)?;
            let program = parser::Parser::new(tokens, options.target)?.parse_program()?;
            Ok(dts::typescript_declarations(&program))
        })();
        result.map_err(|e| diagnostic(&files.borrow(), e))
    })
}

/// Runs only the preprocessor and renders the resulting tokens as text (`-E`).
pub fn preprocess(
    source: &[u8],
    filename: &str,
    options: &CompileOptions<'_>,
) -> Result<String, Vec<Diagnostic>> {
    on_compiler_thread(filename, || {
        let files = Rc::new(RefCell::new(FileTable::default()));
        let result = (|| {
            let mut pp = preprocessor(source, filename, options, &files)?;
            let mut out: Vec<u8> = Vec::new();
            let mut previous: Option<token::PpToken> = None;
            loop {
                let t = pp.next_token()?;
                if t.kind == PpKind::Eof {
                    out.push(b'\n');
                    return Ok(token::display_bytes(&out));
                }
                if let Some(prev) = &previous {
                    if t.at_start_of_line {
                        out.push(b'\n');
                    } else if t.has_leading_space || needs_space(prev, &t) {
                        out.push(b' ');
                    }
                }
                if t.kind == PpKind::Pragma && !t.text.starts_with(b"pack ") {
                    out.extend_from_slice(b"#pragma ");
                    out.extend_from_slice(&t.text);
                } else if t.kind == PpKind::Pragma {
                    // `pack push 1` is the canonical form of `pack(push, 1)`.
                    out.extend_from_slice(b"#pragma ");
                    let mut words: Vec<&[u8]> = Vec::new();
                    let mut start = 0;
                    for end in 0..=t.text.len() {
                        if end == t.text.len() || t.text[end] == b' ' {
                            words.push(&t.text[start..end]);
                            start = end + 1;
                        }
                    }
                    let name = words.remove(0);
                    out.extend_from_slice(name);
                    out.push(b'(');
                    let words: Vec<&[u8]> = words
                        .into_iter()
                        .filter(|w| *w != b"set" && *w != b"default")
                        .collect();
                    out.extend_from_slice(&words.join(&b", "[..]));
                    out.push(b')');
                } else {
                    out.extend_from_slice(pp::spelling(&t));
                }
                previous = Some(t);
            }
        })();
        result.map_err(|e| diagnostic(&files.borrow(), e))
    })
}

/// Whether printing `b` right after `a` would lex differently than the two tokens.
fn needs_space(a: &token::PpToken, b: &token::PpToken) -> bool {
    let wordy = |t: &token::PpToken| {
        matches!(
            t.kind,
            PpKind::Ident | PpKind::Number | PpKind::CharLit | PpKind::StrLit
        )
    };
    let punct = |t: &token::PpToken| matches!(t.kind, PpKind::Punct(_) | PpKind::Other);
    (wordy(a) && wordy(b))
        || (punct(a) && punct(b))
        || (a.kind == PpKind::Number && punct(b))
        || (punct(a) && b.kind == PpKind::Number)
}

fn preprocessor<'a>(
    source: &[u8],
    filename: &str,
    options: &'a CompileOptions<'_>,
    files: &Rc<RefCell<FileTable>>,
) -> token::Res<Preprocessor<'a>> {
    let mut search: Vec<SearchDir> = Vec::new();
    for dir in &options.include_dirs {
        search.push(SearchDir::Dir(Rc::from(dir.as_str())));
    }
    search.push(SearchDir::Builtin);
    for dir in &options.system_include_dirs {
        search.push(SearchDir::Dir(Rc::from(dir.as_str())));
    }
    let mut pp = Preprocessor::new(
        Rc::clone(files),
        options.file_provider,
        options.target,
        search,
        filename,
    );
    pp.define_builtins();

    let mut command_line = String::new();
    for (name, value) in &options.defines {
        command_line.push_str("#define ");
        command_line.push_str(name);
        command_line.push(' ');
        command_line.push_str(value.as_deref().unwrap_or("1"));
        command_line.push('\n');
    }
    for name in &options.undefines {
        command_line.push_str("#undef ");
        command_line.push_str(name);
        command_line.push('\n');
    }
    // Sources are stacked, so the last one pushed is read first.
    pp.push_source(filename, Rc::from(source), None);
    if !command_line.is_empty() {
        pp.push_source("<command line>", Rc::from(command_line.as_bytes()), None);
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

/// The operand of `-fgnuc-version=`: `4.2.1`, `9`, `13.2`, or `0` for none.
pub fn parse_gnu_version(text: &str) -> Option<Option<(u32, u32, u32)>> {
    let mut parts = [0u32; 3];
    let mut count = 0;
    let mut digits = 0;
    for &b in text.as_bytes() {
        match b {
            b'0'..=b'9' if count < 3 => {
                parts[count] = parts[count]
                    .checked_mul(10)?
                    .checked_add(u32::from(b - b'0'))?;
                digits += 1;
            }
            b'.' if digits > 0 && count < 2 => {
                count += 1;
                digits = 0;
            }
            _ => return None,
        }
    }
    if digits == 0 {
        return None;
    }
    Some((parts[0] != 0).then_some((parts[0], parts[1], parts[2])))
}

/// The macros predefined for `target`, as `#define` lines.
pub fn predefined_macros(target: Target) -> String {
    pp_predef::predefined_macros(target, None)
}

/// The same when claiming to be GNU C `gnu_version` (see `CompileOptions::gnu_version`).
pub fn predefined_macros_as_gnu(target: Target, gnu_version: (u32, u32, u32)) -> String {
    pp_predef::predefined_macros(target, Some(gnu_version))
}

/// Parses and type-checks `source` without generating code.
#[cfg(test)]
pub(crate) fn parse_for_tests(source: &str, target: Target) -> ast::Program {
    let files = Rc::new(RefCell::new(FileTable::default()));
    let options = CompileOptions::new(target);
    let tokens = preprocessor(source.as_bytes(), "test.c", &options, &files).expect("preprocessor");
    match parser::Parser::new(tokens, target).and_then(parser::Parser::parse_program) {
        Ok(program) => program,
        Err(e) => panic!("{}:{}: {}", e.loc.line, e.loc.col, e.msg),
    }
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

/// Lists the preprocessing tokens of `source`, one per line, with their spacing flags.
pub fn dump_tokens(source: &[u8], filename: &str) -> Result<String, Vec<Diagnostic>> {
    use fmt::Write as _;
    let mut files = FileTable::default();
    let file = files.add(filename);
    let mut lexer = lexer::Lexer::new(Rc::from(source), file);
    let mut out = String::new();
    loop {
        let t = lexer.next_token().map_err(|e| diagnostic(&files, e))?;
        if t.kind == PpKind::Eof {
            return Ok(out);
        }
        let _ = writeln!(
            out,
            "{}:{}: {:?} {}{}{}",
            t.loc.line,
            t.loc.col,
            t.kind,
            token::display_bytes(pp::spelling(&t)),
            if t.at_start_of_line {
                " [start-of-line]"
            } else {
                ""
            },
            if t.has_leading_space {
                " [leading-space]"
            } else {
                ""
            },
        );
    }
}
