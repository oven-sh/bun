//! The tables behind `--target=bun_builtins`: which `$name`s exist, what the macros among them
//! expand to, and which registry id a `require` resolves to. `src/codegen/builtins-manifest.ts`
//! writes them; every consumer of `src/js` reads them from here.
//!
//! And the archive `bun build --compile-aot` compiles the internal modules from, written by the same
//! script: the number of files as a `u32`, as many records sorted by name, then the files. Each file
//! is a zstd frame of its own, so only what a program reaches is decompressed. Numbers are
//! little-endian. The names are paths relative to `src/js`, and `manifest`.

use std::borrow::Cow;
use std::sync::OnceLock;

const HEADER: &[u8] = b"bun-builtins-manifest\t3";

/// Where the checker and the AoT front end take the files of `src/js` to be.
pub const VIRTUAL_ROOT: &[u8] = b"/$bun/js/";

pub struct Module {
    pub id: u32,
    /// Relative to `src/js`. Empty for a native module.
    pub path: Box<[u8]>,
    /// What `require` takes. Empty if the module is only reachable by path.
    pub specifier: Box<[u8]>,
    /// The name `$debug` and `$assert` print.
    pub label: Box<[u8]>,
    /// What the module loader, the builtins section of an executable and stack frames call it:
    /// `node:fs/promises`, `internal:fifo`, `ws`.
    pub name: Box<[u8]>,
}

#[derive(Default)]
pub struct Manifest {
    is_development: bool,
    defines: Vec<(Box<[u8]>, Box<[u8]>)>,
    hardened_globals: Vec<Box<[u8]>>,
    names: Vec<Box<[u8]>>,
    errors: Vec<(Box<[u8]>, u32)>,
    classes: Vec<(Box<[u8]>, u32)>,
    native_bindings: Vec<(Box<[u8]>, u32)>,
    modules: Vec<Module>,
    function_files: Vec<Box<[u8]>>,
    /// By path and name, with a tab between them.
    builtin_functions: Vec<(Box<[u8]>, u32)>,
    requires: Vec<(u32, Box<[u32]>)>,
    evaluated_by_first_tick: Vec<u32>,
    always_included: Vec<u32>,
    triggers: Vec<Trigger>,
}

/// Native code requires `modules` once the program reads `global.property`.
pub struct Trigger {
    pub global: Box<[u8]>,
    pub property: Box<[u8]>,
    pub modules: Box<[u32]>,
}

/// Why a module is in `Manifest::closure`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    Root,
    RequiredBy(u32),
}

/// `$cpp("file", "symbol")` and the like.
pub struct NativeBinding<'a> {
    pub id: u32,
    /// The name of the macro, without the `$`.
    pub kind: &'a [u8],
    pub file: &'a [u8],
    pub symbol: &'a [u8],
}

#[derive(Debug)]
pub struct ParseError {
    pub line: usize,
}

#[derive(Clone, Copy)]
pub enum Literal<'a> {
    String(&'a [u8]),
    Other,
}

pub enum Macro {
    /// `callee(constant, ...arguments)`
    Prepend {
        callee: &'static [u8],
        constant: u32,
    },
    /// `lazy(id)`
    NativeBinding(u32),
    /// `$debug_log(...arguments)` in a debug build, else nothing
    DebugLog,
    /// `$assert(condition, "condition", ...rest)` in a debug build, else nothing
    Assert,
    /// `peekPromiseStatus(...arguments) === status`
    PromiseStatus(u32),
    /// A build error unless the call is dead code.
    BundleError,
}

pub enum MacroError {
    ArgumentsNotLiteral,
    UnknownNativeBinding,
}

static INSTALLED: OnceLock<Manifest> = OnceLock::new();

impl Manifest {
    pub fn install(manifest: Manifest) -> &'static Manifest {
        INSTALLED.get_or_init(|| manifest)
    }

    pub fn installed() -> Option<&'static Manifest> {
        INSTALLED.get()
    }

    pub fn parse(text: &[u8]) -> Result<Manifest, ParseError> {
        let mut manifest = Manifest::default();
        for (index, line) in text.split(|&byte| byte == b'\n').enumerate() {
            let error = || ParseError { line: index + 1 };
            if index == 0 {
                if line != HEADER {
                    return Err(error());
                }
                continue;
            }
            if line.is_empty() {
                continue;
            }
            let mut fields = line.split(|&byte| byte == b'\t');
            let kind = fields.next().ok_or_else(error)?;
            let mut field = || fields.next().ok_or_else(error);
            match kind {
                b"development" => manifest.is_development = field()? == b"1",
                b"define" => manifest.defines.push((field()?.into(), field()?.into())),
                b"global" => manifest.hardened_globals.push(field()?.into()),
                b"name" => manifest.names.push(field()?.into()),
                b"error" => {
                    let name = field()?;
                    let code = number(field()?).ok_or_else(error)?;
                    manifest.errors.push((name.into(), code));
                }
                b"class" => {
                    let name = field()?;
                    let id = number(field()?).ok_or_else(error)?;
                    manifest.classes.push((name.into(), id));
                }
                b"native" => {
                    let id = number(field()?).ok_or_else(error)?;
                    let key = native_binding_key(field()?, field()?, field()?);
                    manifest.native_bindings.push((key.into_boxed_slice(), id));
                }
                b"module" => manifest.modules.push(Module {
                    id: number(field()?).ok_or_else(error)?,
                    path: optional(field()?).into(),
                    specifier: optional(field()?).into(),
                    label: field()?.into(),
                    name: field()?.into(),
                }),
                b"functions" => manifest.function_files.push(field()?.into()),
                b"function" => {
                    let id = number(field()?).ok_or_else(error)?;
                    let key = [field()?, field()?].join(&b'\t');
                    manifest.builtin_functions.push((key.into_boxed_slice(), id));
                }
                b"requires" => {
                    let id = number(field()?).ok_or_else(error)?;
                    manifest.requires.push((id, numbers(fields).ok_or_else(error)?));
                }
                b"first_tick" => {
                    let id = number(field()?).ok_or_else(error)?;
                    manifest.evaluated_by_first_tick.push(id);
                    manifest.always_included.push(id);
                }
                b"always" => {
                    let id = number(field()?).ok_or_else(error)?;
                    manifest.always_included.push(id);
                }
                b"trigger" => {
                    let path = field()?;
                    let dot = path.iter().position(|&byte| byte == b'.');
                    let (global, property) = path.split_at(dot.ok_or_else(error)?);
                    manifest.triggers.push(Trigger {
                        global: global.into(),
                        property: property[1..].into(),
                        modules: numbers(fields).ok_or_else(error)?,
                    });
                }
                _ => return Err(error()),
            }
        }
        manifest.hardened_globals.sort_unstable();
        manifest.names.sort_unstable();
        manifest.errors.sort_unstable();
        manifest.classes.sort_unstable();
        manifest.native_bindings.sort_unstable();
        manifest.builtin_functions.sort_unstable();
        manifest.requires.sort_unstable();
        Ok(manifest)
    }

    pub fn is_development(&self) -> bool {
        self.is_development
    }

    /// Keys are spelled as in the sources: `$name` for a private name.
    pub fn defines(&self) -> &[(Box<[u8]>, Box<[u8]>)] {
        &self.defines
    }

    /// Globals a builtin reads through the private name of the same spelling.
    pub fn hardened_globals(&self) -> &[Box<[u8]>] {
        &self.hardened_globals
    }

    pub fn is_hardened_global(&self, name: &[u8]) -> bool {
        contains(&self.hardened_globals, name)
    }

    /// `name` is what follows the `$`.
    pub fn is_known_name(&self, name: &[u8]) -> bool {
        contains(&self.names, name)
            || is_macro_name(name)
            || find(&self.errors, name).is_some()
            || name
                .strip_prefix(b"inherits")
                .is_some_and(|class| find(&self.classes, class).is_some())
            || self
                .defines
                .iter()
                .any(|(key, _)| key.strip_prefix(b"$") == Some(name))
    }

    /// What a call of `$name` stands for, or `None` if `$name` is an ordinary function.
    pub fn macro_for_call(
        &self,
        name: &[u8],
        arguments: &[Literal<'_>],
    ) -> Result<Option<Macro>, MacroError> {
        Ok(Some(match name {
            b"debug" => Macro::DebugLog,
            b"assert" => Macro::Assert,
            b"bundleError" => Macro::BundleError,
            b"isPromisePending" => Macro::PromiseStatus(0),
            b"isPromiseFulfilled" => Macro::PromiseStatus(1),
            b"isPromiseRejected" => Macro::PromiseStatus(2),
            b"cpp" | b"rust" | b"newCppFunction" | b"newRustFunction" | b"bindgenFn" => {
                let [Literal::String(file), Literal::String(symbol), ..] = arguments else {
                    return Err(MacroError::ArgumentsNotLiteral);
                };
                let key = native_binding_key(name, file, symbol);
                match find(&self.native_bindings, &key) {
                    Some(id) => Macro::NativeBinding(id),
                    None => return Err(MacroError::UnknownNativeBinding),
                }
            }
            _ => {
                if let Some(constant) = find(&self.errors, name) {
                    Macro::Prepend {
                        callee: b"makeErrorWithCode",
                        constant,
                    }
                } else if let Some(constant) = name
                    .strip_prefix(b"inherits")
                    .and_then(|class| find(&self.classes, class))
                {
                    Macro::Prepend {
                        callee: b"inherits",
                        constant,
                    }
                } else {
                    return Ok(None);
                }
            }
        }))
    }

    /// The registry id of `require(specifier)` in the module at `importer`, a path relative to
    /// `src/js`.
    pub fn resolve(&self, specifier: &[u8], importer: &[u8]) -> Option<u32> {
        if specifier.is_empty() {
            return None;
        }
        if let Some(module) = self
            .modules
            .iter()
            .find(|module| *module.specifier == *specifier)
        {
            return Some(module.id);
        }
        let directory: &[u8] = match importer.iter().rposition(|&byte| byte == b'/') {
            Some(end) => &importer[..end],
            None => &[],
        };
        self.resolve_path(directory, specifier)
            .or_else(|| self.resolve_path(&[], specifier))
    }

    fn resolve_path(&self, directory: &[u8], specifier: &[u8]) -> Option<u32> {
        let mut parts: Vec<&[u8]> = Vec::new();
        for part in directory
            .split(|&byte| byte == b'/')
            .chain(specifier.split(|&byte| byte == b'/'))
        {
            match part {
                b"" | b"." => {}
                b".." => {
                    parts.pop()?;
                }
                _ => parts.push(part),
            }
        }
        let path = parts.join(&b'/');
        [&b""[..], b".ts", b".js"].iter().find_map(|extension| {
            let candidate = [&path[..], *extension].concat();
            self.modules
                .iter()
                .find(|module| *module.path == *candidate)
                .map(|module| module.id)
        })
    }

    pub fn modules(&self) -> &[Module] {
        &self.modules
    }

    pub fn module(&self, id: u32) -> Option<&Module> {
        self.modules.iter().find(|module| module.id == id)
    }

    /// The module with a source that the module loader runs for `name`, a specifier as
    /// `HardcodedModule::Alias` spells it.
    pub fn module_for_loader(&self, name: &[u8]) -> Option<u32> {
        let name = if name == b"@vercel/fetch" { b"vercel_fetch" } else { name };
        let with_source = self.modules.iter().filter(|module| !module.path.is_empty());
        with_source.filter(|module| *module.name == *name).map(|module| module.id).next()
    }

    /// The files of builtin functions, relative to `src/js`.
    pub fn function_files(&self) -> &[Box<[u8]>] {
        &self.function_files
    }

    /// What native code asks a compiled program for `export function name` of a file of builtin functions by. `path` is relative
    /// to `src/js`, or under `VIRTUAL_ROOT`. `None`: only other builtin functions call it.
    pub fn builtin_function_id(&self, path: &[u8], name: &[u8]) -> Option<u32> {
        let path = path.strip_prefix(VIRTUAL_ROOT).unwrap_or(path);
        find(&self.builtin_functions, &[path, name].join(&b'\t'))
    }

    /// In no order.
    pub fn native_bindings(&self) -> impl Iterator<Item = NativeBinding<'_>> {
        self.native_bindings.iter().filter_map(|(key, id)| {
            let mut fields = key.split(|&byte| byte == b'\t');
            Some(NativeBinding {
                id: *id,
                kind: fields.next()?,
                file: fields.next()?,
                symbol: fields.next()?,
            })
        })
    }

    /// The modules that the module `id` can require, eagerly or lazily. Ascending.
    pub fn requires(&self, id: u32) -> &[u32] {
        let found = self.requires.binary_search_by_key(&id, |entry| entry.0);
        found.map_or(&[], |index| &self.requires[index].1)
    }

    /// What the first tick of the event loop evaluates.
    pub fn evaluated_by_first_tick(&self) -> &[u32] {
        &self.evaluated_by_first_tick
    }

    /// Those, and what else native code may require, whatever the program does.
    pub fn always_included(&self) -> &[u32] {
        &self.always_included
    }

    pub fn triggers(&self) -> &[Trigger] {
        &self.triggers
    }

    /// `roots` and all they can come to require, native modules too, each with the first reason
    /// found. Ascending.
    pub fn closure(&self, roots: &[u32]) -> Vec<(u32, Reason)> {
        let mut found: Vec<(u32, Reason)> = Vec::new();
        let mut is_found = vec![false; self.modules.len()];
        let mut add = |found: &mut Vec<(u32, Reason)>, id: u32, reason: Reason| {
            if let Some(is_found) = is_found.get_mut(id as usize)
                && !std::mem::replace(is_found, true)
            {
                found.push((id, reason));
            }
        };
        for &root in roots {
            add(&mut found, root, Reason::Root);
        }
        let mut next = 0;
        while let Some(&(id, _)) = found.get(next) {
            next += 1;
            for &required in self.requires(id) {
                add(&mut found, required, Reason::RequiredBy(id));
            }
        }
        found.sort_unstable_by_key(|entry| entry.0);
        found
    }

    pub fn module_for_path(&self, path: &[u8]) -> Option<&Module> {
        self.modules
            .iter()
            .filter(|module| !module.path.is_empty() && is_path_suffix(path, &module.path))
            .max_by_key(|module| module.path.len())
    }
}

static ARCHIVE: &[u8] = include_bytes!(concat!(env!("BUN_CODEGEN_DIR"), "/builtin_sources.bin"));

const NAME_LEN: usize = 63;
/// The length of the name, the name, where the frame starts in `ARCHIVE`, and its length.
const RECORD_LEN: usize = 1 + NAME_LEN + 4 + 4;

pub struct Archive {
    manifest: Manifest,
    /// By id. Empty for a native module.
    paths: Vec<Box<[u8]>>,
}

impl Archive {
    pub fn embedded() -> &'static Archive {
        static EMBEDDED: OnceLock<Archive> = OnceLock::new();
        EMBEDDED.get_or_init(|| {
            let text = Archive::read(b"manifest").expect("the archive has a manifest");
            let manifest = Manifest::parse(&text).expect("the manifest of the archive is well-formed");
            let mut paths: Vec<Box<[u8]>> = Vec::new();
            for module in manifest.modules.iter().filter(|module| !module.path.is_empty()) {
                if paths.len() <= module.id as usize {
                    paths.resize_with(module.id as usize + 1, Default::default);
                }
                paths[module.id as usize] = [VIRTUAL_ROOT, &module.path].concat().into();
            }
            Archive { manifest, paths }
        })
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    /// `VIRTUAL_ROOT` and the path relative to `src/js`. Empty for a native module.
    pub fn path(&self, id: u32) -> &[u8] {
        self.paths.get(id as usize).map_or(&[], |path| &path[..])
    }

    /// The module as it is written. Empty for a native module.
    pub fn source(&self, id: u32) -> Cow<'static, [u8]> {
        let name = self.path(id).strip_prefix(VIRTUAL_ROOT);
        name.and_then(Archive::read).map_or(Cow::Borrowed(&[]), Cow::Owned)
    }

    /// The file `name`, a path relative to `src/js`.
    pub fn read(name: &[u8]) -> Option<Vec<u8>> {
        let number = |bytes: &[u8]| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
        let records = &ARCHIVE[4..][..number(ARCHIVE) * RECORD_LEN];
        let records = records.as_chunks::<RECORD_LEN>().0;
        let found = records.binary_search_by(|record| record[1..][..record[0] as usize].cmp(name));
        let place = &records[found.ok()?][1 + NAME_LEN..];
        bun_zstd::decompress_alloc(&ARCHIVE[number(place)..][..number(&place[4..])]).ok()
    }
}

impl Module {
    /// The declarations `$debug` expands to a use of.
    pub fn write_debug_log(&self, out: &mut Vec<u8>) {
        let path = &self.path[..self.path.len().saturating_sub(3)];
        out.extend_from_slice(
            b"
let $debug_trace = Bun.env.TRACE && Bun.env.TRACE === '1';
let $debug_log_enabled = ((env) => (
  // The rationale for checking all these variables is just so you don't have to exactly remember which one you set.
  (env.BUN_DEBUG_ALL && env.BUN_DEBUG_ALL !== '0')
  || (env.BUN_DEBUG_JS && env.BUN_DEBUG_JS !== '0')
  || (env.BUN_DEBUG_",
        );
        write_upper_snake_case(&self.label, out);
        out.extend_from_slice(b" === '1')\n  || (env.DEBUG_");
        write_upper_snake_case(path, out);
        out.extend_from_slice(
            b" === '1')
))(Bun.env);
let $debug_pid_prefix = Bun.env.SHOW_PID === '1';
let $debug_log = $debug_log_enabled ? (...args) => {
  // warn goes to stderr without colorizing
  console[$debug_trace ? 'trace' : 'warn'](($debug_pid_prefix ? `[${process.pid}] ` : '') + (Bun.enableANSIColors ? '\\x1b[90m[",
        );
        out.extend_from_slice(&self.label);
        out.extend_from_slice(b"]\\x1b[0m' : '[");
        out.extend_from_slice(&self.label);
        out.extend_from_slice(b"]'), ...args);\n} : () => {};\n");
    }

    /// The declaration `$assert` expands to a use of.
    pub fn write_assert(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(
            b"
let $assert = function(check, sourceString, ...message) {
  if (!check) {
    const prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, stack) => {
      return e.name + ': ' + e.message + '\\n' + stack.slice(1).map(x => '  at ' + x.toString()).join('\\n');
    };
    const e = new Error(sourceString);
    e.stack; // materialize stack
    e.name = 'AssertionError';
    Error.prepareStackTrace = prevPrepareStackTrace;
    console.error('[",
        );
        out.extend_from_slice(&self.label);
        out.extend_from_slice(
            b"] ASSERTION FAILED: ' + sourceString);
    if (message.length) console.warn(...message);
    console.warn(e.stack.split('\\n')[1] + '\\n');
    if (Bun.env.ASSERT === 'CRASH') process.exit(0xAA);
    throw e;
  }
}
",
        );
    }
}

fn is_macro_name(name: &[u8]) -> bool {
    matches!(
        name,
        b"debug"
            | b"assert"
            | b"bundleError"
            | b"isPromisePending"
            | b"isPromiseFulfilled"
            | b"isPromiseRejected"
            | b"cpp"
            | b"rust"
            | b"newCppFunction"
            | b"newRustFunction"
            | b"bindgenFn"
    )
}

fn native_binding_key(name: &[u8], file: &[u8], symbol: &[u8]) -> Vec<u8> {
    [name, file, symbol].join(&b'\t')
}

fn number(field: &[u8]) -> Option<u32> {
    std::str::from_utf8(field).ok()?.parse().ok()
}

fn numbers<'a>(fields: impl Iterator<Item = &'a [u8]>) -> Option<Box<[u32]>> {
    fields.map(number).collect()
}

fn optional(field: &[u8]) -> &[u8] {
    if field == b"-" { &[] } else { field }
}

fn contains(sorted: &[Box<[u8]>], name: &[u8]) -> bool {
    sorted.binary_search_by(|entry| (**entry).cmp(name)).is_ok()
}

fn find(sorted: &[(Box<[u8]>, u32)], name: &[u8]) -> Option<u32> {
    sorted
        .binary_search_by(|(key, _)| (**key).cmp(name))
        .ok()
        .map(|index| sorted[index].1)
}

fn is_path_suffix(path: &[u8], suffix: &[u8]) -> bool {
    let Some(start) = path.len().checked_sub(suffix.len()) else {
        return false;
    };
    let is_separator = |byte: u8| byte == b'/' || byte == b'\\';
    (start == 0 || is_separator(path[start - 1]))
        && path[start..]
            .iter()
            .zip(suffix)
            .all(|(&a, &b)| a == b || (is_separator(a) && is_separator(b)))
}

/// `pathToUpperSnakeCase` of `src/codegen/helpers.ts`.
fn write_upper_snake_case(text: &[u8], out: &mut Vec<u8>) {
    let start = text
        .iter()
        .position(|&byte| byte == b':')
        .map_or(0, |colon| colon + 1);
    out.extend(text[start..].iter().map(|&byte| match byte {
        b'-' | b'_' | b'.' | b'/' | b'\\' => b'_',
        _ => byte.to_ascii_uppercase(),
    }));
}
