//! Port of src/cli/init_command.zig

use core::ffi::c_char;

use bun_ast::StoreRef;
use bun_collections::IntegerBitSet;
use bun_collections::bit_set::Range as BitRange;
use bun_core::{self as bun, Environment, Error, Global, Output, env_var, fmt as bun_fmt};
use bun_core::{MutableString, ZStr, strings};
use bun_js_parser as js_ast;
use bun_js_printer as js_printer;
use bun_parsers::json;
use bun_paths::{self, PathBuffer, path_buffer_pool};
use bun_resolver::fs as Fs;
use bun_sys::{self, Fd};

use crate::cli as CLI;
use bun_bundler::options;

// ──────────────────────────────────────────────────────────────────────────
// RadioChoice trait — replaces Zig's comptime enum reflection in
// `processRadioButton`. In Zig the function takes `comptime Choices: type`
// and uses `bun.meta.EnumFields(Choices)` + `@enumFromInt` + the `fmt()`
// method; in Rust the choice enums implement this trait by hand.
// ──────────────────────────────────────────────────────────────────────────
pub trait RadioChoice: Copy + Sized {
    const COUNT: usize;
    const DEFAULT: Self;
    fn fmt(self) -> &'static str;
    fn from_index(i: usize) -> Self;
    fn to_index(self) -> usize;
}

pub struct InitCommand;

impl InitCommand {
    pub fn prompt(
        // TODO(port): narrow error set
        label: &'static str,
        default: &[u8],
    ) -> Result<Vec<u8>, Error> {
        // TODO(port): Zig returns `[:0]const u8` (NUL-terminated, length-carrying).
        // We return `Vec<u8>` here and NUL-terminate at the call sites that need it.
        Output::pretty(format_args!("{}", label));
        if !default.is_empty() {
            Output::pretty(format_args!("<d>({}):<r> ", bstr::BStr::new(default)));
        }

        Output::flush();

        // unset `ENABLE_VIRTUAL_TERMINAL_INPUT` on windows. This prevents backspace from
        // deleting the entire line
        #[cfg(windows)]
        let _stdin_mode =
            bun_sys::windows::StdinModeGuard::set(bun_sys::windows::UpdateStdioModeFlagsOpts {
                unset: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT,
                ..Default::default()
            });

        let mut input: Vec<u8> = Vec::new();
        // TODO(port): bun.Output.buffered_stdin.reader().readUntilDelimiterArrayList(&input, '\n', 1024)
        Output::buffered_stdin_read_until_delimiter(&mut input, b'\n', 1024)?;

        if strings::ends_with_char(&input, b'\r') {
            let _ = input.pop();
        }
        if !input.is_empty() {
            // Zig appends a NUL and returns the slice without it; callers that need
            // a C string can push a NUL themselves.
            Ok(input)
        } else {
            input.clear();
            input.extend_from_slice(default);
            Ok(input)
        }
    }

    fn process_radio_button<C: RadioChoice>(label: &[u8]) -> Result<C, Error> {
        let colors = Output::enable_ansi_colors_stdout();
        // PERF(port): Zig builds `choices` at comptime via `bun.meta.EnumFields` +
        // `Output.prettyFmt(e.fmt(), colors_comptime)`. We build it at runtime once.
        let choices: Vec<Output::PrettyBuf> = (0..C::COUNT)
            .map(|i| {
                let e = C::from_index(i);
                Output::pretty_fmt_rt(e.fmt(), colors)
            })
            .collect();

        // Print the question prompt
        Output::prettyln(format_args!(
            "<r><cyan>?<r> {}<d> - Press return to submit.<r>",
            bstr::BStr::new(label),
        ));

        if colors {
            Output::print(format_args!("\x1b[?25l")); // hide cursor
        }
        scopeguard::defer! {
            if colors {
                Output::print(format_args!("\x1b[?25h")); // show cursor
            }
        };

        let mut selected: C = C::DEFAULT;
        let mut initial_draw = true;
        let mut reprint_menu = true;

        // Zig: `std.fs.File.stdin().readerStreaming(&stdin_b)` then `takeByte()`.
        let mut stdin = bun_core::output::stdin_reader();

        // The Zig has `errdefer reprint_menu = false;` followed by a `defer { ... }`
        // that uses `reprint_menu`. We model both with a single guard whose state we
        // mutate, and flip `reprint_menu = false` on the error paths before returning.
        // PORT NOTE: reshaped for borrowck — can't both borrow `selected`/`initial_draw`
        // in a scopeguard closure and mutate them in the loop. Instead inline the
        // cleanup at every return point.
        macro_rules! finish {
            ($reprint:expr, $sel:expr) => {{
                if !initial_draw {
                    // Move cursor up to prompt line
                    Output::up(choices.len() + 1);
                }
                // Clear from cursor to end of screen
                Output::clear_to_end();
                if $reprint {
                    // Print final selection
                    Output::prettyln(format_args!(
                        "<r><green>✓<r> {}<d>:<r> {}<r>",
                        bstr::BStr::new(label),
                        &choices[$sel.to_index()],
                    ));
                }
            }};
        }

        loop {
            if !initial_draw {
                // Move cursor up by number of choices
                Output::up(choices.len());
            }
            initial_draw = false;

            // Print options vertically
            // PERF(port): was `inline for` — profile in Phase B
            for (i, option) in choices.iter().enumerate() {
                if i == selected.to_index() {
                    if colors {
                        Output::pretty(format_args!("<r><cyan>❯<r>   "));
                    } else {
                        Output::pretty(format_args!("<r><cyan>><r>   "));
                    }
                    if colors {
                        Output::print(format_args!("\x1B[4m{}\x1B[24m\x1B[0K\n", option));
                    } else {
                        Output::print(format_args!("    {}\x1B[0K\n", option));
                    }
                } else {
                    Output::print(format_args!("    {}\x1B[0K\n", option));
                }
            }
            Output::clear_to_end();

            Output::flush();

            // Read a single character
            let byte = match stdin.take_byte() {
                Ok(b) => b,
                Err(_) => {
                    finish!(reprint_menu, selected);
                    return Ok(selected);
                }
            };

            match byte {
                b'\n' | b'\r' => {
                    finish!(reprint_menu, selected);
                    return Ok(selected);
                }
                3 | 4 => {
                    // ctrl+c, ctrl+d
                    reprint_menu = false;
                    finish!(reprint_menu, selected);
                    return Err(bun_core::err!("EndOfStream"));
                }
                b'1'..=b'9' => {
                    let choice = (byte - b'1') as usize;
                    if choice < choices.len() {
                        // PORT NOTE: Zig's `defer` reads `selected`, which is NOT updated
                        // before `return @enumFromInt(choice)` — so Zig prints the previously
                        // highlighted option, not the one just picked. Matching Zig verbatim.
                        finish!(reprint_menu, selected);
                        return Ok(C::from_index(choice));
                    }
                }
                b'j' => {
                    if selected.to_index() == choices.len() - 1 {
                        selected = C::from_index(0);
                    } else {
                        selected = C::from_index(selected.to_index() + 1);
                    }
                }
                b'k' => {
                    if selected.to_index() == 0 {
                        selected = C::from_index(choices.len() - 1);
                    } else {
                        selected = C::from_index(selected.to_index() - 1);
                    }
                }
                27 => {
                    // ESC sequence
                    // Return immediately on plain ESC
                    let next = match stdin.take_byte() {
                        Ok(b) => b,
                        Err(_) => {
                            reprint_menu = false;
                            finish!(reprint_menu, selected);
                            return Err(bun_core::err!("EndOfStream"));
                        }
                    };
                    if next != b'[' {
                        reprint_menu = false;
                        finish!(reprint_menu, selected);
                        return Err(bun_core::err!("EndOfStream"));
                    }

                    // Read arrow key
                    let arrow = match stdin.take_byte() {
                        Ok(b) => b,
                        Err(_) => {
                            reprint_menu = false;
                            finish!(reprint_menu, selected);
                            return Err(bun_core::err!("EndOfStream"));
                        }
                    };
                    match arrow {
                        b'A' => {
                            // Up arrow
                            if selected.to_index() == 0 {
                                selected = C::from_index(choices.len() - 1);
                            } else {
                                selected = C::from_index(selected.to_index() - 1);
                            }
                        }
                        b'B' => {
                            // Down arrow
                            if selected.to_index() == choices.len() - 1 {
                                selected = C::from_index(0);
                            } else {
                                selected = C::from_index(selected.to_index() + 1);
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }

    /// `Choices` must implement `RadioChoice` (Zig: enum with `fmt` method).
    pub fn radio<C: RadioChoice>(label: &[u8]) -> Result<C, Error> {
        // Set raw mode to read single characters without echo
        #[cfg(windows)]
        let _restore =
            bun_sys::windows::StdinModeGuard::set(bun_sys::windows::UpdateStdioModeFlagsOpts {
                // virtual terminal input enables arrow keys, processed input lets ctrl+c kill the program
                set: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT
                    | bun_sys::windows::ENABLE_PROCESSED_INPUT,
                // disabling line input sends keys immediately, disabling echo input makes sure it doesn't print to the terminal
                unset: bun_sys::windows::ENABLE_LINE_INPUT | bun_sys::windows::ENABLE_ECHO_INPUT,
            });

        #[cfg(unix)]
        let _restore = bun_core::tty::RawModeGuard::new(0);

        let selection = match Self::process_radio_button::<C>(label) {
            Ok(s) => s,
            Err(e) if e == bun_core::err!("EndOfStream") => {
                Output::flush();
                // Add an "x" cancelled
                Output::prettyln(format_args!("\n<r><red>x<r> Cancelled"));
                Global::exit(0);
            }
            Err(e) => return Err(e),
        };

        Output::flush();

        Ok(selection)
    }

    // TODO: unicode case folding
    fn normalize_package_name(input: &[u8]) -> Result<Vec<u8>, Error> {
        // toLowerCase
        let needs_normalize = 'brk: {
            for &c in input {
                if c.is_ascii_uppercase() || c == b' ' || c == b'"' || c == b'\'' {
                    break 'brk true;
                }
            }
            false
        };

        if !needs_normalize {
            return Ok(input.to_vec());
        }

        let mut new = vec![0u8; input.len()];
        for (i, &c) in input.iter().enumerate() {
            if c == b' ' || c == b'"' || c == b'\'' {
                new[i] = b'-';
            } else {
                new[i] = c.to_ascii_lowercase();
            }
        }

        Ok(new)
    }

    pub fn exec(init_args: &[&ZStr]) -> Result<(), Error> {
        // --minimal is a special preset to create only empty package.json + tsconfig.json
        let mut minimal = false;
        let mut auto_yes = false;
        let mut parse_flags = true;
        let mut initialize_in_folder: Option<&ZStr> = None;

        let mut template: Template = Template::Blank;
        let mut prev_flag_was_react = false;
        for arg_ in init_args {
            let arg = arg_.as_bytes();
            if parse_flags && !arg.is_empty() && arg[0] == b'-' {
                if arg == b"--help" || arg == b"-h" {
                    CLI::command::tag_print_help(CLI::Command::Tag::InitCommand, true);
                    Global::exit(0);
                } else if arg == b"-m" || arg == b"--minimal" {
                    minimal = true;
                    prev_flag_was_react = false;
                } else if arg == b"-y" || arg == b"--yes" {
                    auto_yes = true;
                    prev_flag_was_react = false;
                } else if arg == b"--" {
                    parse_flags = false;
                    prev_flag_was_react = false;
                } else if arg == b"--react" || arg == b"-r" {
                    template = Template::ReactBlank;
                    prev_flag_was_react = true;
                    auto_yes = true;
                } else if (template == Template::ReactBlank
                    && prev_flag_was_react
                    && arg == b"tailwind"
                    || arg == b"--react=tailwind")
                    || arg == b"r=tailwind"
                {
                    template = Template::ReactTailwind;
                    prev_flag_was_react = false;
                    auto_yes = true;
                } else if (template == Template::ReactBlank
                    && prev_flag_was_react
                    && arg == b"shadcn"
                    || arg == b"--react=shadcn")
                    || arg == b"r=shadcn"
                {
                    template = Template::ReactTailwindShadcn;
                    prev_flag_was_react = false;
                    auto_yes = true;
                } else {
                    prev_flag_was_react = false;
                }
            } else {
                if initialize_in_folder.is_none() {
                    initialize_in_folder = Some(arg_);
                } else {
                    // invalid positional; ignore
                }
            }
        }

        if let Some(ifdir) = initialize_in_folder {
            // TODO(port): std.fs.cwd().makePath → bun_sys::make_path / bun.makePath
            if let Err(err) = bun_sys::make_path(bun_sys::Dir::cwd(), ifdir) {
                Output::pretty_errorln(format_args!(
                    "Failed to create directory {}: {}",
                    bstr::BStr::new(ifdir),
                    err.name(),
                ));
                Global::exit(1);
            }
            let mut ifdir_z = ifdir.to_vec();
            ifdir_z.push(0);
            // SAFETY: ifdir_z[len-1] == 0 written above.
            let ifdir_zstr = ZStr::from_slice_with_nul(&ifdir_z[..]);
            if let Err(err) = bun_sys::chdir(ifdir_zstr) {
                Output::pretty_errorln(format_args!(
                    "Failed to change directory to {}: {}",
                    bstr::BStr::new(ifdir),
                    bstr::BStr::new(err.name()),
                ));
                Global::exit(1);
            }
        }

        let _ = Fs::FileSystem::init(None)?;
        let pathname =
            Fs::PathName::init(Fs::FileSystem::get().top_level_dir_without_trailing_slash());
        // TODO(port): std.fs.cwd() → bun_sys::Fd::cwd(); the Zig kept a std.fs.Dir handle
        let destination_dir = Fd::cwd();

        let mut fields = PackageJSONFields::default();

        // TODO(port): destination_dir.openFile("package.json", .{ .mode = .read_write }) catch null
        let mut package_json_file: Option<bun_sys::File> =
            bun_sys::File::openat(destination_dir, b"package.json", bun_sys::O::RDWR, 0).ok();
        let mut package_json_contents: MutableString = MutableString::init_empty();
        bun_ast::initialize_store();
        // Arena for JSON parse / Expr building (Zig used the AST store).
        let bump = bun_alloc::Arena::new();
        'read_package_json: {
            if let Some(pkg) = package_json_file.as_ref() {
                let size: u64 = 'brk: {
                    #[cfg(windows)]
                    {
                        let Ok(end) = pkg.get_end_pos() else {
                            break 'read_package_json;
                        };
                        if end == 0 {
                            break 'read_package_json;
                        }
                        break 'brk end as u64;
                    }
                    #[cfg(not(windows))]
                    {
                        let Ok(stat) = pkg.stat() else {
                            break 'read_package_json;
                        };
                        if bun_core::kind_from_mode(stat.st_mode as _) != bun_sys::FileKind::File
                            || stat.st_size == 0
                        {
                            break 'read_package_json;
                        }
                        break 'brk stat.st_size as u64;
                    }
                };

                package_json_contents =
                    MutableString::init(usize::try_from(size).expect("int cast"))?;
                // Zig: list_mut().expand_to_capacity()
                package_json_contents
                    .list
                    .resize(usize::try_from(size).expect("int cast"), 0);

                #[cfg(windows)]
                let prev_file_pos = pkg.get_pos()?;
                if pkg
                    .pread_all(package_json_contents.list.as_mut_slice(), 0)
                    .is_err()
                {
                    package_json_file = None;
                    break 'read_package_json;
                }
                #[cfg(windows)]
                pkg.seek_to(prev_file_pos)?;
            }
        }

        fields.name = 'brk: {
            if let Ok(name) = Self::normalize_package_name(if !pathname.filename.is_empty() {
                pathname.filename
            } else {
                b""
            }) {
                if !name.is_empty() {
                    break 'brk name;
                }
            }
            b"project".to_vec()
        };
        let mut did_load_package_json = false;
        if !package_json_contents.list.is_empty() {
            'process_package_json: {
                let source = bun_ast::Source::init_path_string(
                    b"package.json",
                    package_json_contents.list.as_slice(),
                );
                let mut log = bun_ast::Log::init();
                // PORT NOTE: bun_parsers::json builds the T2
                // (bun_ast::js_ast) value tree to avoid a T2->T4 dep
                // cycle; lift to the full T4 (bun_js_parser) tree here so
                // the rest of exec can use E::Object::{put,put_string,
                // get_or_put_object,...} which only exist at T4.
                let package_json_expr: bun_ast::Expr =
                    match json::parse_package_json_utf8(&source, &mut log, &bump) {
                        Ok(e) => bun_ast::Expr::from(e),
                        Err(_) => {
                            package_json_file = None;
                            break 'process_package_json;
                        }
                    };

                if !package_json_expr.data.is_e_object() {
                    package_json_file = None;
                    break 'process_package_json;
                }

                fields.object = package_json_expr.data.e_object();

                if let Some(name) = package_json_expr.get(b"name") {
                    if let Some(str) = name.as_utf8_string_literal() {
                        fields.name = str.to_vec();
                    }
                }

                if let Some(name) = package_json_expr
                    .get(b"module")
                    .or_else(|| package_json_expr.get(b"main"))
                {
                    if let Some(str_) = name.as_utf8_string_literal() {
                        // TODO(port): asStringZ returns NUL-terminated; we store bytes only
                        fields.entry_point = str_.to_vec();
                    }
                }

                did_load_package_json = true;
            }
        }

        if fields.entry_point.is_empty() && !minimal {
            'infer: {
                fields.entry_point = b"index.ts".to_vec();

                // Prefer a file named index
                const PATHS_TO_TRY: &[&[u8]] = &[
                    b"index.mts",
                    b"index.tsx",
                    b"index.ts",
                    b"index.jsx",
                    b"index.mjs",
                    b"index.js",
                    b"src/index.mts",
                    b"src/index.tsx",
                    b"src/index.ts",
                    b"src/index.jsx",
                    b"src/index.mjs",
                    b"src/index.js",
                ];
                for &path in PATHS_TO_TRY {
                    if exists_z(path) {
                        fields.entry_point = path.to_vec();
                        break 'infer;
                    }
                }

                // Find any source file
                // Zig: std.fs.cwd().openDir(".", .{ .iterate = true })
                let Ok(dir) = bun_sys::open_dir_at(Fd::cwd(), b".") else {
                    break 'infer;
                };
                let _close = scopeguard::guard(dir, |d| {
                    let _ = bun_sys::close(d);
                });
                // Zig: bun.DirIterator.iterate(.fromStdDir(dir), .u8)
                let mut it = bun_sys::iterate_dir(dir);
                while let Some(file) = it.next().map_err(bun_core::Error::from)? {
                    if file.kind != bun_sys::FileKind::File {
                        continue;
                    }
                    let ext = bun_paths::extension(file.name.slice_u8());
                    let Some(loader) = bun_ast::Loader::from_string(ext) else {
                        continue;
                    };
                    if loader.is_java_script_like() {
                        // If a non-index file is found, it might not be the "main"
                        // file, and a generated package.json shouldn't get this
                        // added noise.
                        fields.entry_point = Vec::new();
                        break;
                    }
                }
            }
        }

        if !did_load_package_json {
            fields.object = bun_ast::Expr::init(bun_ast::E::Object::default(), bun_ast::Loc::EMPTY)
                .data
                .e_object();
        }

        if !auto_yes {
            if !did_load_package_json {
                Output::pretty(format_args!("\n"));

                let selected = Self::radio::<ProjectTemplateChoice>(b"Select a project template")?;
                match selected {
                    ProjectTemplateChoice::Library => {
                        template = Template::TypescriptLibrary;
                        fields.name = match Self::prompt("<r><cyan>package name<r> ", &fields.name)
                        {
                            Ok(v) => v,
                            Err(e) if e == bun_core::err!("EndOfStream") => return Ok(()),
                            Err(e) => return Err(e),
                        };
                        fields.name = Self::normalize_package_name(&fields.name)?;
                        fields.entry_point =
                            match Self::prompt("<r><cyan>entry point<r> ", &fields.entry_point) {
                                Ok(v) => v,
                                Err(e) if e == bun_core::err!("EndOfStream") => return Ok(()),
                                Err(e) => return Err(e),
                            };
                        fields.private = false;
                    }
                    ProjectTemplateChoice::React => {
                        let react_selected =
                            Self::radio::<ReactTemplateChoice>(b"Select a React template")?;

                        template = match react_selected {
                            ReactTemplateChoice::Default => Template::ReactBlank,
                            ReactTemplateChoice::Tailwind => Template::ReactTailwind,
                            ReactTemplateChoice::ShadcnTailwind => Template::ReactTailwindShadcn,
                        };
                    }
                    ProjectTemplateChoice::Blank => template = Template::Blank,
                }

                Output::print(format_args!("\n"));
                Output::flush();
            } else {
                Output::note("package.json already exists, configuring existing project");
                template = Template::Blank;
            }
        }

        match template {
            Template::ReactBlank | Template::ReactTailwind | Template::ReactTailwindShadcn => {
                // PERF(port): Zig used `inline ... => |t|` to monomorphize per template.
                template.write_files_and_run_bun_dev()?;
                return Ok(());
            }
            _ => {}
        }

        struct Steps {
            write_gitignore: bool,
            write_package_json: bool,
            write_tsconfig: bool,
            write_readme: bool,
        }

        let mut steps = Steps {
            write_package_json: true,
            write_tsconfig: true,
            write_gitignore: !minimal,
            write_readme: !minimal,
        };

        steps.write_gitignore = steps.write_gitignore && !exists_z(b".gitignore");
        steps.write_readme = steps.write_readme
            && !exists_z(b"README.md")
            && !exists_z(b"README")
            && !exists_z(b"README.txt")
            && !exists_z(b"README.mdx");

        steps.write_tsconfig = 'brk: {
            if exists_z(b"tsconfig.json") {
                break 'brk false;
            }
            if exists_z(b"jsconfig.json") {
                break 'brk false;
            }
            true
        };

        // SAFETY: `fields.object` was set above either from the parsed JSON
        // (arena-owned, lives for the duration of `exec`) or from a freshly
        // allocated `Expr.init` from the AST store (also lives until process exit).
        let object = unsafe { &mut *fields.object.unwrap().as_ptr() };

        if !minimal {
            if !fields.name.is_empty() {
                object.put_string(&bump, b"name", &fields.name)?;
            }
            if !fields.entry_point.is_empty() {
                if object.has_property(b"module") {
                    object.put_string(&bump, b"module", &fields.entry_point)?;
                    object.put_string(&bump, b"type", b"module")?;
                } else if object.has_property(b"main") {
                    object.put_string(&bump, b"main", &fields.entry_point)?;
                } else {
                    object.put_string(&bump, b"module", &fields.entry_point)?;
                    object.put_string(&bump, b"type", b"module")?;
                }
            }

            if fields.private {
                object.put(
                    &bump,
                    b"private",
                    bun_ast::Expr::init(bun_ast::E::Boolean { value: true }, bun_ast::Loc::EMPTY),
                )?;
            }
        }

        let mut need_run_bun_install = !did_load_package_json;
        {
            let all_dependencies = template.dependencies();
            let dependencies = all_dependencies.dependencies;
            let dev_dependencies = all_dependencies.dev_dependencies;
            let mut needed_dependencies = IntegerBitSet::<64>::init_empty();
            let mut needed_dev_dependencies = IntegerBitSet::<64>::init_empty();
            needed_dependencies.set_range_value(
                bun_collections::bit_set::Range {
                    start: 0,
                    end: dependencies.len(),
                },
                true,
            );
            needed_dev_dependencies.set_range_value(
                bun_collections::bit_set::Range {
                    start: 0,
                    end: dev_dependencies.len(),
                },
                true,
            );

            let needs_dependencies = 'brk: {
                if let Some(deps) = object.get(b"dependencies") {
                    for (i, dep) in dependencies.iter().enumerate() {
                        if deps.get(dep.name).is_some() {
                            needed_dependencies.unset(i);
                        }
                    }
                }
                break 'brk needed_dependencies.count() > 0;
            };

            let needs_dev_dependencies = 'brk: {
                if let Some(deps) = object.get(b"devDependencies") {
                    for (i, dep) in dev_dependencies.iter().enumerate() {
                        if deps.get(dep.name).is_some() {
                            needed_dev_dependencies.unset(i);
                        }
                    }
                }
                break 'brk needed_dev_dependencies.count() > 0;
            };

            let needs_typescript_dependency = !minimal
                && 'brk: {
                    if let Some(deps) = object.get(b"devDependencies") {
                        if deps.has_any_property_named(&[b"typescript"]) {
                            break 'brk false;
                        }
                    }
                    if let Some(deps) = object.get(b"peerDependencies") {
                        if deps.has_any_property_named(&[b"typescript"]) {
                            break 'brk false;
                        }
                    }
                    true
                };

            need_run_bun_install =
                needs_dependencies || needs_dev_dependencies || needs_typescript_dependency;

            if needs_dependencies {
                let mut dependencies_object = object.get(b"dependencies").unwrap_or_else(|| {
                    bun_ast::Expr::init(bun_ast::E::Object::default(), bun_ast::Loc::EMPTY)
                });
                let mut iter = needed_dependencies.iter_set();
                while let Some(index) = iter.next() {
                    let dep = &dependencies[index];
                    dependencies_object
                        .data
                        .e_object_mut()
                        .unwrap()
                        .put_string(&bump, dep.name, dep.version)?;
                }
                object.put(&bump, b"dependencies", dependencies_object)?;
            }

            if needs_dev_dependencies {
                let mut obj = object.get(b"devDependencies").unwrap_or_else(|| {
                    bun_ast::Expr::init(bun_ast::E::Object::default(), bun_ast::Loc::EMPTY)
                });
                let mut iter = needed_dev_dependencies.iter_set();
                while let Some(index) = iter.next() {
                    let dep = &dev_dependencies[index];
                    obj.data
                        .e_object_mut()
                        .unwrap()
                        .put_string(&bump, dep.name, dep.version)?;
                }
                object.put(&bump, b"devDependencies", obj)?;
            }

            if needs_typescript_dependency {
                let mut peer_dependencies = object.get(b"peerDependencies").unwrap_or_else(|| {
                    bun_ast::Expr::init(bun_ast::E::Object::default(), bun_ast::Loc::EMPTY)
                });
                peer_dependencies.data.e_object_mut().unwrap().put_string(
                    &bump,
                    b"typescript",
                    b"^5",
                )?;
                object.put(&bump, b"peerDependencies", peer_dependencies)?;
            }
        }

        if template.is_react() {
            template.write_to_package_json(&mut fields, &bump)?;
        }

        'write_package_json: {
            // TODO(port): bun.FD.fromStdFile(package_json_file orelse try std.fs.cwd().createFileZ(...))
            let fd: Fd = match package_json_file.as_ref() {
                Some(f) => f.handle(),
                None => bun_sys::File::create(Fd::cwd(), b"package.json", true)?.handle(),
            };
            let _close = scopeguard::guard(fd, |fd: Fd| {
                let _ = bun_sys::close(fd);
            });
            let mut buffer_writer = js_printer::BufferWriter::init();
            buffer_writer.append_newline = true;
            let mut package_json_writer = js_printer::BufferPrinter::init(buffer_writer);

            let print_result = js_printer::print_json(
                &mut package_json_writer,
                bun_ast::Expr {
                    data: bun_ast::ExprData::EObject(fields.object.unwrap()),
                    loc: bun_ast::Loc::EMPTY,
                },
                &bun_ast::Source::init_empty_file(b"package.json"),
                js_printer::PrintJsonOptions {
                    indent: Default::default(),
                    mangled_props: None,
                    ..Default::default()
                },
            );
            if let Err(err) = print_result {
                Output::pretty_errorln(format_args!(
                    "package.json failed to write due to error {}",
                    err.name(),
                ));
                package_json_file = None;
                break 'write_package_json;
            }
            let written = package_json_writer.ctx.get_written();
            if let Err(err) = bun_sys::File::from_fd(fd).write_all(written) {
                Output::pretty_errorln(format_args!(
                    "package.json failed to write due to error {}",
                    bstr::BStr::new(err.name()),
                ));
                package_json_file = None;
                break 'write_package_json;
            }
            if let Err(err) =
                bun_sys::ftruncate(fd, i64::try_from(written.len()).expect("int cast"))
            {
                Output::pretty_errorln(format_args!(
                    "package.json failed to write due to error {}",
                    bstr::BStr::new(err.name()),
                ));
                package_json_file = None;
                break 'write_package_json;
            }
        }

        if steps.write_gitignore {
            let _ = Assets::create(b".gitignore", Assets::GITIGNORE, &[]);
            // suppressed
        }

        match template {
            Template::Blank | Template::TypescriptLibrary => {
                if !minimal {
                    Template::create_agent_rule();
                }

                if package_json_file.is_some() && !did_load_package_json {
                    Output::prettyln(format_args!(" + <r><d>package.json<r>"));
                    Output::flush();
                }

                if !fields.entry_point.is_empty()
                    && is_safe_entry_point_path(&fields.entry_point)
                    && !exists(&fields.entry_point)
                {
                    if let Some(dirname) = bun_core::dirname(&fields.entry_point) {
                        if dirname != b"." {
                            let _ = bun_sys::make_path(bun_sys::Dir::cwd(), dirname);
                        }
                    }

                    // TODO(port): entry_point must be NUL-terminated for createNew
                    let mut ep_z = fields.entry_point.clone();
                    ep_z.push(0);
                    let ep_zstr = ZStr::from_slice_with_nul(&ep_z[..]);
                    // SAFETY: ep_z[len-1] == 0 written above
                    let _ = Assets::create_new(ep_zstr, b"console.log(\"Hello via Bun!\");");
                    // suppress
                }

                if steps.write_tsconfig {
                    'brk: {
                        let extname = bun_paths::extension(&fields.entry_point);
                        let loader = options::DEFAULT_LOADERS
                            .get(extname)
                            .copied()
                            .unwrap_or(bun_ast::Loader::Ts);
                        let filename: &[u8] = if loader.is_type_script() {
                            b"tsconfig.json"
                        } else {
                            b"jsconfig.json"
                        };
                        if Assets::create_full(
                            Assets::TSCONFIG_JSON,
                            filename,
                            " (for editor autocomplete)",
                            &[],
                        )
                        .is_err()
                        {
                            break 'brk;
                        }
                    }
                }

                if steps.write_readme {
                    let _ = Assets::create(
                        b"README.md",
                        Assets::README_MD,
                        &[
                            (b"name", fields.name.as_slice()),
                            (b"bunVersion", Environment::VERSION_STRING.as_bytes()),
                            (b"entryPoint", fields.entry_point.as_slice()),
                        ],
                    );
                    // suppressed
                }

                if !fields.entry_point.is_empty() && !did_load_package_json {
                    Output::pretty(format_args!("\nTo get started, run:\n\n    "));

                    if strings::index_of_any(&fields.entry_point, b" \"'").is_some() {
                        Output::pretty(format_args!(
                            "<cyan>bun run {}<r>\n\n",
                            bun_fmt::format_json_string_latin1(&fields.entry_point),
                        ));
                    } else {
                        Output::pretty(format_args!(
                            "<cyan>bun run {}<r>\n\n",
                            bstr::BStr::new(&fields.entry_point),
                        ));
                    }
                }

                Output::flush();

                if exists_z(b"package.json") && need_run_bun_install {
                    Output::prettyln(format_args!(""));
                    // Zig: std.process.Child .{stderr,stdin,stdout}=.Inherit → spawnAndWait
                    let self_exe = bun::self_exe_path()?;
                    let _ = bun::spawn_sync_inherit(&[self_exe.as_bytes(), b"install"])?;
                }
            }
            _ => {}
        }

        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Assets
// ──────────────────────────────────────────────────────────────────────────

pub struct Assets;

impl Assets {
    // "known" assets
    pub const GITIGNORE: &'static [u8] = include_bytes!("init/gitignore.default");
    pub const TSCONFIG_JSON: &'static [u8] = include_bytes!("init/tsconfig.default.json");
    pub const README_MD: &'static [u8] = include_bytes!("init/README.default.md");
    pub const README2_MD: &'static [u8] = include_bytes!("init/README2.default.md");

    /// Create a new asset file, overriding anything that already exists. Known
    /// assets will have their contents pre-populated; otherwise the file will be empty.
    ///
    /// PORT NOTE: Zig looked up `asset_name` via `@hasDecl`/`@field` reflection.
    /// Rust takes the asset bytes directly; `asset_name` is the filename.
    fn create(
        asset_name: &[u8],
        asset: &'static [u8],
        args: &[(&[u8], &[u8])],
    ) -> Result<(), Error> {
        let is_template = !args.is_empty();
        Self::create_full_inner(asset, asset_name, "", is_template, args)
    }

    pub fn create_with_contents(
        asset_name: &[u8],
        contents: &'static [u8],
        args: &[(&[u8], &[u8])],
    ) -> Result<(), Error> {
        let is_template = !args.is_empty();
        Self::create_full_with_contents(asset_name, contents, "", is_template, args)
    }

    /// Substitutes Zig-style named placeholders `{[key]s}` in `template` with the
    /// corresponding value from `args`.
    fn substitute(template: &[u8], args: &[(&[u8], &[u8])]) -> Vec<u8> {
        let mut out = Vec::with_capacity(template.len());
        let mut i = 0;
        'outer: while i < template.len() {
            if template[i] == b'{' && template.get(i + 1) == Some(&b'[') {
                for &(key, value) in args {
                    // "{[" + key + "]s}"
                    let placeholder_len = 2 + key.len() + 3;
                    if i + placeholder_len <= template.len()
                        && &template[i + 2..i + 2 + key.len()] == key
                        && &template[i + 2 + key.len()..i + placeholder_len] == b"]s}"
                    {
                        out.extend_from_slice(value);
                        i += placeholder_len;
                        continue 'outer;
                    }
                }
            }
            out.push(template[i]);
            i += 1;
        }
        out
    }

    fn create_new(filename: &ZStr, contents: &[u8]) -> Result<(), Error> {
        // Zig: bun.sys.File.makeOpen — creates parent dirs then opens.
        if let Some(dir) = bun_core::dirname(filename.as_bytes()) {
            if !dir.is_empty() && dir != b"." {
                let _ = bun_sys::make_path(bun_sys::Dir::cwd(), dir);
            }
        }
        let file = bun_sys::File::openat(
            Fd::cwd(),
            filename.as_bytes(),
            bun_sys::O::CREAT | bun_sys::O::EXCL | bun_sys::O::WRONLY,
            0o666,
        )?;
        let _close = scopeguard::guard(file.handle(), |fd| {
            let _ = bun_sys::close(fd);
        });

        file.write_all(contents)?;

        Output::prettyln(format_args!(
            " + <r><d>{}<r>",
            bstr::BStr::new(filename.as_bytes()),
        ));
        Output::flush();
        Ok(())
    }

    fn create_full(
        // content of known asset (Zig looked this up by name via `@field`)
        asset: &'static [u8],
        // name of asset file to create
        filename: &[u8],
        // optionally add a suffix to the end of the `+ filename` message. Must have a leading space.
        message_suffix: &'static str,
        args: &[(&[u8], &[u8])],
    ) -> Result<(), Error> {
        let is_template = !args.is_empty();
        Self::create_full_inner(asset, filename, message_suffix, is_template, args)
    }

    fn create_full_inner(
        asset: &'static [u8],
        filename: &[u8],
        message_suffix: &'static str,
        is_template: bool,
        args: &[(&[u8], &[u8])],
    ) -> Result<(), Error> {
        let file = bun_sys::File::openat(
            Fd::cwd(),
            filename,
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
            0o666,
        )?;
        let _close = scopeguard::guard(file.handle(), |fd| {
            let _ = bun_sys::close(fd);
        });

        // Write contents of known assets to the new file. Template assets get formatted.
        if is_template {
            let buf = Self::substitute(asset, args);
            file.write_all(&buf)?;
        } else {
            file.write_all(asset)?;
        }
        Output::prettyln(format_args!(
            " + <r><d>{}{}<r>",
            bstr::BStr::new(filename),
            message_suffix,
        ));
        Output::flush();
        Ok(())
    }

    fn create_full_with_contents(
        // name of asset file to create
        filename: &[u8],
        contents: &'static [u8],
        // optionally add a suffix to the end of the `+ filename` message. Must have a leading space.
        message_suffix: &'static str,
        // Treat the asset as a format string, using `args` to populate it. Only applies to known assets.
        is_template: bool,
        // Format arguments
        args: &[(&[u8], &[u8])],
    ) -> Result<(), Error> {
        let file = bun_sys::File::openat(
            Fd::cwd(),
            filename,
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
            0o666,
        )?;
        let _close = scopeguard::guard(file.handle(), |fd| {
            let _ = bun_sys::close(fd);
        });

        if is_template {
            let buf = Self::substitute(contents, args);
            file.write_all(&buf)?;
        } else {
            file.write_all(contents)?;
        }

        Output::prettyln(format_args!(
            " + <r><d>{}{}<r>",
            bstr::BStr::new(filename),
            message_suffix,
        ));
        Output::flush();
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PackageJSONFields
// ──────────────────────────────────────────────────────────────────────────

pub struct PackageJSONFields {
    pub name: Vec<u8>,
    pub type_: &'static [u8],
    /// ARENA: allocated from `bun_ast::Expr` Store via `initialize_store()`; no deinit.
    pub object: Option<StoreRef<bun_ast::E::Object>>,
    // TODO(port): Zig type was `[:0]const u8`; we drop the NUL sentinel and
    // re-terminate at FFI boundaries.
    pub entry_point: Vec<u8>,
    pub private: bool,
}

impl Default for PackageJSONFields {
    fn default() -> Self {
        Self {
            name: b"project".to_vec(),
            type_: b"module",
            object: None,
            entry_point: Vec::new(),
            private: true,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Radio choice enums (anonymous in Zig, named here)
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Eq, PartialEq)]
#[repr(u8)]
enum ProjectTemplateChoice {
    Blank = 0,
    React = 1,
    Library = 2,
}

impl RadioChoice for ProjectTemplateChoice {
    const COUNT: usize = 3;
    const DEFAULT: Self = Self::Blank;
    fn fmt(self) -> &'static str {
        match self {
            Self::Blank => "<yellow>Blank<r>",
            Self::React => "<cyan>React<r>",
            Self::Library => "<blue>Library<r>",
        }
    }
    fn from_index(i: usize) -> Self {
        match i {
            0 => Self::Blank,
            1 => Self::React,
            2 => Self::Library,
            _ => unreachable!("RadioChoice index"),
        }
    }
    fn to_index(self) -> usize {
        self as usize
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
#[repr(u8)]
enum ReactTemplateChoice {
    Default = 0,
    Tailwind = 1,
    ShadcnTailwind = 2,
}

impl RadioChoice for ReactTemplateChoice {
    const COUNT: usize = 3;
    const DEFAULT: Self = Self::Default;
    fn fmt(self) -> &'static str {
        match self {
            Self::Default => "<blue>Default (blank)<r>",
            Self::Tailwind => "<magenta>TailwindCSS<r>",
            Self::ShadcnTailwind => "<green>Shadcn + TailwindCSS<r>",
        }
    }
    fn from_index(i: usize) -> Self {
        match i {
            0 => Self::Default,
            1 => Self::Tailwind,
            2 => Self::ShadcnTailwind,
            _ => unreachable!("RadioChoice index"),
        }
    }
    fn to_index(self) -> usize {
        self as usize
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DependencyNeeded / DependencyGroup
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
pub struct DependencyNeeded {
    pub name: &'static [u8],
    pub version: &'static [u8],
}

pub struct DependencyGroup {
    pub dependencies: &'static [DependencyNeeded],
    pub dev_dependencies: &'static [DependencyNeeded],
}

impl DependencyGroup {
    pub const BLANK: DependencyGroup = DependencyGroup {
        dependencies: &[],
        dev_dependencies: &[DependencyNeeded {
            name: b"@types/bun",
            version: b"latest",
        }],
    };

    // PORT NOTE: Zig used comptime array concatenation (`++ blank.devDependencies[0..1].*`).
    // Rust `const` cannot concat slices; the lists are hand-expanded below.
    pub const REACT: DependencyGroup = DependencyGroup {
        dependencies: &[
            DependencyNeeded {
                name: b"react",
                version: b"^19",
            },
            DependencyNeeded {
                name: b"react-dom",
                version: b"^19",
            },
        ],
        dev_dependencies: &[
            DependencyNeeded {
                name: b"@types/react",
                version: b"^19",
            },
            DependencyNeeded {
                name: b"@types/react-dom",
                version: b"^19",
            },
            // ++ blank.devDependencies
            DependencyNeeded {
                name: b"@types/bun",
                version: b"latest",
            },
        ],
    };

    pub const TAILWIND: DependencyGroup = DependencyGroup {
        dependencies: &[
            DependencyNeeded {
                name: b"tailwindcss",
                version: b"^4",
            },
            // ++ react.dependencies
            DependencyNeeded {
                name: b"react",
                version: b"^19",
            },
            DependencyNeeded {
                name: b"react-dom",
                version: b"^19",
            },
        ],
        dev_dependencies: &[
            DependencyNeeded {
                name: b"bun-plugin-tailwind",
                version: b"latest",
            },
            // ++ react.devDependencies
            DependencyNeeded {
                name: b"@types/react",
                version: b"^19",
            },
            DependencyNeeded {
                name: b"@types/react-dom",
                version: b"^19",
            },
            DependencyNeeded {
                name: b"@types/bun",
                version: b"latest",
            },
        ],
    };

    pub const SHADCN: DependencyGroup = DependencyGroup {
        dependencies: &[
            DependencyNeeded {
                name: b"class-variance-authority",
                version: b"latest",
            },
            DependencyNeeded {
                name: b"clsx",
                version: b"latest",
            },
            DependencyNeeded {
                name: b"tailwind-merge",
                version: b"latest",
            },
            DependencyNeeded {
                name: b"tw-animate-css",
                version: b"latest",
            },
            DependencyNeeded {
                name: b"lucide-react",
                version: b"^1",
            },
            DependencyNeeded {
                name: b"@radix-ui/react-label",
                version: b"latest",
            },
            DependencyNeeded {
                name: b"@radix-ui/react-select",
                version: b"latest",
            },
            DependencyNeeded {
                name: b"@radix-ui/react-slot",
                version: b"latest",
            },
            // ++ tailwind.dependencies
            DependencyNeeded {
                name: b"tailwindcss",
                version: b"^4",
            },
            DependencyNeeded {
                name: b"react",
                version: b"^19",
            },
            DependencyNeeded {
                name: b"react-dom",
                version: b"^19",
            },
        ],
        // ++ tailwind.devDependencies
        dev_dependencies: &[
            DependencyNeeded {
                name: b"bun-plugin-tailwind",
                version: b"latest",
            },
            DependencyNeeded {
                name: b"@types/react",
                version: b"^19",
            },
            DependencyNeeded {
                name: b"@types/react-dom",
                version: b"^19",
            },
            DependencyNeeded {
                name: b"@types/bun",
                version: b"latest",
            },
        ],
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Template
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Eq, PartialEq)]
#[repr(u8)]
pub enum Template {
    Blank,
    ReactBlank,
    ReactTailwind,
    ReactTailwindShadcn,
    TypescriptLibrary,
}

pub struct TemplateFile {
    pub path: &'static [u8],
    pub contents: &'static [u8],
    pub can_skip_if_exists: bool,
}

impl TemplateFile {
    const fn new(path: &'static [u8], contents: &'static [u8]) -> Self {
        Self {
            path,
            contents,
            can_skip_if_exists: false,
        }
    }
    const fn new_skip(path: &'static [u8], contents: &'static [u8]) -> Self {
        Self {
            path,
            contents,
            can_skip_if_exists: true,
        }
    }
}

impl Template {
    pub fn should_use_source_file_project_generator(self) -> bool {
        match self {
            Template::Blank | Template::TypescriptLibrary => false,
            _ => true,
        }
    }

    pub fn is_react(self) -> bool {
        match self {
            Template::ReactBlank | Template::ReactTailwind | Template::ReactTailwindShadcn => true,
            _ => false,
        }
    }

    pub fn write_to_package_json(
        self,
        fields: &mut PackageJSONFields,
        bump: &bun_alloc::Arena,
    ) -> Result<(), Error> {
        type Rope = bun_ast::E::Rope;
        fields.name = self.name().to_vec();
        // PORT NOTE: Zig `alloc.create(Rope)` against the default allocator and
        // never frees; allocate in the process-lifetime CLI arena instead.
        let key: &mut Rope = crate::cli::cli_arena().alloc(Rope {
            head: bun_ast::Expr::init(bun_ast::E::String::init(b"scripts"), bun_ast::Loc::EMPTY),
            next: core::ptr::null_mut(),
        });
        // SAFETY: object is arena-allocated and live for the command duration.
        let object = unsafe { &mut *fields.object.unwrap().as_ptr() };
        let mut scripts_json = object.get_or_put_object(key, bump)?;
        let the_scripts = self.scripts();
        let mut i: usize = 0;
        while i < the_scripts.len() {
            let script_name = the_scripts[i];
            let script_command = the_scripts[i + 1];

            scripts_json.data.e_object_mut().unwrap().put_string(
                bump,
                script_name,
                script_command,
            )?;
            i += 2;
        }
        Ok(())
    }

    pub fn dependencies(self) -> &'static DependencyGroup {
        match self {
            Template::Blank => &DependencyGroup::BLANK,
            Template::ReactBlank => &DependencyGroup::REACT,
            Template::ReactTailwind => &DependencyGroup::TAILWIND,
            Template::ReactTailwindShadcn => &DependencyGroup::SHADCN,
            Template::TypescriptLibrary => &DependencyGroup::BLANK,
        }
    }

    pub fn name(self) -> &'static [u8] {
        match self {
            Template::Blank => b"bun-blank-template",
            Template::TypescriptLibrary => b"bun-typescript-library-template",
            Template::ReactBlank => b"bun-react-template",
            Template::ReactTailwind => b"bun-react-tailwind-template",
            Template::ReactTailwindShadcn => b"bun-react-tailwind-shadcn-template",
        }
    }

    pub fn scripts(self) -> &'static [&'static [u8]] {
        match self {
            Template::Blank | Template::TypescriptLibrary => &[],
            Template::ReactTailwind | Template::ReactTailwindShadcn => &[
                b"dev", b"bun './**/*.html'",
                b"build", b"bun 'REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts'",
            ],
            Template::ReactBlank => &[
                b"dev",
                b"bun --hot .",
                b"static",
                b"bun build ./src/index.html --outdir=dist --sourcemap --target=browser --minify --define:process.env.NODE_ENV='\"production\"' --env='BUN_PUBLIC_*'",
                b"build",
                b"NODE_ENV=production bun .",
            ],
        }
    }

    const AGENT_RULE: &'static [u8] = include_bytes!("./init/rule.md");
    // TODO(port): Zig `[:0]const u8` literal — Rust byte literals are not NUL-terminated.
    const CURSOR_RULE: TemplateFile = TemplateFile::new(
        b".cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc",
        Self::AGENT_RULE,
    );
    const CURSOR_RULE_PATH_TO_CLAUDE_MD: &'static [u8] = b"../../CLAUDE.md";

    fn is_claude_code_installed() -> bool {
        #[cfg(windows)]
        {
            // Claude code is not available on Windows, at the time of writing.
            return false;
        }

        // Give some way to opt out.
        if env_var::BUN_AGENT_RULE_DISABLED.get().unwrap_or(false)
            || env_var::CLAUDE_CODE_AGENT_RULE_DISABLED
                .get()
                .unwrap_or(false)
        {
            return false;
        }

        let mut pathbuffer = path_buffer_pool::get();

        let Some(path) = env_var::PATH.get() else {
            return false;
        };
        // SAFETY: FileSystem::instance() returns the process-global singleton.
        let top_level_dir = Fs::FileSystem::get().top_level_dir;
        bun_which::which(&mut *pathbuffer, path, top_level_dir, b"claude").is_some()
    }

    pub fn create_agent_rule() {
        let mut create_claude_md = Self::is_claude_code_installed()
            // Never overwrite CLAUDE.md
            && !exists(b"CLAUDE.md");

        if let Some(template_file) = Self::get_cursor_rule() {
            let mut did_create_agent_rule = false;

            // If both Cursor & Claude is installed, make the cursor rule a
            // symlink to ../../CLAUDE.md
            let asset_path: &[u8] = if create_claude_md {
                b"CLAUDE.md"
            } else {
                template_file.path
            };
            // TODO(port): asset_path / template_file.path need NUL termination for create_new
            let asset_path_z = {
                let mut v = asset_path.to_vec();
                v.push(0);
                v
            };
            let result = Assets::create_new(
                ZStr::from_slice_with_nul(&asset_path_z[..]),
                // SAFETY: asset_path_z[len-1] == 0 written above
                template_file.contents,
            );
            did_create_agent_rule = true;
            if result.is_err() {
                did_create_agent_rule = false;
                if create_claude_md {
                    create_claude_md = false;
                    // If installing the CLAUDE.md fails for some reason, fall back to installing the cursor rule.
                    let mut tp = template_file.path.to_vec();
                    tp.push(0);
                    let _ = Assets::create_new(
                        ZStr::from_slice_with_nul(&tp[..]),
                        // SAFETY: tp[len-1] == 0 written above
                        template_file.contents,
                    );
                }
            }

            #[cfg(not(windows))]
            {
                // if we did create the CLAUDE.md, then symlinks the
                // .cursor/rules/*.mdc -> CLAUDE.md so it's easier to keep them in
                // sync if you change it locally. we use a symlink for the cursor
                // rule in this case so that the github UI for CLAUDE.md (which may
                // appear prominently in repos) doesn't show a file path.
                if did_create_agent_rule && create_claude_md {
                    'symlink_cursor_rule: {
                        create_claude_md = false;
                        let _ = bun_sys::make_path(bun_sys::Dir::cwd(), b".cursor/rules");
                        // bun_sys::symlinkat takes &ZStr; build NUL-terminated copies.
                        let mut target_z = Self::CURSOR_RULE_PATH_TO_CLAUDE_MD.to_vec();
                        target_z.push(0);
                        let mut dest_z = template_file.path.to_vec();
                        dest_z.push(0);
                        // SAFETY: NUL-terminated above.
                        let target_zstr = ZStr::from_slice_with_nul(&target_z[..]);
                        // SAFETY: NUL-terminated above.
                        let dest_zstr = ZStr::from_slice_with_nul(&dest_z[..]);
                        if bun_sys::symlinkat(target_zstr, Fd::cwd(), dest_zstr).is_err() {
                            break 'symlink_cursor_rule;
                        }
                        Output::prettyln(format_args!(
                            " + <r><d>{} -\\> {}<r>",
                            bstr::BStr::new(template_file.path),
                            bstr::BStr::new(asset_path),
                        ));
                        Output::flush();
                    }
                }
            }
        }

        // If cursor is not installed but claude code is installed, then create the CLAUDE.md.
        if create_claude_md {
            // In this case, the frontmatter from the cursor rule is not helpful so let's trim it out.
            let end_of_frontmatter = match strings::last_index_of(Self::AGENT_RULE, b"---\n") {
                Some(start) => start + b"---\n".len(),
                None => 0,
            };

            let _ = Assets::create_new(
                ZStr::from_static(b"CLAUDE.md\0"),
                // SAFETY: literal is NUL-terminated
                &Self::AGENT_RULE[end_of_frontmatter..],
            );
        }
    }

    fn is_cursor_installed() -> bool {
        // Give some way to opt-out.
        if env_var::BUN_AGENT_RULE_DISABLED.get().unwrap_or(false)
            || env_var::CURSOR_AGENT_RULE_DISABLED.get().unwrap_or(false)
        {
            return false;
        }

        // Detect if they're currently using cursor.
        if env_var::CURSOR_TRACE_ID.get().unwrap_or(false) {
            return true;
        }

        #[cfg(target_os = "macos")]
        {
            if bun_sys::exists(b"/Applications/Cursor.app") {
                return true;
            }
        }

        #[cfg(windows)]
        {
            // Zig: `bun.getenvZAnyCase("USER")` walks `std.os.environ` (bun.zig:913).
            // `bun_core::getenv_z_any_case` is a TODO stub on Windows that always
            // returns None (bun_core/util.rs), so calling it here makes the probe
            // dead code. Use `std::env::var`, which on Windows goes through
            // `GetEnvironmentVariableW` (inherently case-insensitive) — matching
            // the Zig any-case semantics.
            if let Ok(user) = std::env::var("USER") {
                let mut pathbuf = path_buffer_pool::get();
                // Zig: `std.fmt.bufPrintZ(..) catch { return false; }` —
                // fallible on overflow, do not panic.
                let path: &ZStr = {
                    use std::io::Write as _;
                    let total = pathbuf.len();
                    let mut cursor: &mut [u8] = &mut pathbuf[..];
                    if cursor
                        .write_fmt(format_args!(
                            "C:\\Users\\{}\\AppData\\Local\\Programs\\Cursor\\Cursor.exe",
                            user
                        ))
                        .is_err()
                    {
                        return false;
                    }
                    let remaining = cursor.len();
                    let written = total - remaining;
                    if written >= total {
                        return false;
                    }
                    pathbuf[written] = 0;
                    // SAFETY: NUL written at pathbuf[written].
                    ZStr::from_buf(&pathbuf[..], written)
                };

                if bun_sys::exists(path.as_bytes()) {
                    return true;
                }
            }
        }

        false
    }

    fn get_cursor_rule() -> Option<&'static TemplateFile> {
        if Self::is_cursor_installed() {
            return Some(&Self::CURSOR_RULE);
        }
        None
    }

    pub fn files(self) -> &'static [TemplateFile] {
        match self {
            Template::ReactBlank => REACT_BLANK_FILES,
            Template::ReactTailwind => REACT_TAILWIND_FILES,
            Template::ReactTailwindShadcn => REACT_SHADCN_FILES,
            // TODO(port): Zig `else => &.{.{ &.{}, &.{} }}` constructs a single
            // bogus TemplateFile; preserved as an empty slice here since the
            // branch is unreachable in practice.
            _ => &[],
        }
    }

    pub fn write_files_and_run_bun_dev(self) -> Result<(), Error> {
        Self::create_agent_rule();

        // PERF(port): Zig used `inline for (comptime this.files())` to unroll per
        // template; we iterate the runtime slice.
        for file in self.files() {
            let path = file.path;
            let contents = file.contents;

            let result = if path == b"README.md" {
                Assets::create_with_contents(
                    b"README.md",
                    contents,
                    &[
                        (b"name", self.name()),
                        (b"bunVersion", Environment::VERSION_STRING.as_bytes()),
                    ],
                )
            } else {
                // TODO(port): path needs NUL termination for create_new
                let mut p = path.to_vec();
                p.push(0);
                Assets::create_new(
                    ZStr::from_slice_with_nul(&p[..]),
                    // SAFETY: p[len-1] == 0 written above
                    contents,
                )
            };
            if let Err(err) = result {
                if err == bun_core::err!("EEXIST") {
                    Output::prettyln(format_args!(
                        " ○ <r><yellow>{}<r> (already exists, skipping)",
                        bstr::BStr::new(path),
                    ));
                    Output::flush();
                } else {
                    Output::err(
                        err,
                        "failed to create file: '{s}'",
                        &[&bstr::BStr::new(path)],
                    );
                    Global::crash();
                }
            }
        }

        Output::pretty(format_args!("\n"));
        Output::flush();

        // Zig: std.process.Child stdin=.Ignore stdout/stderr=.Inherit → spawnAndWait
        // TODO(port): spawn_sync_inherit inherits stdin too; full bun.spawnSync
        // (with Ignore stdin) lives in bun_runtime::api::process::sync.
        let self_exe = bun::self_exe_path()?;
        let _ = bun::spawn_sync_inherit(&[self_exe.as_bytes(), b"install"])?;

        Output::prettyln(format_args!(
            "\n\
             ✨ New project configured!\n\
             \n\
             <b><cyan>Development<r><d> - full-stack dev server with hot reload<r>\n\
             \n\
             \x20   <cyan><b>bun dev<r>\n\
             \n\
             <b><yellow>Static Site<r><d> - build optimized assets to disk (no backend)<r>\n\
             \n\
             \x20   <yellow><b>bun run build<r>\n\
             \n\
             <b><green>Production<r><d> - serve a full-stack production build<r>\n\
             \n\
             \x20   <green><b>bun start<r>\n\
             \n\
             <blue>Happy bunning! 🐇<r>\n",
        ));

        Output::flush();
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Template file lists (Zig: nested `ReactBlank`/`ReactTailwind`/`ReactShadcn`
// structs containing `files` consts)
// ──────────────────────────────────────────────────────────────────────────

static REACT_BLANK_FILES: &[TemplateFile] = &[
    TemplateFile::new(
        b"bunfig.toml",
        include_bytes!("./init/react-app/bunfig.toml"),
    ),
    TemplateFile::new(
        b"package.json",
        include_bytes!("./init/react-app/package.json"),
    ),
    TemplateFile::new(
        b"tsconfig.json",
        include_bytes!("./init/react-app/tsconfig.json"),
    ),
    TemplateFile::new(
        b"bun-env.d.ts",
        include_bytes!("./init/react-app/bun-env.d.ts"),
    ),
    TemplateFile::new(b"README.md", Assets::README2_MD),
    TemplateFile::new_skip(b".gitignore", Assets::GITIGNORE),
    TemplateFile::new(
        b"src/index.ts",
        include_bytes!("./init/react-app/src/index.ts"),
    ),
    TemplateFile::new(
        b"src/App.tsx",
        include_bytes!("./init/react-app/src/App.tsx"),
    ),
    TemplateFile::new(
        b"src/index.html",
        include_bytes!("./init/react-app/src/index.html"),
    ),
    TemplateFile::new(
        b"src/index.css",
        include_bytes!("./init/react-app/src/index.css"),
    ),
    TemplateFile::new(
        b"src/APITester.tsx",
        include_bytes!("./init/react-app/src/APITester.tsx"),
    ),
    TemplateFile::new(
        b"src/react.svg",
        include_bytes!("./init/react-app/src/react.svg"),
    ),
    TemplateFile::new(
        b"src/frontend.tsx",
        include_bytes!("./init/react-app/src/frontend.tsx"),
    ),
    TemplateFile::new(
        b"src/logo.svg",
        include_bytes!("./init/react-app/src/logo.svg"),
    ),
];

static REACT_TAILWIND_FILES: &[TemplateFile] = &[
    TemplateFile::new(
        b"bunfig.toml",
        include_bytes!("./init/react-tailwind/bunfig.toml"),
    ),
    TemplateFile::new(
        b"package.json",
        include_bytes!("./init/react-tailwind/package.json"),
    ),
    TemplateFile::new(
        b"tsconfig.json",
        include_bytes!("./init/react-tailwind/tsconfig.json"),
    ),
    TemplateFile::new(
        b"bun-env.d.ts",
        include_bytes!("./init/react-tailwind/bun-env.d.ts"),
    ),
    TemplateFile::new(b"README.md", Assets::README2_MD),
    TemplateFile::new_skip(b".gitignore", Assets::GITIGNORE),
    TemplateFile::new(
        b"src/index.ts",
        include_bytes!("./init/react-tailwind/src/index.ts"),
    ),
    TemplateFile::new(
        b"src/App.tsx",
        include_bytes!("./init/react-tailwind/src/App.tsx"),
    ),
    TemplateFile::new(
        b"src/index.html",
        include_bytes!("./init/react-tailwind/src/index.html"),
    ),
    TemplateFile::new(
        b"src/index.css",
        include_bytes!("./init/react-tailwind/src/index.css"),
    ),
    TemplateFile::new(
        b"src/APITester.tsx",
        include_bytes!("./init/react-tailwind/src/APITester.tsx"),
    ),
    TemplateFile::new(
        b"src/react.svg",
        include_bytes!("./init/react-tailwind/src/react.svg"),
    ),
    TemplateFile::new(
        b"src/frontend.tsx",
        include_bytes!("./init/react-tailwind/src/frontend.tsx"),
    ),
    TemplateFile::new(
        b"src/logo.svg",
        include_bytes!("./init/react-tailwind/src/logo.svg"),
    ),
    TemplateFile::new(
        b"build.ts",
        include_bytes!("./init/react-tailwind/build.ts"),
    ),
];

static REACT_SHADCN_FILES: &[TemplateFile] = &[
    TemplateFile::new(
        b"bunfig.toml",
        include_bytes!("./init/react-shadcn/bunfig.toml"),
    ),
    TemplateFile::new(
        b"styles/globals.css",
        include_bytes!("./init/react-shadcn/styles/globals.css"),
    ),
    TemplateFile::new(
        b"package.json",
        include_bytes!("./init/react-shadcn/package.json"),
    ),
    TemplateFile::new(
        b"components.json",
        include_bytes!("./init/react-shadcn/components.json"),
    ),
    TemplateFile::new(
        b"tsconfig.json",
        include_bytes!("./init/react-shadcn/tsconfig.json"),
    ),
    TemplateFile::new(
        b"bun-env.d.ts",
        include_bytes!("./init/react-shadcn/bun-env.d.ts"),
    ),
    TemplateFile::new(b"README.md", Assets::README2_MD),
    TemplateFile::new_skip(b".gitignore", Assets::GITIGNORE),
    TemplateFile::new(
        b"src/index.ts",
        include_bytes!("./init/react-shadcn/src/index.ts"),
    ),
    TemplateFile::new(
        b"src/App.tsx",
        include_bytes!("./init/react-shadcn/src/App.tsx"),
    ),
    TemplateFile::new(
        b"src/index.html",
        include_bytes!("./init/react-shadcn/src/index.html"),
    ),
    TemplateFile::new(
        b"src/index.css",
        include_bytes!("./init/react-shadcn/src/index.css"),
    ),
    TemplateFile::new(
        b"src/components/ui/card.tsx",
        include_bytes!("./init/react-shadcn/src/components/ui/card.tsx"),
    ),
    TemplateFile::new(
        b"src/components/ui/label.tsx",
        include_bytes!("./init/react-shadcn/src/components/ui/label.tsx"),
    ),
    TemplateFile::new(
        b"src/components/ui/button.tsx",
        include_bytes!("./init/react-shadcn/src/components/ui/button.tsx"),
    ),
    TemplateFile::new(
        b"src/components/ui/select.tsx",
        include_bytes!("./init/react-shadcn/src/components/ui/select.tsx"),
    ),
    TemplateFile::new(
        b"src/components/ui/input.tsx",
        include_bytes!("./init/react-shadcn/src/components/ui/input.tsx"),
    ),
    TemplateFile::new(
        b"src/components/ui/textarea.tsx",
        include_bytes!("./init/react-shadcn/src/components/ui/textarea.tsx"),
    ),
    TemplateFile::new(
        b"src/APITester.tsx",
        include_bytes!("./init/react-shadcn/src/APITester.tsx"),
    ),
    TemplateFile::new(
        b"src/lib/utils.ts",
        include_bytes!("./init/react-shadcn/src/lib/utils.ts"),
    ),
    TemplateFile::new(
        b"src/react.svg",
        include_bytes!("./init/react-shadcn/src/react.svg"),
    ),
    TemplateFile::new(
        b"src/frontend.tsx",
        include_bytes!("./init/react-shadcn/src/frontend.tsx"),
    ),
    TemplateFile::new(
        b"src/logo.svg",
        include_bytes!("./init/react-shadcn/src/logo.svg"),
    ),
    TemplateFile::new(b"build.ts", include_bytes!("./init/react-shadcn/build.ts")),
];

// ──────────────────────────────────────────────────────────────────────────
// Helpers (Zig: `const exists = bun.sys.exists; const existsZ = bun.sys.existsZ;`)
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub(crate) fn exists(path: &[u8]) -> bool {
    bun_sys::exists(path)
}

/// Refuse entry-point paths that would escape the project directory
/// (absolute paths or any `..` segment), so `bun init` only creates files
/// inside the current working directory.
fn is_safe_entry_point_path(path: &[u8]) -> bool {
    !bun_paths::is_absolute_loose(path)
        && !path.split(|&c| c == b'/' || c == b'\\').any(|seg| seg == b"..")
}

#[inline]
fn exists_z(path: &[u8]) -> bool {
    // TODO(port): Zig `existsZ` takes `[:0]const u8`; here we accept `&[u8]` and
    // let bun_sys handle termination via the non-Z `exists` (copies into a buffer).
    bun_sys::exists(path)
}

// ported from: src/cli/init_command.zig
