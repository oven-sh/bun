use std::io::Write as _;

use crate::Error;
use crate::cli::command::Context;
use bun_ast::{E, Expr, ExprData, G};
use bun_ast::{Loc, Log, Source};
use bun_collections::{StringArrayHashMap, VecExt};
use bun_core::fmt::quote;
use bun_core::strings;
use bun_core::{Global, Output};
use bun_install::PackageManager;
use bun_js_printer as js_printer;
use bun_parsers::json;
use bun_paths::{self as path, PathBuffer};
use bun_sys;

pub(crate) struct PmPkgCommand;

/// Process-lifetime arena for `E::Object::put()` / `json::parse` calls.
/// Route through the shared CLI arena (`MimallocArena` is `Sync`, so this is
/// just a `LazyLock` borrow).
#[inline]
fn dummy_bump() -> &'static bun_alloc::Arena {
    crate::cli::cli_arena()
}

// `bun_ast::Indentation` and `bun_js_printer::Indentation` are now the same
#[derive(Copy, Clone, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum SubCommand {
    Get,
    Set,
    Delete,
    Fix,
    Help,
}

impl SubCommand {
    fn from_string(str: &[u8]) -> Option<SubCommand> {
        // strum's `FromStr` needs `&str`; CLI sub-command names are pure-ASCII.
        bun_core::fmt::parse_ascii(str)
    }
}

struct PackageJson {
    root: Expr,
    contents: Box<[u8]>,
    source: Source,
    indentation: bun_ast::Indentation,
}

/// One step of a key path such as `contributors[0].name` or `keywords[]`.
#[derive(Clone, Copy)]
struct Segment<'a> {
    kind: SegmentKind<'a>,
    /// Offset just past this segment in the key; errors name a value by `&key[..end]`.
    end: usize,
}

#[derive(Clone, Copy)]
enum SegmentKind<'a> {
    /// `b` in `a.b` or `a[b]`: an index when applied to an array, otherwise a property name.
    Key { name: &'a [u8], bracketed: bool },
    /// `[]`: the slot after the last element of an array.
    Append,
}

impl Segment<'_> {
    /// `files[0]=x` and `files[]=x` create an array; `config.0=x` creates an object keyed `"0"`.
    fn creates_array(self) -> bool {
        match self.kind {
            SegmentKind::Key {
                name,
                bracketed: true,
            } => array_index(name).is_some(),
            SegmentKind::Key { .. } => false,
            SegmentKind::Append => true,
        }
    }
}

fn array_index(name: &[u8]) -> Option<usize> {
    bun_core::fmt::parse_decimal::<usize>(name)
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

        let Some(subcommand) = SubCommand::from_string(positionals[1]) else {
            Output::err_generic(
                "Unknown subcommand: {s}",
                (bstr::BStr::new(positionals[1]),),
            );
            Self::print_help();
            Global::exit(1);
        };

        match subcommand {
            SubCommand::Get => Self::exec_get(ctx, pm, &positionals[2..], cwd)?,
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

    fn find_package_json(cwd: &[u8]) -> Result<Box<[u8]>, Error> {
        let mut path_buf = PathBuffer::uninit();
        let mut current_dir = cwd;

        loop {
            let pkg_path = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
                current_dir,
                &mut path_buf,
                &[b"package.json"],
            );
            if bun_sys::exists_z(pkg_path) {
                return Ok(Box::<[u8]>::from(pkg_path.as_bytes()));
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

    fn load_package_json(ctx: &Context, path: &[u8]) -> Result<PackageJson, Error> {
        let contents: Box<[u8]> = match bun_sys::File::read_from(bun_sys::Fd::cwd(), path) {
            Ok(b) => b.into(),
            Err(e) => {
                Output::err_generic(
                    "Failed to read package.json: {s}",
                    (bstr::BStr::new(e.name()),),
                );
                Global::exit(1);
            }
        };

        let source = Source::init_path_string(path, &contents[..]);
        // Use the process-lifetime CLI arena
        // so the returned `Expr` (which may reference arena-owned nodes)
        // outlives this frame. CLI is one-shot.
        let bump: &'static bun_alloc::Arena = crate::cli::cli_arena();
        // SAFETY: CLI dispatch is single-threaded; no other borrow of
        // `ctx.log` is live while `log` is passed to the JSON parser below.
        let log: &mut Log = unsafe { ctx.log_mut() };
        let result = match json::parse_package_json_utf8_with_opts(
            json::JSONOptions {
                json_warn_duplicate_keys: false,
                guess_indentation: true,
                ..json::PACKAGE_JSON_OPTS
            },
            &source,
            log,
            bump,
        ) {
            Ok(r) => r,
            Err(e) => {
                Output::err_generic("Failed to parse package.json: {s}", (e.name(),));
                Global::exit(1);
            }
        };

        Ok(PackageJson {
            root: result.root,
            contents,
            source,
            indentation: result.indentation,
        })
    }

    fn exec_get(
        ctx: &Context,
        _pm: &mut PackageManager,
        args: &[&[u8]],
        cwd: &[u8],
    ) -> Result<(), Error> {
        let path = Self::find_package_json(cwd)?;

        let pkg = Self::load_package_json(ctx, &path)?;

        if !matches!(pkg.root.data, ExprData::EObject(_)) {
            Output::err_generic("package.json root must be an object", ());
            Global::exit(1);
        }

        if args.is_empty() {
            let formatted = Self::format_json(pkg.root, None)?;
            Output::println(format_args!("{}", bstr::BStr::new(&formatted)));
            return Ok(());
        }

        let mut results: StringArrayHashMap<Box<[u8]>> = StringArrayHashMap::new();

        for &key in args {
            match Self::get_json_value(
                pkg.root,
                key,
                if args.len() > 1 { Some(4) } else { Some(2) },
            ) {
                Ok(value) => {
                    if args.len() > 1 {
                        if let Some(last_index) = strings::last_index_of_char(&value, b'}') {
                            let mut new_value = Vec::with_capacity(value.len() + 2);
                            write!(
                                &mut new_value,
                                "{}  {}",
                                bstr::BStr::new(&value[..last_index]),
                                bstr::BStr::new(&value[last_index..])
                            )
                            .map_err(|_| crate::Error::WriteFailed)?;
                            results.put(key, new_value.into_boxed_slice())?;
                            continue;
                        }
                    }
                    results.put(key, value)?;
                }
                Err(e) => {
                    if matches!(e, crate::Error::InvalidPath) {
                        if strings::index_of(key, b"[]").is_some() {
                            Output::err_generic(
                                "Empty brackets are not valid syntax for retrieving values.",
                                (),
                            );
                            Global::exit(1);
                        }
                    }
                    if !matches!(e, crate::Error::NotFound) {
                        return Err(e);
                    }
                }
            }
        }

        if results.count() == 0 {
            Output::println(format_args!("{{}}"));
        } else if results.count() == 1 {
            let value = &results.values()[0];
            Output::println(format_args!("{}", bstr::BStr::new(value)));
        } else {
            Output::println(format_args!("{{"));
            let count = results.count();
            for (i, (key, value)) in results.keys().iter().zip(results.values()).enumerate() {
                let comma = if i == count - 1 { "" } else { "," };
                Output::println(format_args!(
                    "  \"{}\": {}{}",
                    bstr::BStr::new(key),
                    bstr::BStr::new(value),
                    comma
                ));
            }
            Output::println(format_args!("}}"));
        }
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

        let path = Self::find_package_json(cwd)?;

        let pkg = Self::load_package_json(ctx, &path)?;

        let mut root = pkg.root;
        if !matches!(root.data, ExprData::EObject(_)) {
            Output::err_generic("package.json root must be an object", ());
            Global::exit(1);
        }

        let mut modified = false;
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
            modified = true;
        }

        if modified {
            Self::save_package_json(&path, root, &pkg)?;
        }
        Ok(())
    }

    fn exec_delete(
        ctx: &Context,
        _pm: &mut PackageManager,
        args: &[&[u8]],
        cwd: &[u8],
    ) -> Result<(), Error> {
        if args.is_empty() {
            Output::err_generic("<blue>bun pm pkg <b>delete<r> expects key args", ());
            Global::exit(1);
        }

        let path = Self::find_package_json(cwd)?;

        let pkg = Self::load_package_json(ctx, &path)?;

        let mut root = pkg.root;
        if !matches!(root.data, ExprData::EObject(_)) {
            Output::err_generic("package.json root must be an object", ());
            Global::exit(1);
        }

        let mut modified = false;
        for &key in args {
            match Self::delete_value(&mut root, key) {
                Ok(deleted) => {
                    if deleted {
                        modified = true;
                    }
                }
                Err(e) => {
                    if !matches!(e, crate::Error::NotFound) {
                        return Err(e);
                    }
                }
            }
        }

        if modified {
            Self::save_package_json(&path, root, &pkg)?;
        }
        Ok(())
    }

    fn exec_fix(ctx: &Context, _pm: &mut PackageManager, cwd: &[u8]) -> Result<(), Error> {
        let path = Self::find_package_json(cwd)?;

        let pkg = Self::load_package_json(ctx, &path)?;

        let mut root = pkg.root;
        if !matches!(root.data, ExprData::EObject(_)) {
            Output::err_generic("package.json root must be an object", ());
            Global::exit(1);
        }

        let mut modified = false;

        if let Some(name_prop) = root.get(b"name") {
            if let ExprData::EString(str) = &name_prop.data {
                let name_str = str.slice8();
                let lowercase: Vec<u8> = name_str.iter().map(|b| b.to_ascii_lowercase()).collect();

                if !strings::eql(name_str, &lowercase) {
                    Self::set_value(&mut root, b"name", &lowercase, false)?;
                    modified = true;
                }
            }
        }

        if let Some(bin_prop) = root.get(b"bin") {
            if let ExprData::EObject(obj) = &bin_prop.data {
                let props = obj.properties.slice();
                for prop in props {
                    let Some(value) = &prop.value else { continue };

                    if let ExprData::EString(str) = &value.data {
                        let bin_path = str.slice8();
                        let mut pkg_dir =
                            path::resolve_path::dirname::<path::platform::Auto>(&path);
                        if pkg_dir.is_empty() {
                            pkg_dir = cwd;
                        }
                        let mut buf = PathBuffer::uninit();
                        let full_path = path::resolve_path::join_abs_string_buf_z::<
                            path::platform::Auto,
                        >(pkg_dir, &mut buf, &[bin_path]);

                        if !bun_sys::exists_z(full_path) {
                            bun_core::warn!("No bin file found at {}", bstr::BStr::new(bin_path));
                        }
                    }
                }
            }
        }

        if modified {
            Self::save_package_json(&path, root, &pkg)?;
        }
        Ok(())
    }

    fn format_json(expr: Expr, initial_indent: Option<usize>) -> Result<Box<[u8]>, Error> {
        match &expr.data {
            ExprData::EBoolean(b) => Ok(Box::<[u8]>::from(if b.value {
                &b"true"[..]
            } else {
                &b"false"[..]
            })),
            ExprData::ENumber(n) => {
                let mut v = Vec::new();
                if n.value().floor() == n.value() {
                    write!(&mut v, "{:.0}", n.value()).map_err(|_| crate::Error::WriteFailed)?;
                } else {
                    write!(&mut v, "{}", n.value()).map_err(|_| crate::Error::WriteFailed)?;
                }
                Ok(v.into_boxed_slice())
            }
            ExprData::ENull(_) => Ok(Box::<[u8]>::from(&b"null"[..])),
            _ => {
                let buffer_writer = js_printer::BufferWriter::init();
                let mut printer = js_printer::BufferPrinter::init(buffer_writer);

                js_printer::print_json(
                    &mut printer,
                    expr,
                    &Source::init_empty_file(b"expression.json"),
                    js_printer::PrintJsonOptions {
                        mangled_props: None,
                        indent: match initial_indent {
                            Some(indent) => bun_ast::Indentation {
                                scalar: indent,
                                count: 0,
                                ..Default::default()
                            },
                            None => bun_ast::Indentation {
                                scalar: 2,
                                count: 0,
                                ..Default::default()
                            },
                        },
                        ..Default::default()
                    },
                )?;

                let written = printer.ctx.get_written();
                Ok(Box::<[u8]>::from(written))
            }
        }
    }

    fn get_json_value(
        root: Expr,
        key: &[u8],
        initial_indent: Option<usize>,
    ) -> Result<Box<[u8]>, Error> {
        let expr = Self::resolve_path(root, key)?;
        Self::format_json(expr, initial_indent)
    }

    fn resolve_path(root: Expr, key: &[u8]) -> Result<Expr, Error> {
        let mut current = root;
        for segment in Self::parse_key_path(key)? {
            let SegmentKind::Key { name, .. } = segment.kind else {
                return Err(crate::Error::InvalidPath);
            };
            current = match &current.data {
                ExprData::EArray(array) => array_index(name)
                    .and_then(|index| array.items.slice().get(index).copied())
                    .ok_or(crate::Error::NotFound)?,
                ExprData::EObject(_) => current.get(name).ok_or(crate::Error::NotFound)?,
                _ => return Err(crate::Error::NotFound),
            };
        }
        Ok(current)
    }

    /// Names are sub-slices of `key`; `E::Object::put` stores them by reference (#33186).
    fn parse_key_path(key: &[u8]) -> Result<Vec<Segment<'_>>, Error> {
        let mut segments: Vec<Segment<'_>> = Vec::new();

        let mut part_start = 0;
        for part in strings::split(key, b".") {
            let start = part_start;
            part_start += part.len() + b".".len();

            let name_len = strings::index_of(part, b"[").unwrap_or(part.len());
            if name_len > 0 {
                segments.push(Segment {
                    kind: SegmentKind::Key {
                        name: &part[..name_len],
                        bracketed: false,
                    },
                    end: start + name_len,
                });
            }

            let mut cursor = name_len;
            while let Some(open) = strings::index_of(&part[cursor..], b"[") {
                let open = cursor + open;
                let Some(close) = strings::index_of(&part[open..], b"]") else {
                    return Err(crate::Error::InvalidPath);
                };
                let close = open + close;
                let name = &part[open + 1..close];
                segments.push(Segment {
                    kind: if name.is_empty() {
                        SegmentKind::Append
                    } else {
                        SegmentKind::Key {
                            name,
                            bracketed: true,
                        }
                    },
                    end: start + close + 1,
                });
                cursor = close + 1;
            }
        }

        Ok(segments)
    }

    fn set_value(root: &mut Expr, key: &[u8], value: &[u8], parse_json: bool) -> Result<(), Error> {
        if !matches!(root.data, ExprData::EObject(_)) {
            return Err(crate::Error::InvalidRoot);
        }

        let path = Self::parse_key_path(key)?;
        if path.is_empty() {
            return Err(crate::Error::EmptyKey);
        }

        let expr = Self::parse_value(value, parse_json)?;
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
            let index = match segment.kind {
                SegmentKind::Append => len,
                SegmentKind::Key { name, .. } => match array_index(name) {
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
                            (quote(key), quote(container_name), quote(name)),
                        );
                        Global::exit(1);
                    }
                },
            };
            if index == len {
                array.push(dummy_bump(), Expr::init(E::Null {}, Loc::EMPTY))?;
            }
            let Some(next) = rest.first() else {
                array.items[index] = value;
                return Ok(());
            };
            let mut child = Self::child_container(Some(array.items[index]), *next, key, slot_name);
            array.items[index] = child;
            return Self::set_in_container(&mut child, slot_name, key, rest, value);
        }

        let SegmentKind::Key { name, .. } = segment.kind else {
            Output::err_generic(
                "{s}: cannot append to {s} because it is not an array",
                (quote(key), quote(container_name)),
            );
            Global::exit(1);
        };
        let object = container
            .data
            .e_object_mut()
            .expect("set_value checks the root and child_container only returns arrays or objects");
        let Some(next) = rest.first() else {
            object.put(dummy_bump(), name, value)?;
            return Ok(());
        };
        let mut child = Self::child_container(object.get(name), *next, key, slot_name);
        object.put(dummy_bump(), name, child)?;
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

    fn parse_value(value: &[u8], parse_json: bool) -> Result<Expr, Error> {
        if parse_json {
            if value == b"true" {
                return Ok(Expr::init(E::Boolean { value: true }, Loc::EMPTY));
            } else if value == b"false" {
                return Ok(Expr::init(E::Boolean { value: false }, Loc::EMPTY));
            } else if value == b"null" {
                return Ok(Expr::init(E::Null {}, Loc::EMPTY));
            }

            if let Some(int_val) = bun_core::fmt::parse_decimal::<i64>(value) {
                return Ok(Expr::init(E::Number::new(int_val as f64), Loc::EMPTY));
            }

            if let Some(float_val) = parse_f64(value) {
                return Ok(Expr::init(E::Number::new(float_val), Loc::EMPTY));
            }

            let temp_source = Source::init_path_string(b"package.json", value);
            let mut temp_log = Log::init();
            if let Ok(json_expr) =
                json::parse_package_json_utf8(&temp_source, &mut temp_log, dummy_bump())
            {
                return Ok(json_expr);
            } else {
                let data: &[u8] = dummy_bump().alloc_slice_copy(value);
                return Ok(Expr::init(E::String::init(data), Loc::EMPTY));
            }
        } else {
            let data: &[u8] = dummy_bump().alloc_slice_copy(value);
            Ok(Expr::init(E::String::init(data), Loc::EMPTY))
        }
    }

    fn delete_value(root: &mut Expr, key: &[u8]) -> Result<bool, Error> {
        if !matches!(root.data, ExprData::EObject(_)) {
            return Ok(false);
        }

        Self::delete_in_container(root, &Self::parse_key_path(key)?)
    }

    /// Splices out an array element or removes a property; returns whether anything was removed.
    fn delete_in_container(container: &mut Expr, path: &[Segment<'_>]) -> Result<bool, Error> {
        let [segment, rest @ ..] = path else {
            return Ok(false);
        };
        let SegmentKind::Key { name, .. } = segment.kind else {
            Output::err_generic(
                "Empty brackets are not valid syntax for deleting values.",
                (),
            );
            Global::exit(1);
        };

        let mut child = if let Some(array) = container.data.e_array_mut() {
            let Some(index) = array_index(name).filter(|&index| index < array.items.len()) else {
                return Ok(false);
            };
            if rest.is_empty() {
                array.items.remove(index);
                return Ok(true);
            }
            array.items[index]
        } else {
            if rest.is_empty() {
                return Self::remove_property(container, name);
            }
            let Some(child) = container.get(name) else {
                return Ok(false);
            };
            child
        };
        Self::delete_in_container(&mut child, rest)
    }

    fn remove_property(obj: &mut Expr, key: &[u8]) -> Result<bool, Error> {
        let ExprData::EObject(e_obj) = &mut obj.data else {
            return Ok(false);
        };

        let old_props = e_obj.properties.slice();
        let mut found = false;
        for prop in old_props {
            if let Some(k) = &prop.key {
                if let ExprData::EString(s) = &k.data {
                    if strings::eql(&s.data, key) {
                        found = true;
                        break;
                    }
                }
            }
        }

        if !found {
            return Ok(false);
        }
        let old_len = old_props.len();
        // G::Property is !Copy/!Clone: take the
        // old list, ptr::read kept entries into the new list, then forget the
        // old buffer (CLI is one-shot — leak is intentional, see
        // load_package_json).
        let old = core::mem::ManuallyDrop::new(bun_alloc::AstAlloc::take(&mut e_obj.properties));
        let mut new_props: G::PropertyList = G::PropertyList::init_capacity(old_len - 1);
        for prop in old.slice() {
            if let Some(k) = &prop.key {
                if let ExprData::EString(s) = &k.data {
                    if strings::eql(&s.data, key) {
                        continue;
                    }
                }
            }
            // SAFETY: `old` is wrapped in `ManuallyDrop` so each Property is
            // moved (not duplicated) into `new_props`.
            new_props.append_assume_capacity(unsafe { core::ptr::read(prop) });
        }
        e_obj.properties = new_props;

        Ok(true)
    }

    fn save_package_json(path: &[u8], root: Expr, pkg: &PackageJson) -> Result<(), Error> {
        let preserve_newline =
            !pkg.contents.is_empty() && pkg.contents[pkg.contents.len() - 1] == b'\n';

        let mut buffer_writer = js_printer::BufferWriter::init();
        buffer_writer
            .buffer
            .list
            .reserve((pkg.contents.len() + 1).saturating_sub(buffer_writer.buffer.list.len()));
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
        let path_z = bun_core::ZBox::from_bytes(path);
        if let Err(e) = bun_sys::File::write_file(bun_sys::Fd::cwd(), path_z.as_zstr(), content) {
            Output::err_generic(
                "Failed to write package.json: {s}",
                (bstr::BStr::new(e.name()),),
            );
            Global::exit(1);
        }
        Ok(())
    }
}

// ───── helpers ────────────────────────────────────────────────────────────

use bun_core::fmt::parse_f64;
