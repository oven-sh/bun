use std::io::Write as _;

use crate::Error;
use crate::cli::cli_arena;
use crate::cli::command::Context;
use bun_ast::{E, Expr, ExprData};
use bun_ast::{Loc, Log, Source};
use bun_collections::{StringArrayHashMap, VecExt};
use bun_core::fmt::quote;
use bun_core::strings;
use bun_core::{Global, Output};
use bun_install::PackageManager;
use bun_js_printer as js_printer;
use bun_parsers::json;
use bun_paths as path;

pub(crate) struct PmPkgCommand;

#[derive(Copy, Clone, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum SubCommand {
    Get,
    Set,
    Delete,
    Fix,
    Help,
}

struct PackageJson {
    path: Box<[u8]>,
    root: Expr,
    contents: Box<[u8]>,
    source: Source,
    indentation: bun_ast::Indentation,
}

/// One step of a key path such as `contributors[0].name` or `keywords[]`.
#[derive(Clone, Copy)]
struct Segment<'a> {
    /// An index when applied to an array, else a property name. Empty only for `[]` (append).
    name: &'a [u8],
    /// `a[b]` rather than `a.b`: `files[0]=x` and `files[]=x` create an array, `config.0=x` an object.
    bracketed: bool,
    /// Offset just past this segment in the key; errors name a value by `&key[..end]`.
    end: usize,
}

impl Segment<'_> {
    fn is_append(self) -> bool {
        self.name.is_empty()
    }

    fn creates_array(self) -> bool {
        self.bracketed
            && (self.is_append() || bun_core::fmt::parse_decimal::<usize>(self.name).is_some())
    }
}

impl PmPkgCommand {
    pub(crate) fn exec(
        ctx: &Context,
        pm: &mut PackageManager,
        positionals: &[&[u8]],
        cwd: &[u8],
    ) -> Result<(), Error> {
        if positionals.len() <= 1 {
            Self::print_help();
            return Ok(());
        }

        let Some(subcommand) = bun_core::fmt::parse_ascii::<SubCommand>(positionals[1]) else {
            Output::err_generic(
                "Unknown subcommand: {s}",
                (bstr::BStr::new(positionals[1]),),
            );
            Self::print_help();
            Global::exit(1);
        };

        match subcommand {
            SubCommand::Get => Self::exec_get(ctx, &positionals[2..], cwd)?,
            SubCommand::Set => Self::exec_set(ctx, pm, &positionals[2..], cwd)?,
            SubCommand::Delete => Self::exec_delete(ctx, pm, &positionals[2..], cwd)?,
            SubCommand::Fix => Self::exec_fix(ctx, pm, cwd)?,
            SubCommand::Help => Self::print_help(),
        }
        Ok(())
    }

    fn print_help() {
        #[allow(clippy::disallowed_methods)]
        // help-text const contains <tag> markup that must be tag-walked
        Output::prettyln(format_args!(
            "{}",
            const_format::concatcp!(
                "<r><b>bun pm pkg<r> <d>v",
                Global::package_json_version_with_sha,
                "<r>"
            )
        ));
        const HELP_TEXT: &str = r#"  Manage data in package.json

<b>Subcommands<r>:
  <cyan>get<r> <blue>[key ...]<r>          Get values from package.json
  <cyan>set<r> <blue>key=value ...<r>      Set values in package.json
    <d>└<r> <cyan>--json<r>             Parse values as JSON (e.g. {"a":1})
  <cyan>delete<r> <blue>key ...<r>         Delete keys from package.json
  <cyan>fix<r>                    Auto-correct common package.json errors

<b>Examples<r>:
  <d>$<r> <b><green>bun pm pkg<r> <cyan>get<r> <blue>name version<r>
  <d>$<r> <b><green>bun pm pkg<r> <cyan>set<r> <blue>description="My awesome package"<r>
  <d>$<r> <b><green>bun pm pkg<r> <cyan>set<r> <blue>keywords='["test","demo","example"]'<r> <cyan>--json<r>
  <d>$<r> <b><green>bun pm pkg<r> <cyan>set<r> <blue>config='{"port":3000,"debug":true}'<r> <cyan>--json<r>
  <d>$<r> <b><green>bun pm pkg<r> <cyan>set<r> <blue>scripts.test="bun test"<r>
  <d>$<r> <b><green>bun pm pkg<r> <cyan>set<r> <blue>bin.mycli=cli.js<r>
  <d>$<r> <b><green>bun pm pkg<r> <cyan>set<r> <blue>'keywords[]=cli' 'files[0]=dist'<r>
  <d>$<r> <b><green>bun pm pkg<r> <cyan>delete<r> <blue>scripts.test devDependencies.webpack<r>
  <d>$<r> <b><green>bun pm pkg<r> <cyan>delete<r> <blue>'keywords[0]'<r>
  <d>$<r> <b><green>bun pm pkg<r> <cyan>fix<r>

<b>More info<r>: <magenta>https://bun.com/docs/cli/pm#pkg<r>
"#;
        #[allow(clippy::disallowed_methods)]
        // help-text const contains <tag> markup and literal JSON braces
        Output::pretty(format_args!("{}", HELP_TEXT));
        Output::flush();
    }

    fn find_package_json(cwd: &[u8]) -> Box<[u8]> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let mut current_dir = cwd;

        loop {
            let pkg_path = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
                current_dir,
                &mut path_buf,
                &[b"package.json"],
            );
            if bun_sys::exists_z(pkg_path) {
                return Box::<[u8]>::from(pkg_path.as_bytes());
            }

            let parent = path::resolve_path::dirname::<path::platform::Auto>(current_dir);
            if strings::eql(parent, current_dir) {
                break;
            }
            current_dir = parent;
        }

        Output::err_generic("No package.json found", ());
        Global::exit(1);
    }

    /// The nearest package.json at or above `cwd`. Its root is an object.
    fn load_package_json(ctx: &Context, cwd: &[u8]) -> PackageJson {
        let path = Self::find_package_json(cwd);
        let contents: Box<[u8]> = match bun_sys::File::read_from(bun_sys::Fd::cwd(), &path) {
            Ok(b) => b.into(),
            Err(e) => {
                Output::err_generic(
                    "Failed to read package.json: {s}",
                    (bstr::BStr::new(e.name()),),
                );
                Global::exit(1);
            }
        };

        let source = Source::init_path_string(&path[..], &contents[..]);
        // SAFETY: CLI dispatch is single-threaded; no other borrow of `ctx.log` is live.
        let log: &mut Log = unsafe { ctx.log_mut() };
        let result = match json::parse_package_json_utf8_with_opts(
            json::JSONOptions {
                json_warn_duplicate_keys: false,
                guess_indentation: true,
                ..json::PACKAGE_JSON_OPTS
            },
            &source,
            log,
            cli_arena(),
        ) {
            Ok(r) => r,
            Err(e) => {
                Output::err_generic("Failed to parse package.json: {s}", (e.name(),));
                Global::exit(1);
            }
        };

        if !matches!(result.root.data, ExprData::EObject(_)) {
            Output::err_generic("package.json root must be an object", ());
            Global::exit(1);
        }

        PackageJson {
            path,
            root: result.root,
            contents,
            source,
            indentation: result.indentation,
        }
    }

    fn exec_get(ctx: &Context, args: &[&[u8]], cwd: &[u8]) -> Result<(), Error> {
        Output::stdout_is_the_result();
        let pkg = Self::load_package_json(ctx, cwd);

        if args.is_empty() {
            let formatted = Self::format_json(pkg.root)?;
            Output::println(format_args!("{}", bstr::BStr::new(&formatted)));
            return Ok(());
        }

        let mut found: StringArrayHashMap<Expr> = StringArrayHashMap::new();
        for &key in args {
            if let Err(e) = Self::query(pkg.root, key, &mut found) {
                if matches!(e, crate::Error::InvalidPath) && strings::index_of(key, b"[]").is_some()
                {
                    Output::err_generic(Self::EMPTY_BRACKETS, ());
                    Global::exit(1);
                }
                return Err(e);
            }
        }

        let value = match found.values() {
            [] => {
                Output::println(format_args!("{{}}"));
                return Ok(());
            }
            [value] => *value,
            values => {
                let mut object = E::Object::default();
                for (key, value) in found.keys().iter().zip(values) {
                    // `put` borrows the label. print_json writes ill-formed UTF-8 as `\x00`.
                    let label: &[u8] = match bstr::ByteSlice::to_str_lossy(&key[..]) {
                        std::borrow::Cow::Borrowed(valid) => valid.as_bytes(),
                        std::borrow::Cow::Owned(replaced) => {
                            cli_arena().alloc_slice_copy(replaced.as_bytes())
                        }
                    };
                    object.put(cli_arena(), label, *value)?;
                }
                Expr::init(object, Loc::EMPTY)
            }
        };

        let formatted = Self::format_json(value)?;
        Output::println(format_args!("{}", bstr::BStr::new(&formatted)));
        Ok(())
    }

    fn exec_set(
        ctx: &Context,
        pm: &mut PackageManager,
        args: &[&[u8]],
        cwd: &[u8],
    ) -> Result<(), Error> {
        if args.is_empty() {
            Output::err_generic(
                "<blue>bun pm pkg set<r> expects a key=value pair of args",
                (),
            );
            Global::exit(1);
        }

        let parse_json = pm.options.json_output;

        let pkg = Self::load_package_json(ctx, cwd);
        let mut root = pkg.root;

        for &arg in args {
            let Some(eq_pos) = strings::index_of(arg, b"=") else {
                Output::err_generic(
                    "Invalid argument: {s} (expected key=value)",
                    (bstr::BStr::new(arg),),
                );
                Global::exit(1);
            };

            let key = &arg[..eq_pos];
            let value = &arg[eq_pos + 1..];

            if key.is_empty() {
                Output::err_generic("Empty key in argument: {s}", (bstr::BStr::new(arg),));
                Global::exit(1);
            }

            if value.is_empty() {
                Output::err_generic("Empty value in argument: {s}", (bstr::BStr::new(arg),));
                Global::exit(1);
            }

            Self::set_value(&mut root, key, value, parse_json)?;
        }

        Self::save_package_json(root, &pkg, pm.options.dry_run);
        Ok(())
    }

    fn exec_delete(
        ctx: &Context,
        pm: &mut PackageManager,
        args: &[&[u8]],
        cwd: &[u8],
    ) -> Result<(), Error> {
        if args.is_empty() {
            Output::err_generic("<blue>bun pm pkg <b>delete<r> expects key args", ());
            Global::exit(1);
        }

        let pkg = Self::load_package_json(ctx, cwd);
        let mut root = pkg.root;

        let mut modified = false;
        for &key in args {
            modified |= Self::delete_in_container(&mut root, &Self::parse_key_path(key)?);
        }

        if modified {
            Self::save_package_json(root, &pkg, pm.options.dry_run);
        }
        Ok(())
    }

    fn exec_fix(ctx: &Context, pm: &mut PackageManager, cwd: &[u8]) -> Result<(), Error> {
        let pkg = Self::load_package_json(ctx, cwd);
        let mut root = pkg.root;

        let mut modified = false;

        if let Some(name_prop) = root.get(b"name")
            && let ExprData::EString(str) = &name_prop.data
        {
            let name_str = str.slice8();
            let lowercase: Vec<u8> = name_str.iter().map(|b| b.to_ascii_lowercase()).collect();

            if !strings::eql(name_str, &lowercase) {
                Self::set_value(&mut root, b"name", &lowercase, false)?;
                modified = true;
            }
        }

        if let Some(bin_prop) = root.get(b"bin")
            && let ExprData::EObject(obj) = &bin_prop.data
        {
            for prop in obj.properties.slice() {
                let Some(value) = &prop.value else { continue };
                let ExprData::EString(str) = &value.data else {
                    continue;
                };
                let bin_path = str.slice8();
                let mut pkg_dir = path::resolve_path::dirname::<path::platform::Auto>(&pkg.path);
                if pkg_dir.is_empty() {
                    pkg_dir = cwd;
                }
                let mut buf = bun_paths::path_buffer_pool::get();
                let full_path = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
                    pkg_dir,
                    &mut buf,
                    &[bin_path],
                );

                if !bun_sys::exists_z(full_path) {
                    bun_core::warn!(
                        "No bin file found at {}",
                        bun_core::fmt::EscapeControlChars(bstr::BStr::new(bin_path))
                    );
                }
            }
        }

        if modified {
            Self::save_package_json(root, &pkg, pm.options.dry_run);
        }
        Ok(())
    }

    fn format_json(expr: Expr) -> Result<Box<[u8]>, Error> {
        let buffer_writer = js_printer::BufferWriter::init();
        let mut printer = js_printer::BufferPrinter::init(buffer_writer);

        js_printer::print_json(
            &mut printer,
            expr,
            &Source::init_empty_file(b"expression.json"),
            js_printer::PrintJsonOptions {
                mangled_props: None,
                indent: bun_ast::Indentation {
                    scalar: 2,
                    count: 0,
                    ..Default::default()
                },
                ..Default::default()
            },
        )?;

        Ok(Box::<[u8]>::from(printer.ctx.get_written()))
    }

    pub(crate) const EMPTY_BRACKETS: &'static str =
        "Empty brackets are not valid syntax for retrieving values.";

    /// As in npm, a name that meets an array (`maintainers.name`) adds `maintainers[0].name`, ...
    pub(crate) fn query(
        root: Expr,
        key: &[u8],
        out: &mut StringArrayHashMap<Expr>,
    ) -> Result<(), Error> {
        let path = Self::parse_key_path(key)?;
        if path.iter().any(|segment| segment.is_append()) {
            return Err(crate::Error::InvalidPath);
        }
        Self::query_in(root, &path, key, &mut Vec::new(), false, out)
    }

    /// `label` spells the path walked so far; it names the value instead of `key` once an array was `expanded`.
    fn query_in(
        value: Expr,
        path: &[Segment<'_>],
        key: &[u8],
        label: &mut Vec<u8>,
        expanded: bool,
        out: &mut StringArrayHashMap<Expr>,
    ) -> Result<(), Error> {
        let [segment, rest @ ..] = path else {
            out.put(if expanded { label.as_slice() } else { key }, value)?;
            return Ok(());
        };
        let label_len = label.len();
        match &value.data {
            ExprData::EArray(array) => match bun_core::fmt::parse_decimal::<usize>(segment.name) {
                Some(index) => {
                    if let Some(item) = array.items.slice().get(index) {
                        let _ = write!(label, "[{index}]");
                        Self::query_in(*item, rest, key, label, expanded, out)?;
                    }
                }
                None => {
                    for (index, item) in array.items.slice().iter().enumerate() {
                        let _ = write!(label, "[{index}]");
                        Self::query_in(*item, path, key, label, true, out)?;
                        label.truncate(label_len);
                    }
                }
            },
            ExprData::EObject(_) => {
                if let Some(next) = value.get(segment.name) {
                    if segment.bracketed {
                        label.push(b'[');
                    } else if label_len > 0 {
                        label.push(b'.');
                    }
                    label.extend_from_slice(segment.name);
                    if segment.bracketed {
                        label.push(b']');
                    }
                    Self::query_in(next, rest, key, label, expanded, out)?;
                }
            }
            _ => {}
        }
        label.truncate(label_len);
        Ok(())
    }

    /// `[...]` holds one literal name, dots included. `E::Object::put` keeps the slices of `key`.
    fn parse_key_path(key: &[u8]) -> Result<Vec<Segment<'_>>, Error> {
        let mut segments: Vec<Segment<'_>> = Vec::new();

        let mut start = 0;
        while start < key.len() {
            let end = strings::index_of_any(&key[start..], b".[").map_or(key.len(), |i| start + i);
            if end > start {
                segments.push(Segment {
                    name: &key[start..end],
                    bracketed: false,
                    end,
                });
            }
            start = end + 1;
            if key.get(end) == Some(&b'[') {
                let Some(close) = strings::index_of_char_usize(&key[start..], b']') else {
                    return Err(crate::Error::InvalidPath);
                };
                let close = start + close;
                segments.push(Segment {
                    name: &key[start..close],
                    bracketed: true,
                    end: close + 1,
                });
                start = close + 1;
            }
        }

        Ok(segments)
    }

    fn set_value(root: &mut Expr, key: &[u8], value: &[u8], parse_json: bool) -> Result<(), Error> {
        let path = Self::parse_key_path(key)?;
        if path.is_empty() {
            return Err(crate::Error::EmptyKey);
        }

        let expr = Self::parse_value(key, value, parse_json);
        Self::set_in_container(root, b"package.json", key, &path, expr)
    }

    /// As in npm, only the final segment may replace a value; anything else in the way is an error.
    fn set_in_container(
        container: &mut Expr,
        container_name: &[u8],
        key: &[u8],
        path: &[Segment<'_>],
        value: Expr,
    ) -> Result<(), Error> {
        let [segment, rest @ ..] = path else {
            return Ok(());
        };
        let slot_name = &key[..segment.end];

        if let Some(array) = container.data.e_array_mut() {
            let len = array.items.len();
            let index = match bun_core::fmt::parse_decimal::<usize>(segment.name) {
                _ if segment.is_append() => len,
                Some(index) if index <= len => index,
                Some(index) => {
                    Output::err_generic(
                        "{s}: index {s} is out of range for {s} (length {s})",
                        (quote(key), index, quote(container_name), len),
                    );
                    bun_core::note!(
                        "{}[] appends to the end of the array",
                        bstr::BStr::new(container_name)
                    );
                    Global::exit(1);
                }
                None => {
                    Output::err_generic(
                        "{s}: {s} is an array, so {s} must be an index or []",
                        (quote(key), quote(container_name), quote(segment.name)),
                    );
                    Global::exit(1);
                }
            };
            if index == len {
                array.push(cli_arena(), Expr::init(E::Null {}, Loc::EMPTY))?;
            }
            let Some(next) = rest.first() else {
                array.items[index] = value;
                return Ok(());
            };
            let mut child = Self::child_container(Some(array.items[index]), *next, key, slot_name);
            array.items[index] = child;
            return Self::set_in_container(&mut child, slot_name, key, rest, value);
        }

        if segment.is_append() {
            Output::err_generic(
                "{s}: cannot append to {s} because it is not an array",
                (quote(key), quote(container_name)),
            );
            Global::exit(1);
        }
        let name = segment.name;
        let object = container
            .data
            .e_object_mut()
            .expect("set_value checks the root and child_container only returns arrays or objects");
        let Some(next) = rest.first() else {
            object.put(cli_arena(), name, value)?;
            return Ok(());
        };
        let mut child = Self::child_container(object.get(name), *next, key, slot_name);
        object.put(cli_arena(), name, child)?;
        Self::set_in_container(&mut child, slot_name, key, rest, value)
    }

    /// A missing or `null` slot gets a new container shaped for `next`.
    fn child_container(
        existing: Option<Expr>,
        next: Segment<'_>,
        key: &[u8],
        slot_name: &[u8],
    ) -> Expr {
        match existing {
            Some(expr) if matches!(expr.data, ExprData::EArray(_) | ExprData::EObject(_)) => expr,
            Some(expr) if !matches!(expr.data, ExprData::ENull(_)) => {
                Output::err_generic(
                    "{s}: {s} already exists and is not an object or array",
                    (quote(key), quote(slot_name)),
                );
                Global::exit(1);
            }
            _ if next.creates_array() => Expr::init(E::Array::default(), Loc::EMPTY),
            _ => Expr::init(E::Object::default(), Loc::EMPTY),
        }
    }

    /// With `--json` a value that is not JSON is an error, as in `npm pkg set --json`.
    fn parse_value(key: &[u8], value: &[u8], parse_json: bool) -> Expr {
        let data: &[u8] = cli_arena().alloc_slice_copy(value);
        if !parse_json {
            return Expr::init(E::String::init(data), Loc::EMPTY);
        }

        let source = Source::init_path_string(key, data);
        let mut log = Log::init();
        match json::parse_utf8_impl::<true>(&source, &mut log, cli_arena()) {
            Ok(expr) if Self::has_only_json_literals(expr, data) => expr,
            _ => {
                let reason: &[u8] = log
                    .msgs
                    .iter()
                    .find(|msg| msg.kind == bun_ast::Kind::Err)
                    .map_or(b"Syntax Error", |msg| &msg.data.text);
                Output::err_generic(
                    "Invalid JSON value for <b>\"{s}\"<r>: {s}",
                    (bstr::BStr::new(key), bstr::BStr::new(reason)),
                );
                bun_core::note!(
                    "--json parses each value as JSON. To store the text as a string, drop --json."
                );
                Global::exit(1);
            }
        }
    }

    /// The JSON parser also accepts JavaScript literals that are not valid JSON, which this
    /// rejects: `010` (parsed as 8), `0x10`, `1_000`, `.5`, `5.`, `'text'`.
    fn has_only_json_literals(root: Expr, source: &[u8]) -> bool {
        let mut pending = vec![root];
        while let Some(expr) = pending.pop() {
            let text = &source[expr.loc.i()..];
            let is_json = match &expr.data {
                ExprData::EString(_) => text.starts_with(b"\""),
                ExprData::ENumber(_) => {
                    let end = strings::index_of_any(text, b",]} \t\r\n").unwrap_or(text.len());
                    let text = text[..end].strip_prefix(b"-").unwrap_or(&text[..end]);
                    let digits = text.iter().take_while(|c| c.is_ascii_digit()).count();
                    let (int, rest) = text.split_at(digits);
                    (int == b"0" || int.first().is_some_and(|&c| c != b'0'))
                        && matches!(rest, [] | [b'e' | b'E', ..] | [b'.', b'0'..=b'9', ..])
                        && !strings::contains_char(rest, b'_')
                }
                ExprData::EArray(array) => {
                    pending.extend_from_slice(array.items.slice());
                    true
                }
                ExprData::EObject(object) => {
                    for prop in object.properties.slice() {
                        pending.extend(prop.key.iter().chain(&prop.value));
                    }
                    true
                }
                _ => true,
            };
            if !is_json {
                return false;
            }
        }
        true
    }

    /// Splices out an array element or removes a property; returns whether anything was removed.
    fn delete_in_container(container: &mut Expr, path: &[Segment<'_>]) -> bool {
        let [segment, rest @ ..] = path else {
            return false;
        };
        let name = segment.name;
        if segment.is_append() {
            Output::err_generic(
                "Empty brackets are not valid syntax for deleting values.",
                (),
            );
            Global::exit(1);
        }

        let mut child = if let Some(array) = container.data.e_array_mut() {
            let Some(index) = bun_core::fmt::parse_decimal::<usize>(name)
                .filter(|&index| index < array.items.len())
            else {
                return false;
            };
            if rest.is_empty() {
                array.items.remove(index);
                return true;
            }
            array.items[index]
        } else {
            if rest.is_empty() {
                return Self::remove_property(container, name);
            }
            let Some(child) = container.get(name) else {
                return false;
            };
            child
        };
        Self::delete_in_container(&mut child, rest)
    }

    fn remove_property(obj: &mut Expr, key: &[u8]) -> bool {
        let ExprData::EObject(e_obj) = &mut obj.data else {
            return false;
        };
        let old_len = e_obj.properties.len();
        e_obj.properties.retain(|prop| {
            !prop.key.as_ref().is_some_and(
                |k| matches!(&k.data, ExprData::EString(s) if strings::eql(&s.data, key)),
            )
        });
        e_obj.properties.len() != old_len
    }

    fn save_package_json(root: Expr, pkg: &PackageJson, dry_run: bool) {
        let preserve_newline = pkg.contents.last() == Some(&b'\n');

        let mut buffer_writer = js_printer::BufferWriter::init();
        buffer_writer.buffer.list.reserve(pkg.contents.len() + 1);
        buffer_writer.append_newline = preserve_newline;

        let mut writer = js_printer::BufferPrinter::init(buffer_writer);

        if let Err(e) = js_printer::print_json(
            &mut writer,
            root,
            &pkg.source,
            js_printer::PrintJsonOptions {
                indent: pkg.indentation,
                mangled_props: None,
                ..Default::default()
            },
        ) {
            Output::err_generic("Failed to serialize package.json: {s}", (e.name(),));
            Global::exit(1);
        }

        let content = writer.ctx.written_without_trailing_zero();
        if dry_run {
            let _ = Output::writer().write_all(content);
            if !preserve_newline {
                let _ = Output::writer().write_all(b"\n");
            }
            Output::flush();
            return;
        }
        let path_z = bun_core::ZBox::from_bytes(&pkg.path);
        if let Err(e) = bun_sys::File::write_file(bun_sys::Fd::cwd(), path_z.as_zstr(), content) {
            Output::err_generic(
                "Failed to write package.json: {s}",
                (bstr::BStr::new(e.name()),),
            );
            Global::exit(1);
        }
    }
}
