use std::io::Write as _;

use crate::cli::command::Context;
use bun_collections::{BabyList, StringArrayHashMap};
use bun_core::{err, Error, Global, Output};
use bun_install::PackageManager;
use bun_js_parser::js_printer as js_printer;
use bun_js_parser::{self as js_ast, E, Expr, ExprData, G};
use bun_json as json;
use bun_logger::{self as logger, Loc, Log, Source};
use bun_paths::{self as path, PathBuffer};
use bun_str::strings;
use bun_sys;

pub struct PmPkgCommand;

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
        // TODO(port): strum::EnumString operates on &str; bytes here are CLI args (ASCII).
        core::str::from_utf8(str).ok().and_then(|s| s.parse().ok())
    }
}

struct PackageJson {
    root: Expr,
    contents: Box<[u8]>,
    source: Source,
    indentation: js_printer::options::Indentation,
}

impl PmPkgCommand {
    pub fn exec(
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
            Output::err_generic(format_args!(
                "Unknown subcommand: {}",
                bstr::BStr::new(positionals[1])
            ));
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
        Output::prettyln(
            const_format::concatcp!(
                "<r><b>bun pm pkg<r> <d>v",
                Global::PACKAGE_JSON_VERSION_WITH_SHA,
                "<r>"
            ),
            format_args!(""),
        );
        // Note: Zig `{{` / `}}` escapes are for std.fmt; Rust raw string keeps literal braces.
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
  <d>$<r> <b><green>bun pm pkg<r> <cyan>delete<r> <blue>scripts.test devDependencies.webpack<r>
  <d>$<r> <b><green>bun pm pkg<r> <cyan>fix<r>

<b>More info<r>: <magenta>https://bun.com/docs/cli/pm#pkg<r>
"#;
        Output::pretty(HELP_TEXT, format_args!(""));
        Output::flush();
    }

    fn find_package_json(cwd: &[u8]) -> Result<Box<[u8]>, Error> {
        let mut path_buf = PathBuffer::uninit();
        let mut current_dir = cwd;

        loop {
            let pkg_path =
                path::join_abs_string_buf_z(current_dir, &mut path_buf, &[b"package.json"], path::Style::Auto);
            if bun_sys::exists_z(pkg_path) {
                return Ok(Box::<[u8]>::from(pkg_path.as_bytes()));
            }

            let parent = path::dirname(current_dir, path::Style::Auto);
            if strings::eql(parent, current_dir) {
                break;
            }
            current_dir = parent;
        }

        Output::err_generic(format_args!("No package.json found"));
        Global::exit(1);
    }

    fn load_package_json(ctx: &Context, path: &[u8]) -> Result<PackageJson, Error> {
        let contents: Box<[u8]> = match bun_sys::File::read_from(bun_sys::Fd::cwd(), path) {
            Ok(b) => b,
            Err(e) => {
                Output::err_generic(format_args!("Failed to read package.json: {}", e.name()));
                Global::exit(1);
            }
        };

        let source = Source::init_path_string(path, &contents);
        let result = match json::parse_package_json_utf8_with_opts(
            &source,
            ctx.log,
            json::ParseOptions {
                is_json: true,
                allow_comments: true,
                allow_trailing_commas: true,
                guess_indentation: true,
                ..Default::default()
            },
        ) {
            Ok(r) => r,
            Err(e) => {
                Output::err_generic(format_args!("Failed to parse package.json: {}", e.name()));
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
            Output::err_generic(format_args!("package.json root must be an object"));
            Global::exit(1);
        }

        if args.is_empty() {
            let formatted = Self::format_json(pkg.root, None)?;
            Output::println(format_args!("{}", bstr::BStr::new(&formatted)));
            return Ok(());
        }

        let mut results: StringArrayHashMap<Box<[u8]>> = StringArrayHashMap::new();

        for &key in args {
            match Self::get_json_value(pkg.root, key, if args.len() > 1 { Some(4) } else { Some(2) }) {
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
                            .map_err(|_| err!("WriteFailed"))?;
                            results.put(key, new_value.into_boxed_slice())?;
                            continue;
                        }
                    }
                    results.put(key, value)?;
                }
                Err(e) => {
                    if e == err!("InvalidPath") {
                        if strings::index_of(key, b"[]").is_some() {
                            Output::err_generic(format_args!(
                                "Empty brackets are not valid syntax for retrieving values."
                            ));
                            Global::exit(1);
                        }
                    }
                    if e != err!("NotFound") {
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
            Output::err_generic(format_args!(
                "<blue>bun pm pkg set<r> expects a key=value pair of args"
            ));
            Global::exit(1);
        }

        let parse_json = pm.options.json_output;

        let path = Self::find_package_json(cwd)?;

        let pkg = Self::load_package_json(ctx, &path)?;

        let mut root = pkg.root;
        if !matches!(root.data, ExprData::EObject(_)) {
            Output::err_generic(format_args!("package.json root must be an object"));
            Global::exit(1);
        }

        let mut modified = false;
        for &arg in args {
            let Some(eq_pos) = strings::index_of(arg, b"=") else {
                Output::err_generic(format_args!(
                    "Invalid argument: {} (expected key=value)",
                    bstr::BStr::new(arg)
                ));
                Global::exit(1);
            };

            let key = &arg[..eq_pos];
            let value = &arg[eq_pos + 1..];

            if key.is_empty() {
                Output::err_generic(format_args!(
                    "Empty key in argument: {}",
                    bstr::BStr::new(arg)
                ));
                Global::exit(1);
            }

            if value.is_empty() {
                Output::err_generic(format_args!(
                    "Empty value in argument: {}",
                    bstr::BStr::new(arg)
                ));
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
            Output::err_generic(format_args!(
                "<blue>bun pm pkg <b>delete<r> expects key args"
            ));
            Global::exit(1);
        }

        let path = Self::find_package_json(cwd)?;

        let pkg = Self::load_package_json(ctx, &path)?;

        let mut root = pkg.root;
        if !matches!(root.data, ExprData::EObject(_)) {
            Output::err_generic(format_args!("package.json root must be an object"));
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
                    if e != err!("NotFound") {
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
            Output::err_generic(format_args!("package.json root must be an object"));
            Global::exit(1);
        }

        let mut modified = false;

        if let Some(name_prop) = root.get(b"name") {
            if let ExprData::EString(str) = &name_prop.data {
                let name_str = str.slice();
                let lowercase: Vec<u8> =
                    name_str.iter().map(|b| b.to_ascii_lowercase()).collect();

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
                        let bin_path = str.slice();
                        let mut pkg_dir = path::dirname(&path, path::Style::Auto);
                        if pkg_dir.is_empty() {
                            pkg_dir = cwd;
                        }
                        let mut buf = PathBuffer::uninit();
                        let full_path = path::join_abs_string_buf_z(
                            pkg_dir,
                            &mut buf,
                            &[bin_path],
                            path::Style::Auto,
                        );

                        if !bun_sys::exists_z(full_path) {
                            Output::warn(format_args!(
                                "No bin file found at {}",
                                bstr::BStr::new(bin_path)
                            ));
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
            ExprData::EBoolean(b) => {
                Ok(Box::<[u8]>::from(if b.value { &b"true"[..] } else { &b"false"[..] }))
            }
            ExprData::ENumber(n) => {
                let mut v = Vec::new();
                if n.value.floor() == n.value {
                    write!(&mut v, "{:.0}", n.value).map_err(|_| err!("WriteFailed"))?;
                } else {
                    write!(&mut v, "{}", n.value).map_err(|_| err!("WriteFailed"))?;
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
                    &Source::init_empty_file("expression.json"),
                    js_printer::PrintJsonOptions {
                        mangled_props: None,
                        indent: match initial_indent {
                            Some(indent) => js_printer::options::Indentation {
                                scalar: indent,
                                count: 0,
                                ..Default::default()
                            },
                            None => js_printer::options::Indentation {
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
        if !matches!(root.data, ExprData::EObject(_)) {
            return Err(err!("NotFound"));
        }

        let mut parts = key.split(|b| *b == b'.').filter(|s| !s.is_empty());
        let mut current = root;

        while let Some(part) = parts.next() {
            if let Some(first_bracket) = strings::index_of(part, b"[") {
                let mut remaining_part = part;

                if first_bracket > 0 {
                    let prop_name = &part[..first_bracket];
                    if !matches!(current.data, ExprData::EObject(_)) {
                        return Err(err!("NotFound"));
                    }
                    current = current.get(prop_name).ok_or(err!("NotFound"))?;
                    remaining_part = &part[first_bracket..];
                }

                while let Some(bracket_start) = strings::index_of(remaining_part, b"[") {
                    let bracket_end = strings::index_of(&remaining_part[bracket_start..], b"]")
                        .ok_or(err!("InvalidPath"))?;
                    let actual_bracket_end = bracket_start + bracket_end;
                    let index_str = &remaining_part[bracket_start + 1..actual_bracket_end];

                    if index_str.is_empty() {
                        return Err(err!("InvalidPath"));
                    }

                    if let Some(index) = parse_usize(index_str) {
                        let ExprData::EArray(arr) = &current.data else {
                            return Err(err!("NotFound"));
                        };

                        if index >= arr.items.len() as usize {
                            return Err(err!("NotFound"));
                        }

                        current = arr.items.ptr()[index];
                        // TODO(port): Expr likely Copy via arena handle; verify in Phase B
                    } else {
                        if !matches!(current.data, ExprData::EObject(_)) {
                            return Err(err!("NotFound"));
                        }
                        current = current.get(index_str).ok_or(err!("NotFound"))?;
                    }

                    remaining_part = &remaining_part[actual_bracket_end + 1..];
                    if remaining_part.is_empty() {
                        break;
                    }
                }
            } else {
                if let Some(index) = parse_usize(part) {
                    match &current.data {
                        ExprData::EArray(arr) => {
                            if index >= arr.items.len() as usize {
                                return Err(err!("NotFound"));
                            }
                            current = arr.items.ptr()[index];
                        }
                        ExprData::EObject(_) => {
                            current = current.get(part).ok_or(err!("NotFound"))?;
                        }
                        _ => return Err(err!("NotFound")),
                    }
                } else {
                    if !matches!(current.data, ExprData::EObject(_)) {
                        return Err(err!("NotFound"));
                    }
                    current = current.get(part).ok_or(err!("NotFound"))?;
                }
            }
        }

        Ok(current)
    }

    fn parse_key_path(key: &[u8]) -> Result<Vec<Box<[u8]>>, Error> {
        let mut path_parts: Vec<Box<[u8]>> = Vec::new();
        // errdefer freeing is implicit via Drop on Vec<Box<[u8]>>

        let mut parts = key.split(|b| *b == b'.').filter(|s| !s.is_empty());

        while let Some(part) = parts.next() {
            if let Some(first_bracket) = strings::index_of(part, b"[") {
                let mut remaining_part = part;

                if first_bracket > 0 {
                    let prop_name = &part[..first_bracket];
                    path_parts.push(Box::<[u8]>::from(prop_name));
                    remaining_part = &part[first_bracket..];
                }

                while let Some(bracket_start) = strings::index_of(remaining_part, b"[") {
                    let Some(bracket_end) =
                        strings::index_of(&remaining_part[bracket_start..], b"]")
                    else {
                        return Err(err!("InvalidPath"));
                    };
                    let actual_bracket_end = bracket_start + bracket_end;
                    let index_str = &remaining_part[bracket_start + 1..actual_bracket_end];

                    if index_str.is_empty() {
                        return Err(err!("InvalidPath"));
                    }

                    path_parts.push(Box::<[u8]>::from(index_str));

                    remaining_part = &remaining_part[actual_bracket_end + 1..];
                    if remaining_part.is_empty() {
                        break;
                    }
                }
            } else {
                path_parts.push(Box::<[u8]>::from(part));
            }
        }

        Ok(path_parts)
    }

    fn set_value(
        root: &mut Expr,
        key: &[u8],
        value: &[u8],
        parse_json: bool,
    ) -> Result<(), Error> {
        if !matches!(root.data, ExprData::EObject(_)) {
            return Err(err!("InvalidRoot"));
        }

        if strings::index_of(key, b"[").is_none() {
            let mut path_parts: Vec<&[u8]> = Vec::new();
            for part in key.split(|b| *b == b'.').filter(|s| !s.is_empty()) {
                path_parts.push(part);
            }

            if path_parts.is_empty() {
                return Err(err!("EmptyKey"));
            }

            if path_parts.len() == 1 {
                let expr = Self::parse_value(value, parse_json)?;
                root.as_e_object_mut().put(path_parts[0], expr)?;
                // TODO(port): as_e_object_mut() assumed accessor on ExprData; verify API in Phase B
                return Ok(());
            }

            Self::set_nested_simple(root, &path_parts, value, parse_json)?;
            return Ok(());
        }

        let mut path_parts = Self::parse_key_path(key)?;

        if path_parts.is_empty() {
            return Err(err!("EmptyKey"));
        }

        if path_parts.len() == 1 {
            let expr = Self::parse_value(value, parse_json)?;

            root.as_e_object_mut().put(&path_parts[0], expr)?;

            // PORT NOTE: Zig's `path_parts[0] = ""` here was an ownership-transfer hack to neuter
            // the caller's `defer allocator.free(part)`. That defer is gone (Vec<Box<[u8]>> drops
            // its elements), so the assignment is deleted.
            return Ok(());
        }

        Self::set_nested(root, &mut path_parts, value, parse_json)
    }

    fn set_nested_simple(
        root: &mut Expr,
        path: &[&[u8]],
        value: &[u8],
        parse_json: bool,
    ) -> Result<(), Error> {
        if path.is_empty() {
            return Ok(());
        }

        let current_key = path[0];
        let remaining_path = &path[1..];

        if remaining_path.is_empty() {
            let expr = Self::parse_value(value, parse_json)?;
            root.as_e_object_mut().put(current_key, expr)?;
            return Ok(());
        }

        let mut nested_obj = root.get(current_key);
        if nested_obj.is_none()
            || !matches!(nested_obj.as_ref().unwrap().data, ExprData::EObject(_))
        {
            let new_obj = Expr::init(E::Object::default(), Loc::EMPTY);
            root.as_e_object_mut().put(current_key, new_obj)?;
            nested_obj = root.get(current_key);
        }

        if !matches!(nested_obj.as_ref().unwrap().data, ExprData::EObject(_)) {
            return Err(err!("ExpectedObject"));
        }

        let mut nested = nested_obj.unwrap();
        Self::set_nested_simple(&mut nested, remaining_path, value, parse_json)?;
        root.as_e_object_mut().put(current_key, nested)?;
        Ok(())
    }

    fn set_nested(
        root: &mut Expr,
        path: &mut [Box<[u8]>],
        value: &[u8],
        parse_json: bool,
    ) -> Result<(), Error> {
        if path.is_empty() {
            return Ok(());
        }

        // PORT NOTE: Zig's `path[0] = ""` writes were an ownership-transfer hack to neuter the
        // caller's `defer allocator.free(part)` (manual move semantics). In Zig, `current_key`
        // is a VALUE copy of the slice descriptor taken before the clear, so `root.get(current_key)`
        // still sees the original key. That defer is gone in Rust (Drop handles it), so the
        // clears are deleted and `path` no longer needs interior mutation here.
        let (head, remaining_path) = path.split_first_mut().unwrap();
        let current_key: &[u8] = head;

        if remaining_path.is_empty() {
            let expr = Self::parse_value(value, parse_json)?;

            root.as_e_object_mut().put(current_key, expr)?;

            return Ok(());
        }

        let mut nested_obj = root.get(current_key);
        if nested_obj.is_none()
            || !matches!(nested_obj.as_ref().unwrap().data, ExprData::EObject(_))
        {
            let new_obj = Expr::init(E::Object::default(), Loc::EMPTY);

            root.as_e_object_mut().put(current_key, new_obj)?;

            nested_obj = root.get(current_key);
        }

        if !matches!(nested_obj.as_ref().unwrap().data, ExprData::EObject(_)) {
            return Err(err!("ExpectedObject"));
        }

        let mut nested = nested_obj.unwrap();
        Self::set_nested(&mut nested, remaining_path, value, parse_json)
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

            if let Some(int_val) = parse_i64(value) {
                return Ok(Expr::init(E::Number { value: int_val as f64 }, Loc::EMPTY));
            }

            if let Some(float_val) = parse_f64(value) {
                return Ok(Expr::init(E::Number { value: float_val }, Loc::EMPTY));
            }

            let temp_source = Source::init_path_string(b"package.json", value);
            let mut temp_log = Log::init();
            if let Ok(json_expr) = json::parse_package_json_utf8(&temp_source, &mut temp_log) {
                return Ok(json_expr);
            } else {
                let data = Box::<[u8]>::from(value);
                return Ok(Expr::init(E::String::init(data), Loc::EMPTY));
            }
        } else {
            let data = Box::<[u8]>::from(value);
            Ok(Expr::init(E::String::init(data), Loc::EMPTY))
        }
    }

    fn delete_value(root: &mut Expr, key: &[u8]) -> Result<bool, Error> {
        if !matches!(root.data, ExprData::EObject(_)) {
            return Ok(false);
        }

        let mut path_parts: Vec<&[u8]> = Vec::new();
        for part in key.split(|b| *b == b'.').filter(|s| !s.is_empty()) {
            path_parts.push(part);
        }

        if path_parts.is_empty() {
            return Ok(false);
        }

        if path_parts.len() == 1 {
            let exists = root.get(path_parts[0]).is_some();
            if exists {
                return Self::remove_property(root, path_parts[0]);
            }
            return Ok(false);
        }

        Self::delete_nested(root, &path_parts)
    }

    fn delete_nested(root: &mut Expr, path: &[&[u8]]) -> Result<bool, Error> {
        if path.is_empty() {
            return Ok(false);
        }

        let current_key = path[0];
        let remaining_path = &path[1..];

        if remaining_path.is_empty() {
            let exists = root.get(current_key).is_some();
            if exists {
                return Self::remove_property(root, current_key);
            }
            return Ok(false);
        }

        let nested_obj = root.get(current_key);
        if nested_obj.is_none()
            || !matches!(nested_obj.as_ref().unwrap().data, ExprData::EObject(_))
        {
            return Ok(false);
        }

        let mut nested = nested_obj.unwrap();
        let deleted = Self::delete_nested(&mut nested, remaining_path)?;

        if deleted {
            root.as_e_object_mut().put(current_key, nested)?;
        }

        Ok(deleted)
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
        let mut new_props: BabyList<G::Property> =
            BabyList::init_capacity(old_props.len() - 1)?;
        for prop in old_props {
            if let Some(k) = &prop.key {
                if let ExprData::EString(s) = &k.data {
                    if strings::eql(&s.data, key) {
                        continue;
                    }
                }
            }
            new_props.push(*prop);
            // PERF(port): was appendAssumeCapacity — profile in Phase B
        }
        e_obj.properties = new_props;

        Ok(true)
    }

    fn save_package_json(
        path: &[u8],
        root: Expr,
        pkg: &PackageJson,
    ) -> Result<(), Error> {
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
            Output::err_generic(format_args!(
                "Failed to serialize package.json: {}",
                e.name()
            ));
            Global::exit(1);
        }

        let content = writer.ctx.written_without_trailing_zero();
        // TODO(port): Zig used std.fs.cwd().writeFile; using bun_sys per porting rules (no std::fs).
        if let Err(e) = bun_sys::File::write_file(bun_sys::Fd::cwd(), path, content) {
            Output::err_generic(format_args!("Failed to write package.json: {}", e.name()));
            Global::exit(1);
        }
        Ok(())
    }
}

// ───── helpers ────────────────────────────────────────────────────────────

#[inline]
fn parse_usize(s: &[u8]) -> Option<usize> {
    // Digits are ASCII; from_utf8 cannot fail on valid integer literals, and
    // parse() rejects on non-digit bytes — matches std.fmt.parseInt(usize, s, 10).
    core::str::from_utf8(s).ok()?.parse::<usize>().ok()
}

#[inline]
fn parse_i64(s: &[u8]) -> Option<i64> {
    core::str::from_utf8(s).ok()?.parse::<i64>().ok()
}

#[inline]
fn parse_f64(s: &[u8]) -> Option<f64> {
    core::str::from_utf8(s).ok()?.parse::<f64>().ok()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/pm_pkg_command.zig (782 lines)
//   confidence: medium
//   todos:      4
//   notes:      Expr/ExprData accessor surface (as_e_object_mut, get, init) assumed; Zig path[0]="" ownership-transfer writes deleted (Drop handles it) — set_nested re-get now uses original key per Zig value-copy semantics; std.fs.writeFile mapped to bun_sys::File::write_file.
// ──────────────────────────────────────────────────────────────────────────
