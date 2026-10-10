//! `import.meta.glob()` with Vite's semantics: the call becomes an object whose keys are the files
//! that match and whose values are `() => import(file)`, or static imports with `eager`.

use bun_alloc::Arena;
use bun_ast::expr::Data as ExprData;
use bun_ast::fold_string_addition::{FoldStringAdditionKind, fold_string_addition};
use bun_ast::{self as js_ast, B, E, Expr, G, ImportKind, Loc, S, Stmt};
use bun_collections::VecExt;
use bun_core::strings;
use bun_glob::BunGlobWalker;
use bun_paths::resolve_path::{self, platform};
use bun_paths::{fs, path_buffer_pool};

use crate::lexer::T;
use crate::p::P;
use crate::parser::TransposeState;

// `resolve_alias`, for a pattern that is not a path: a directory, and the pattern from there.
bun_dispatch::link_interface! {
    pub ImportMetaGlobHost[Resolver] {
        fn resolve_alias(importer_dir: &[u8], glob: &[u8]) -> Option<(Vec<u8>, Vec<u8>)>;
    }
}

/// What a file does with `import.meta.glob`. The greatest one that applies.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub(crate) enum ImportMetaGlobUse {
    #[default]
    None,
    /// It calls it, and no call could be replaced. Whether one can depends on more than the source.
    Called,
    /// Each call that was replaced needs import statements, which a CommonJS module cannot have.
    ImportedEagerly,
    /// A call was replaced by the files that match.
    Expanded,
    /// It assigns to it, so it calls a function of its own.
    Assigned,
}

#[derive(Clone, Copy, Default)]
struct Options<'a> {
    eager: bool,
    exhaustive: bool,
    /// Empty for the namespace.
    import: &'a [u8],
    /// Empty, or starts with `?`.
    query: &'a [u8],
    base: &'a [u8],
}

/// A pattern, split before its first segment that is not a plain name.
struct Pattern {
    negated: bool,
    /// Absolute. Empty when `glob` applies to the whole path.
    dir: Vec<u8>,
    glob: Vec<u8>,
    /// Every segment is a plain name, and `glob` is the last one.
    is_name: bool,
}

/// What the parser makes an object of.
struct Expansion<'a> {
    eager: bool,
    /// Empty for the namespace.
    import: &'a [u8],
    /// With the value of `type` in the import attributes.
    loader: Option<(js_ast::Loader, &'static [u8])>,
    /// An import that fails is reported at the first pattern.
    path_loc: Loc,
    /// Each key with its import path.
    entries: Vec<(&'a [u8], &'a [u8])>,
}

impl Expansion<'_> {
    /// The arguments of `import(path)`.
    fn import_call(&self, path: &[u8], loc: Loc) -> (Expr, TransposeState) {
        let mut state = TransposeState {
            loc,
            ..Default::default()
        };
        if let Some((loader, r#type)) = self.loader {
            state.import_loader = Some(loader);
            state.import_options = object_of(
                b"with",
                object_of(b"type", Expr::init(E::String::init(r#type), loc)),
            );
        }
        (Expr::init(E::String::init(path), self.path_loc), state)
    }
}

fn is_node_modules(name: &[u8]) -> bool {
    name == b"node_modules"
}

/// `path` relative to `ancestor`, when it is `ancestor` or inside of it.
fn path_below<'p>(ancestor: &[u8], path: &'p [u8]) -> Option<&'p [u8]> {
    let below = path.strip_prefix(ancestor)?;
    if below.is_empty()
        || ancestor
            .last()
            .is_none_or(|&last| bun_paths::is_sep_native(last))
    {
        return Some(below);
    }
    let (&separator, below) = below.split_first()?;
    bun_paths::is_sep_native(separator).then_some(below)
}

/// What Vite leaves as it is in the keys and values of `query`, except that `=` is for values only.
const QUERY_PUNCTUATION: &[u8] = b";,?:@$-_.!~*'()|`^";

fn append_query_component(out: &mut Vec<u8>, text: &[u8], is_key: bool) {
    for &byte in text {
        if byte.is_ascii_alphanumeric()
            || strings::contains_char(QUERY_PUNCTUATION, byte)
            || (byte == b'=' && !is_key)
        {
            out.push(byte);
        } else if byte == b' ' {
            out.push(b'+');
        } else {
            let hex = bun_core::fmt::hex2_upper(byte);
            out.extend_from_slice(&[b'%', hex[0], hex[1]]);
        }
    }
}

/// `None` when it is too long for a path.
fn join(dir: &[u8], path: &[u8]) -> Option<Vec<u8>> {
    let mut buf = path_buffer_pool::get();
    resolve_path::join_abs_string_buf_checked::<platform::Auto>(dir, &mut buf[..], &[path])
        .filter(|joined| joined.len() < bun_paths::MAX_PATH_BYTES)
        .map(<[u8]>::to_vec)
}

fn with_posix_separators(path: &[u8]) -> Vec<u8> {
    let mut path = path.to_vec();
    resolve_path::platform_to_posix_in_place::<u8>(&mut path);
    path
}

/// With `/` on every platform, and `./` unless it starts with `../`. Both are absolute and
/// normalized. `None` when it is too long for a path.
fn relative(from: &[u8], to: &[u8]) -> Option<Vec<u8>> {
    let mut path = Vec::new();
    if cfg!(windows) {
        // Each directory of `from`, at least two bytes of it, can become `../`.
        let mut buf = vec![0u8; from.len() * 2 + to.len() + 8];
        let below =
            resolve_path::relative_platform_buf::<platform::Loose, true>(&mut buf, from, to);
        if !below.starts_with(b"../") {
            path.extend_from_slice(b"./");
        }
        path.extend_from_slice(below);
    } else {
        // `resolve_path` takes a backslash for a separator on every platform. Here it is part of a name.
        let mut from_names = strings::tokenize(from, b"/").peekable();
        let mut to_names = strings::tokenize(to, b"/").peekable();
        while from_names.peek().is_some() && from_names.peek() == to_names.peek() {
            from_names.next();
            to_names.next();
        }
        for _ in from_names {
            path.extend_from_slice(b"../");
        }
        if path.is_empty() {
            path.extend_from_slice(b"./");
        }
        for name in to_names {
            path.extend_from_slice(name);
            path.push(b'/');
        }
        path.pop();
    }
    (path.len() < bun_paths::MAX_PATH_BYTES).then_some(path)
}

/// Whether `import(path)` would load another file than the one `path` names, or none.
fn is_not_an_import_path(path: &[u8], is_bundling: bool) -> bool {
    !strings::is_valid_utf8(path)
        || (!cfg!(windows) && strings::contains_char(path, b'\\'))
        // The runtime takes what follows for a query.
        || (!is_bundling && strings::contains_char(path, b'?'))
}

/// Why a call is not replaced.
#[derive(Clone, Copy)]
pub(crate) struct Invalid<'a> {
    loc: Loc,
    message: &'a [u8],
}

/// The arguments of a call, which are literals.
pub(crate) struct Literals<'a> {
    /// Each pattern, and where it is.
    globs: &'a [(&'a [u8], Loc)],
    options: Options<'a>,
}

/// `-1`, `+1` and `!0`, which is how a minifier writes `true`, as the literals they stand for.
fn literal(expr: Expr) -> Expr {
    let mut operators = Vec::new();
    let mut operand = expr;
    while let ExprData::EUnary(unary) = operand.data {
        operators.push(unary.op);
        operand = unary.value;
    }
    let mut data = operand.data;
    for operator in operators.into_iter().rev() {
        data = match (operator, data) {
            (js_ast::OpCode::UnNeg, ExprData::ENumber(number)) => {
                ExprData::ENumber(E::Number::new(-number.value()))
            }
            (js_ast::OpCode::UnPos, ExprData::ENumber(_)) => data,
            (js_ast::OpCode::UnNot, ExprData::ENumber(number)) => ExprData::EBoolean(E::Boolean {
                value: number.value() == 0.0 || number.value().is_nan(),
            }),
            (js_ast::OpCode::UnNot, ExprData::EBoolean(boolean)) => {
                ExprData::EBoolean(E::Boolean {
                    value: !boolean.value,
                })
            }
            _ => return expr,
        };
    }
    Expr {
        data,
        loc: expr.loc,
    }
}

impl Pattern {
    /// `text` is relative to `dir`. `None` when it is too long for a path.
    fn new(negated: bool, dir: &[u8], text: &[u8]) -> Option<Pattern> {
        let mut buf = vec![0u8; text.len() + 1];
        let normalized: &[u8] = resolve_path::normalize_string_generic_t::<u8, true, false>(
            text,
            &mut buf,
            b'/',
            |char| char == b'/',
        );

        // On Windows the walker takes a backslash for a separator, so plain names are unescaped here.
        let mut names = Vec::with_capacity(normalized.len());
        let mut rest = normalized;
        loop {
            let (segment, after) = match strings::split_once_char(rest, b'/') {
                Some((segment, after)) => (segment, Some(after)),
                None => (rest, None),
            };
            if bun_glob::detect_glob_syntax(segment) {
                return Some(Pattern {
                    negated,
                    dir: join(dir, &names)?,
                    glob: rest.to_vec(),
                    is_name: false,
                });
            }
            let name_start = names.len();
            let mut bytes = segment.iter();
            while let Some(byte) = bytes.next() {
                names.push(*if *byte == b'\\' {
                    bytes.next().unwrap_or(byte)
                } else {
                    byte
                });
            }
            let Some(after) = after else {
                return Some(Pattern {
                    negated,
                    dir: join(dir, &names[..name_start])?,
                    glob: names[name_start..].to_vec(),
                    is_name: true,
                });
            };
            names.push(b'/');
            rest = after;
        }
    }

    fn matches(&self, file: &[u8]) -> bool {
        let Some(path) = path_below(&self.dir, file) else {
            return false;
        };
        if self.is_name {
            return path == self.glob;
        }
        let path = with_posix_separators(path);
        bun_glob::r#match(&self.glob, strings::trim_leading_char(&path, b'/')).matches()
    }
}

/// The files that match, absolute, in the order of the keys. `importer` never matches.
/// An error is a message for the user.
fn find_files(
    patterns: &[Pattern],
    exhaustive: bool,
    importer: &[u8],
) -> Result<Vec<Vec<u8>>, String> {
    let mut files = Vec::<Vec<u8>>::new();
    // "node_modules" is skipped below the directory that all the patterns share.
    let mut shared_dir: Option<&[u8]> = None;
    for pattern in patterns.iter().filter(|pattern| !pattern.negated) {
        let mut shared = shared_dir.unwrap_or(&pattern.dir);
        while path_below(shared, &pattern.dir).is_none() {
            shared = bun_paths::dirname(shared).unwrap_or_default();
        }
        shared_dir = Some(shared);

        if pattern.is_name {
            let mut buf = path_buffer_pool::get();
            if let Some(file) = join(&pattern.dir, &pattern.glob)
                && matches!(
                    bun_sys::exists_at_type(bun_sys::Fd::cwd(), resolve_path::z(&file, &mut buf)),
                    Ok(bun_sys::ExistsAtType::File)
                )
            {
                files.push(file);
            }
            continue;
        }

        let walked = BunGlobWalker::init_with_cwd(
            &pattern.glob,
            &pattern.dir,
            exhaustive,
            true,
            true,
            false,
            true,
            (!exhaustive).then_some(is_node_modules as fn(&[u8]) -> bool),
        )
        .and_then(|walker| match walker {
            Ok(mut walker) => Ok(walker.walk()?.map(|()| walker)),
            Err(err) => Ok(Err(err)),
        });
        match walked {
            Ok(Ok(walker)) => {
                files.extend(walker.matched_paths.keys().iter().map(|file| file.to_vec()));
            }
            Ok(Err(err)) if matches!(err.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
            }
            Ok(Err(err)) => {
                return Err(format!(
                    "\"import.meta.glob\" could not read a directory: {err}"
                ));
            }
            Err(err) => return Err(format!("\"import.meta.glob\" failed: {}", err.name())),
        }
    }

    let below_shared_dir = shared_dir.unwrap_or_default().len().saturating_sub(1);
    files.retain(|file| {
        **file != *importer
            && (exhaustive
                || !strings::contains(&file[below_shared_dir..], bun_paths::NODE_MODULES_NEEDLE))
            && !patterns
                .iter()
                .any(|pattern| pattern.negated && pattern.matches(file))
    });
    files.sort_by_cached_key(|file| with_posix_separators(file));
    files.dedup();
    Ok(files)
}

/// Reads a call. Nothing here depends on how the file is parsed.
struct Arguments<'a, 'log> {
    log: &'log mut bun_ast::Log,
    source: &'a bun_ast::Source,
    arena: &'a Arena,
}

impl<'a> Arguments<'a, '_> {
    /// Nobody who sees it can change a package.
    fn warn(&mut self, loc: Loc, message: core::fmt::Arguments<'_>) {
        if !self.source.path.is_node_module() {
            self.log.add_warning_fmt(Some(self.source), loc, message);
        }
    }

    fn invalid<Valid>(
        &self,
        loc: Loc,
        message: core::fmt::Arguments<'_>,
    ) -> Result<Valid, Invalid<'a>> {
        Err(Invalid {
            loc,
            message: bun_alloc::arena_format!(in self.arena, "{message}")
                .into_bump_str()
                .as_bytes(),
        })
    }

    /// `call` is not visited yet.
    fn read(&mut self, call: &E::Call, loc: Loc) -> Result<Literals<'a>, Invalid<'a>> {
        let args = call.args.slice();
        if args.is_empty() || args.len() > 2 {
            return self.invalid(
                loc,
                format_args!(
                    "\"import.meta.glob\" expects 1 or 2 arguments, but got {}",
                    args.len()
                ),
            );
        }

        let mut globs = Vec::<(&'a [u8], Loc)>::new();
        let items = match args[0].data {
            ExprData::EArray(array) => array.items.slice().to_vec(),
            _ => vec![args[0]],
        };
        for item in &items {
            match item.data {
                ExprData::EMissing(_) => {}
                ExprData::EString(mut glob) => {
                    let glob = glob.slice(self.arena);
                    if strings::contains_char(glob, 0) {
                        return self.invalid(
                            item.loc,
                            format_args!("Expected a glob pattern without a null byte"),
                        );
                    }
                    globs.push((glob, item.loc));
                }
                _ => {
                    return self.invalid(
                        item.loc,
                        format_args!(
                            "Expected a glob pattern to be a string literal, but got {}",
                            item.data.tag_name()
                        ),
                    );
                }
            }
        }

        Ok(Literals {
            globs: self.arena.alloc_slice_copy(&globs),
            options: match args.get(1) {
                Some(options) => self.options(*options)?,
                None => Options::default(),
            },
        })
    }

    fn expand(
        &mut self,
        &Literals { globs, options }: &Literals<'a>,
        loc: Loc,
        host: ImportMetaGlobHost,
        is_bundling: bool,
    ) -> Result<Expansion<'a>, Invalid<'a>> {
        // Vite's `?raw` and `?url` are loaders here, and the bundler resolves no path with a query.
        let loader = match options.query {
            b"?raw" => Some((js_ast::Loader::Text, b"text".as_slice())),
            b"?url" => Some((js_ast::Loader::File, b"file".as_slice())),
            _ => None,
        };
        let query = if loader.is_some() && is_bundling {
            b""
        } else {
            options.query
        };
        let mut expansion = Expansion {
            eager: options.eager,
            import: options.import,
            loader,
            path_loc: loc,
            entries: Vec::new(),
        };
        let Some(&(first_glob, path_loc)) = globs.first() else {
            return Ok(expansion);
        };
        expansion.path_loc = path_loc;

        // `process.chdir()` overwrites it in place, on another thread, and ends it with a NUL.
        let root = fs::FileSystem::instance().top_level_dir().to_vec();
        let root = &root[..strings::index_of_char_usize(&root, 0).unwrap_or(root.len())];
        let source = self.source;
        let importer_dir = (source.path.is_file() && bun_paths::is_absolute(source.path.text))
            .then(|| source.path.name().dir);
        let is_relative = globs
            .iter()
            .all(|(glob, _)| matches!(glob.first(), Some(b'.' | b'!')));
        if importer_dir.is_none() && options.base.is_empty() && is_relative {
            return self.invalid(
                path_loc,
                format_args!(
                    "Expected a glob pattern in a module that is not a file to start with \"/\", but got \"{}\"",
                    bstr::BStr::new(first_glob)
                ),
            );
        }
        let base_dir = match options.base {
            [] => Some(importer_dir.unwrap_or(root).to_vec()),
            [b'/', base @ ..] => join(root, base),
            base => join(importer_dir.unwrap_or(root), base),
        };
        let Some(base_dir) = base_dir else {
            return self.invalid(
                loc,
                format_args!("The \"import.meta.glob\" option \"base\" is too long for a path"),
            );
        };

        let mut patterns = Vec::with_capacity(globs.len());
        for &(glob, glob_loc) in globs {
            let (negated, glob) = match glob {
                [b'!', glob @ ..] => (true, glob),
                _ => (false, glob),
            };
            let pattern = if let Some(from_root) = glob.strip_prefix(b"/") {
                Pattern::new(negated, root, from_root)
            } else if glob.starts_with(b"./") || glob.starts_with(b"../") {
                Pattern::new(negated, &base_dir, glob)
            } else if glob.starts_with(b"**") {
                if negated {
                    Some(Pattern {
                        negated,
                        dir: Vec::new(),
                        glob: glob.to_vec(),
                        is_name: false,
                    })
                } else {
                    Pattern::new(negated, root, glob)
                }
            } else if let Some((dir, aliased)) =
                host.resolve_alias(importer_dir.unwrap_or(root), glob)
            {
                if strings::contains_char(&dir, 0) || strings::contains_char(&aliased, 0) {
                    return self.invalid(
                        glob_loc,
                        format_args!(
                            "Expected the path alias of \"{}\" without a null byte",
                            bstr::BStr::new(glob)
                        ),
                    );
                }
                Pattern::new(negated, &dir, &aliased)
            } else {
                return self.invalid(
                    glob_loc,
                    format_args!(
                        "Expected a glob pattern to start with \"/\", \"./\", \"../\", \"**\" or a path alias, but got \"{}\"",
                        bstr::BStr::new(glob)
                    ),
                );
            };
            let Some(pattern) = pattern else {
                return self.invalid(
                    glob_loc,
                    format_args!("The glob pattern is too long for a path"),
                );
            };
            patterns.push(pattern);
        }

        let files = match find_files(&patterns, options.exhaustive, source.path.text) {
            Ok(files) => files,
            Err(message) => {
                return self.invalid(path_loc, format_args!("{message}"));
            }
        };

        expansion.entries.reserve(files.len());
        for file in &files {
            let import_path = match importer_dir {
                Some(dir) => relative(dir, file),
                None => Some(with_posix_separators(file)),
            };
            let key = if !options.base.is_empty() {
                relative(&base_dir, file)
            } else if is_relative {
                import_path.clone()
            } else {
                relative(root, file).map(|from_root| match from_root.strip_prefix(b".") {
                    Some(key) if key.starts_with(b"/") => key.to_vec(),
                    _ => from_root,
                })
            };
            let (Some(import_path), Some(key)) = (import_path, key) else {
                return self.invalid(
                    path_loc,
                    format_args!(
                        "The way to \"{}\" is too long for a path",
                        bstr::BStr::new(file)
                    ),
                );
            };
            if is_not_an_import_path(&import_path, is_bundling) {
                self.warn(
                    path_loc,
                    format_args!(
                        "\"import.meta.glob\" skips \"{}\", whose name cannot be imported",
                        bstr::BStr::new(&import_path)
                    ),
                );
                continue;
            }
            expansion.entries.push((
                self.arena.alloc_slice_copy(&key),
                self.arena.alloc_slice_copy(&[&import_path, query].concat()),
            ));
        }
        Ok(expansion)
    }

    /// The name, key and value of `name: value` in the options.
    fn option(
        &mut self,
        property: &G::Property,
        object_loc: Loc,
    ) -> Result<(&'a [u8], Expr, Expr), Invalid<'a>> {
        let (G::PropertyKind::Normal, Some(key), Some(value)) =
            (property.kind, property.key, property.value)
        else {
            return self.invalid(
                property
                    .key
                    .or(property.value)
                    .map_or(object_loc, |e| e.loc),
                format_args!("Expected the options of \"import.meta.glob\" to be plain properties"),
            );
        };
        let ExprData::EString(mut name) = key.data else {
            return self.invalid(
                key.loc,
                format_args!(
                    "Expected the name of an \"import.meta.glob\" option to be a literal, but got {}",
                    key.data.tag_name()
                ),
            );
        };
        Ok((name.slice(self.arena), key, literal(value)))
    }

    fn options(&mut self, arg: Expr) -> Result<Options<'a>, Invalid<'a>> {
        let ExprData::EObject(object) = arg.data else {
            return self.invalid(
                arg.loc,
                format_args!(
                    "Expected the options of \"import.meta.glob\" to be an object literal, but got {}",
                    arg.data.tag_name()
                ),
            );
        };

        let mut options = Options::default();
        let mut r#as: &'a [u8] = b"";
        for property in object.properties.slice() {
            let (name, key, value) = self.option(property, arg.loc)?;
            let expected = match (name, value.data) {
                (b"eager", ExprData::EBoolean(eager)) => {
                    options.eager = eager.value;
                    continue;
                }
                (b"exhaustive", ExprData::EBoolean(exhaustive)) => {
                    options.exhaustive = exhaustive.value;
                    continue;
                }
                (b"caseSensitive", ExprData::EBoolean(E::Boolean { value: true })) => continue,
                (b"caseSensitive", ExprData::EBoolean(_)) => {
                    return self.invalid(
                        value.loc,
                        format_args!(
                            "The \"import.meta.glob\" option \"caseSensitive: false\" is not supported"
                        ),
                    );
                }
                (b"import", ExprData::EString(mut import)) => {
                    options.import = import.slice(self.arena);
                    continue;
                }
                (b"base", ExprData::EString(mut base)) => {
                    options.base = base.slice(self.arena);
                    if !options.base.is_empty()
                        && !options.base.starts_with(b"/")
                        && !options.base.starts_with(b"./")
                        && !options.base.starts_with(b"../")
                    {
                        return self.invalid(
                            value.loc,
                            format_args!(
                                "Expected the \"import.meta.glob\" option \"base\" to start with \"/\", \"./\" or \"../\", but got \"{}\"",
                                bstr::BStr::new(options.base)
                            ),
                        );
                    }
                    if strings::contains_char(options.base, 0) {
                        return self.invalid(
                            value.loc,
                            format_args!(
                                "Expected the \"import.meta.glob\" option \"base\" without a null byte"
                            ),
                        );
                    }
                    continue;
                }
                (b"as", ExprData::EString(mut query)) => {
                    r#as = query.slice(self.arena);
                    continue;
                }
                (b"query", ExprData::EString(mut query)) => {
                    options.query = query.slice(self.arena);
                    continue;
                }
                (b"query", ExprData::EObject(query)) => {
                    options.query = self.query(&query, value.loc)?;
                    continue;
                }
                (b"eager" | b"exhaustive" | b"caseSensitive", _) => "a boolean",
                (b"import" | b"base" | b"as", _) => "a string",
                (b"query", _) => "a string or an object",
                _ => {
                    return self.invalid(
                        key.loc,
                        format_args!(
                            "Unknown \"import.meta.glob\" option \"{}\"",
                            bstr::BStr::new(name)
                        ),
                    );
                }
            };
            return self.invalid(
                value.loc,
                format_args!(
                    "Expected the \"import.meta.glob\" option \"{}\" to be {} literal, but got {}",
                    bstr::BStr::new(name),
                    expected,
                    value.data.tag_name()
                ),
            );
        }

        if !r#as.is_empty() {
            if !options.query.is_empty() {
                return self.invalid(
                    arg.loc,
                    format_args!(
                        "The \"import.meta.glob\" options \"as\" and \"query\" cannot be used together"
                    ),
                );
            }
            if matches!(r#as, b"raw" | b"url") {
                if !matches!(options.import, b"" | b"default" | b"*") {
                    return self.invalid(
                        arg.loc,
                        format_args!(
                            "Expected the \"import.meta.glob\" option \"import\" to be \"default\" or \"*\" when \"as\" is \"{}\", but got \"{}\"",
                            bstr::BStr::new(r#as),
                            bstr::BStr::new(options.import)
                        ),
                    );
                }
                if options.import.is_empty() {
                    options.import = b"default";
                }
            }
            options.query = r#as;
        }
        if !options.query.is_empty() && !options.query.starts_with(b"?") {
            options.query = self.arena.alloc_slice_copy(&[b"?", options.query].concat());
        }
        if options.import == b"*" {
            options.import = b"";
        }
        Ok(options)
    }

    fn query(&mut self, query: &E::Object, loc: Loc) -> Result<&'a [u8], Invalid<'a>> {
        let mut out = Vec::new();
        for property in query.properties.slice() {
            let (name, _, value) = self.option(property, loc)?;
            let text = match value.data {
                ExprData::ENumber(_) | ExprData::EBoolean(_) => {
                    let empty = Expr::init(E::String::init(b""), value.loc);
                    fold_string_addition(value, empty, self.arena, FoldStringAdditionKind::Normal)
                        .unwrap_or(value)
                }
                _ => value,
            };
            let ExprData::EString(mut text) = text.data else {
                return self.invalid(
                    value.loc,
                    format_args!(
                        "Expected a value of the \"import.meta.glob\" option \"query\" to be a string, number or boolean literal, but got {}",
                        value.data.tag_name()
                    ),
                );
            };
            if !out.is_empty() {
                out.push(b'&');
            }
            append_query_component(&mut out, name, true);
            let text = text.slice(self.arena);
            if !text.is_empty() {
                out.push(b'=');
                append_query_component(&mut out, text, false);
            }
        }
        Ok(self.arena.alloc_slice_copy(&out))
    }
}

/// `{ key: value }`
fn object_of(key: &'static [u8], value: Expr) -> Expr {
    Expr::init(
        E::Object {
            properties: G::PropertyList::init_one(G::Property {
                key: Some(Expr::init(E::String::init(key), value.loc)),
                value: Some(value),
                ..Default::default()
            }),
            is_single_line: true,
            ..Default::default()
        },
        value.loc,
    )
}

/// `(...args) => { body }`, or `(...args) => value` when `body` returns `value`.
fn arrow_of(arena: &Arena, args: &[js_ast::Ref], body: Stmt) -> Expr {
    let loc = body.loc;
    let args = arena.alloc_slice_fill_iter(args.iter().map(|&r#ref| G::Arg {
        binding: js_ast::Binding::alloc(arena, B::Identifier { r#ref }, loc),
        ..Default::default()
    }));
    Expr::init(
        E::Arrow {
            args: js_ast::StoreSlice::new_mut(args),
            body: G::FnBody {
                loc,
                stmts: js_ast::StoreSlice::new_mut(arena.alloc_slice_copy(&[body])),
            },
            prefer_expr: matches!(body.data, js_ast::StmtData::SReturn(_)),
            ..Default::default()
        },
        loc,
    )
}

/// `(...args) => value`
fn arrow(arena: &Arena, args: &[js_ast::Ref], value: Expr) -> Expr {
    arrow_of(
        arena,
        args,
        Stmt::alloc(S::Return { value: Some(value) }, value.loc),
    )
}

/// `() => { throw new TypeError(message) }`
fn throwing_function(arena: &Arena, type_error: js_ast::Ref, message: &[u8], loc: Loc) -> Expr {
    let value = Expr::init(
        E::New {
            target: Expr::init(E::Identifier::init(type_error), loc),
            args: js_ast::ExprNodeList::init_one(Expr::init(E::String::init(message), loc)),
            ..Default::default()
        },
        loc,
    );
    arrow_of(arena, &[], Stmt::alloc(S::Throw { value }, loc))
}

fn is_import_meta_glob(expr: Expr) -> bool {
    matches!(
        expr.data,
        ExprData::EDot(dot) if dot.optional_chain.is_none()
            && dot.name == b"glob"
            && matches!(dot.target.data, ExprData::EImportMeta(_))
    )
}

/// `Object.keys(import.meta.glob(...))` imports nothing. After `call.target` is visited.
pub(crate) fn is_object_keys_call(symbols: &[js_ast::Symbol], call: &E::Call) -> bool {
    let ExprData::EDot(dot) = call.target.data else {
        return false;
    };
    let ExprData::EIdentifier(object) = dot.target.data else {
        return false;
    };
    let object = &symbols[object.ref_.inner_index() as usize];
    dot.name == b"keys"
        && object.kind == js_ast::symbol::Kind::Unbound
        && object.original_name.slice() == b"Object"
}

fn dot(target: Expr, name: &[u8]) -> Expr {
    Expr::init(
        E::Dot {
            target,
            name: name.into(),
            name_loc: target.loc,
            ..Default::default()
        },
        target.loc,
    )
}

/// `import.then(parameter => parameter.name)`
fn then_export(arena: &Arena, import: Expr, parameter: js_ast::Ref, name: &[u8]) -> Expr {
    let namespace = Expr::init(E::Identifier::init(parameter), import.loc);
    Expr::init(
        E::Call {
            target: dot(import, b"then"),
            args: js_ast::ExprNodeList::init_one(arrow(arena, &[parameter], dot(namespace, name))),
            ..Default::default()
        },
        import.loc,
    )
}

impl<'a, const TS: bool, const SCAN: bool, const SEMA: bool> P<'a, TS, SCAN, SEMA> {
    /// Then the source is not enough of a key to cache what it is transpiled to.
    pub(crate) fn depends_on_more_than_source(&self) -> bool {
        self.macro_call_count != 0
            || matches!(
                self.import_meta_glob_use,
                ImportMetaGlobUse::Called
                    | ImportMetaGlobUse::ImportedEagerly
                    | ImportMetaGlobUse::Expanded
            )
    }

    /// In the parse pass, at the token after `import.meta.name`.
    #[cold]
    pub(crate) fn did_parse_import_meta_property(&mut self, name: &[u8]) {
        if name == b"glob"
            && matches!(
                self.lexer.token,
                T::TEquals
                    | T::TQuestionQuestionEquals
                    | T::TBarBarEquals
                    | T::TAmpersandAmpersandEquals
            )
        {
            self.import_meta_glob_use = ImportMetaGlobUse::Assigned;
        }
    }

    /// Before `call` is visited: afterwards `import.meta["glob"]()` looks the same.
    pub(crate) fn is_import_meta_glob_call(&self, call: &E::Call) -> bool {
        self.options.import_meta_glob.is_some()
            && self.import_meta_glob_use != ImportMetaGlobUse::Assigned
            && !self.is_revisit_for_substitution
            && !self.is_control_flow_dead
            && call.optional_chain.is_none()
            && is_import_meta_glob(call.target)
    }

    /// Before `call` is visited: afterwards what was inlined or folded looks like a literal, and
    /// `bun run` and `bun build` do not inline and fold the same.
    #[cold]
    pub(crate) fn read_import_meta_glob_call(
        &mut self,
        call: &E::Call,
        loc: Loc,
    ) -> &'a Result<Literals<'a>, Invalid<'a>> {
        let arguments = Arguments {
            log: self.log(),
            source: self.source,
            arena: self.arena,
        }
        .read(call, loc);
        self.arena.alloc(arguments)
    }

    fn import_meta_glob_throws(&mut self, message: &[u8], loc: Loc) -> Expr {
        let type_error = self
            .find_symbol(loc, b"TypeError")
            .expect("unreachable")
            .r#ref;
        throwing_function(
            self.arena,
            type_error,
            self.arena.alloc_slice_copy(message),
            loc,
        )
    }

    /// `e` is an `import.meta.glob(...)` that was visited. One that cannot be replaced throws when
    /// it is reached, as a call of what is not a function does.
    pub(crate) fn expand_import_meta_glob(
        &mut self,
        e: &mut Expr,
        arguments: &Result<Literals<'a>, Invalid<'a>>,
        only_keys: bool,
    ) {
        let (ExprData::ECall(mut call), Some(host)) = (e.data, self.options.import_meta_glob)
        else {
            return;
        };
        // A define can have replaced the target.
        if !is_import_meta_glob(call.target) {
            return;
        }
        let loc = e.loc;
        let is_bundling = self.options.bundle;
        let mut finder = Arguments {
            log: self.log(),
            source: self.source,
            arena: self.arena,
        };
        let expansion = match arguments {
            Ok(literals) => finder.expand(literals, loc, host, is_bundling),
            Err(invalid) => Err(*invalid),
        };
        let expansion = match expansion {
            Ok(expansion) => expansion,
            Err(invalid) => {
                finder.warn(
                    invalid.loc,
                    format_args!("{}", bstr::BStr::new(invalid.message)),
                );
                self.import_meta_glob_use =
                    self.import_meta_glob_use.max(ImportMetaGlobUse::Called);
                call.target = self.import_meta_glob_throws(invalid.message, invalid.loc);
                return;
            }
        };
        let has_imports = expansion.eager && !only_keys && !expansion.entries.is_empty();
        self.import_meta_glob_use = self.import_meta_glob_use.max(if has_imports {
            ImportMetaGlobUse::ImportedEagerly
        } else {
            ImportMetaGlobUse::Expanded
        });

        let mut properties: G::PropertyList = bun_alloc::AstAlloc::vec();
        properties.reserve(expansion.entries.len());
        for &(key, path) in &expansion.entries {
            let value = if only_keys {
                Expr::init(E::Number::new(0.0), loc)
            } else {
                self.import_meta_glob_value(&expansion, path, loc)
            };
            VecExt::append(
                &mut properties,
                G::Property {
                    key: Some(Expr::init(E::String::init(key), loc)),
                    value: Some(value),
                    ..Default::default()
                },
            );
        }
        *e = Expr::init(
            E::Object {
                properties,
                ..Default::default()
            },
            loc,
        );
        // Whether the module is CommonJS is known after the visit pass, which takes an object
        // literal apart where it is not used, and leaves a call as it is.
        if has_imports
            && self.options.features.commonjs_at_runtime
            && self.esm_export_keyword.len == 0
            && self.top_level_await_keyword.len == 0
        {
            *e = Expr::init(
                E::Call {
                    target: arrow(self.arena, &[], *e),
                    ..Default::default()
                },
                loc,
            );
            self.import_meta_glob_eager_calls.push(*e);
        }
    }

    /// The module turns out to be CommonJS, which cannot have the import statements of
    /// `{ eager: true }`: those calls throw when they are reached, like any that is not replaced.
    pub(crate) fn reject_eager_import_meta_globs(&mut self) {
        for stmt in self.import_meta_glob_imports.drain(..) {
            if let js_ast::StmtData::SImport(import) = stmt.data {
                self.import_records.items_mut()[import.import_record_index as usize]
                    .flags
                    .insert(js_ast::ImportRecordFlags::IS_UNUSED);
            }
        }
        let calls = core::mem::replace(
            &mut self.import_meta_glob_eager_calls,
            bun_alloc::ArenaVec::new_in(self.arena),
        );
        for call in calls {
            if let ExprData::ECall(mut eager) = call.data {
                eager.target = self.import_meta_glob_throws(
                    b"The \"import.meta.glob\" option \"eager\" needs import statements, which a CommonJS module cannot have",
                    call.loc,
                );
            }
        }
        if self.import_meta_glob_use == ImportMetaGlobUse::ImportedEagerly {
            self.import_meta_glob_use = ImportMetaGlobUse::Called;
        }
    }

    /// `import.meta.glob = () => { throw ... }` for a module whose calls were replaced, so that
    /// `typeof import.meta.glob === "function"` agrees with them. Vite's module runner has one too.
    pub(crate) fn import_meta_glob_definition(&mut self) -> Option<Stmt> {
        if self.options.bundle
            || !matches!(
                self.import_meta_glob_use,
                ImportMetaGlobUse::ImportedEagerly | ImportMetaGlobUse::Expanded
            )
        {
            return None;
        }
        let loc = Loc::EMPTY;
        let function = self.import_meta_glob_throws(
            b"\"import.meta.glob\" is replaced when its file is transpiled: call it by this name, with literals",
            loc,
        );
        let value = Expr::assign(dot(Expr::init(E::ImportMeta {}, loc), b"glob"), function);
        Some(Stmt::alloc(
            S::SExpr {
                value,
                ..Default::default()
            },
            loc,
        ))
    }

    fn import_meta_glob_value(
        &mut self,
        expansion: &Expansion<'a>,
        path: &'a [u8],
        loc: Loc,
    ) -> Expr {
        if expansion.eager {
            return self.import_meta_glob_static_import(expansion, path, loc);
        }

        let (specifier, state) = expansion.import_call(path, loc);
        let mut value = self.transpose_import(specifier, &state);
        if !expansion.import.is_empty() {
            // The bundler drops the exports that no use of the `import()` observes.
            if let ExprData::EImport(import) = value.data
                && let Some(observed) = self
                    .import_items_for_namespace
                    .get_mut(&import.namespace_ref)
            {
                let ref_ = js_ast::Ref::NONE;
                bun_core::handle_oom(observed.put(expansion.import, js_ast::LocRef { loc, ref_ }));
                self.note_tracked_namespace_use(import.namespace_ref);
            }
            let parameter = self.new_symbol(js_ast::symbol::Kind::Other, b"m");
            self.declare_temp_var(parameter);
            self.record_usage(parameter);
            value = then_export(self.arena, value, parameter, expansion.import);
        }
        arrow(self.arena, &[], value)
    }

    /// Queues `import * as value from path` or `import { name as value } from path`.
    fn import_meta_glob_static_import(
        &mut self,
        expansion: &Expansion<'a>,
        path: &'a [u8],
        loc: Loc,
    ) -> Expr {
        let name = expansion.import;
        let import_record_index =
            self.add_import_record(ImportKind::Stmt, expansion.path_loc, path);
        self.import_records.items_mut()[import_record_index as usize].loader =
            expansion.loader.map(|(loader, _)| loader);
        let namespace_name = bun_alloc::arena_format!(
            in self.arena,
            "import_{}",
            fs::PathName::init(path).fmt_identifier()
        )
        .into_bump_str()
        .as_bytes();
        let namespace_name = if name.is_empty() {
            self.temp_var_name(namespace_name)
        } else {
            namespace_name
        };
        let namespace_ref = self.new_symbol(js_ast::symbol::Kind::Other, namespace_name);
        VecExt::append(&mut self.module_scope_mut().generated, namespace_ref);

        let mut import = S::Import {
            namespace_ref,
            import_record_index,
            star_name_loc: Loc::EMPTY,
            default_name: None,
            items: js_ast::StoreSlice::EMPTY,
            is_single_line: true,
            phase_defer: false,
        };
        let value = if name.is_empty() {
            import.star_name_loc = loc;
            self.record_usage(namespace_ref);
            self.new_expr(E::Identifier::init(namespace_ref), loc)
        } else {
            let local_name = bun_alloc::arena_format!(
                in self.arena,
                "{}_{}",
                fs::PathName::init(path).fmt_identifier(),
                bun_core::fmt::fmt_identifier(name)
            )
            .into_bump_str()
            .as_bytes();
            let local_name = self.temp_var_name(local_name);
            let ref_ = self.new_symbol(js_ast::symbol::Kind::Other, local_name);
            VecExt::append(&mut self.module_scope_mut().generated, ref_);
            self.is_import_item.insert(ref_, ());
            if self.options.features.hot_module_reloading {
                self.symbols[ref_.inner_index() as usize].namespace_alias =
                    Some(bun_alloc::ast_box(G::NamespaceAlias {
                        namespace_ref,
                        alias: js_ast::StoreStr::new(name),
                        import_record_index,
                        was_originally_property_access: false,
                    }));
            }
            import.items = js_ast::StoreSlice::new_mut(self.arena.alloc_slice_fill_iter([
                js_ast::ClauseItem {
                    alias: js_ast::StoreStr::new(name),
                    alias_loc: loc,
                    name: js_ast::LocRef { loc, ref_ },
                    original_name: js_ast::StoreStr::new(local_name),
                },
            ]));
            self.record_usage(ref_);
            self.new_expr(E::ImportIdentifier::new(ref_, false), loc)
        };
        self.import_meta_glob_imports.push(self.s(import, loc));
        value
    }
}
