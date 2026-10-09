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

use crate::p::P;
use crate::parser::TransposeState;

// `resolve_alias`, for a pattern that is not a path: a directory, and the pattern from there.
bun_dispatch::link_interface! {
    pub ImportMetaGlobHost[Resolver, DevServerParseTask] {
        fn resolve_alias(importer_dir: &[u8], glob: &[u8]) -> Option<(Vec<u8>, Vec<u8>)>;
        fn did_scan(scan: ImportMetaGlobScan);
    }
}

#[derive(Default)]
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
}

/// The files that one call matched, and how to look for them again.
pub struct ImportMetaGlobScan {
    patterns: Vec<Pattern>,
    exhaustive: bool,
    /// It never matches.
    importer: Box<[u8]>,
    /// Absolute, in the order of the keys.
    files: Vec<Vec<u8>>,
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

fn join(dir: &[u8], path: &[u8]) -> Vec<u8> {
    let mut buf = path_buffer_pool::get();
    resolve_path::join_abs_string_buf::<platform::Auto>(dir, &mut buf[..], &[path]).to_vec()
}

fn with_posix_separators(path: &[u8]) -> Vec<u8> {
    let mut path = path.to_vec();
    resolve_path::platform_to_posix_in_place::<u8>(&mut path);
    path
}

/// With `/` on every platform, and `./` unless it starts with `../`.
fn relative(from: &[u8], to: &[u8]) -> Vec<u8> {
    let mut buf = path_buffer_pool::get();
    let path = resolve_path::relative_platform_buf::<platform::Loose, true>(&mut buf[..], from, to);
    if path.starts_with(b"../") {
        return path.to_vec();
    }
    [b"./", path].concat()
}

impl Pattern {
    /// `text` is relative to `dir`.
    fn new(negated: bool, dir: &[u8], text: &[u8]) -> Pattern {
        let mut buf = vec![0u8; text.len() + 1];
        let normalized: &[u8] = resolve_path::normalize_string_generic_t::<u8, true, false>(
            text,
            &mut buf,
            b'/',
            |char| char == b'/',
        );

        let mut plain = 0;
        while let Some(end) = strings::index_of_char_usize(&normalized[plain..], b'/') {
            let segment = &normalized[plain..plain + end];
            if bun_glob::detect_glob_syntax(segment) || strings::contains_char(segment, b'\\') {
                break;
            }
            plain += end + 1;
        }

        Pattern {
            negated,
            dir: join(dir, &normalized[..plain]),
            glob: normalized[plain..].to_vec(),
        }
    }

    fn matches(&self, file: &[u8]) -> bool {
        let Some(path) = path_below(&self.dir, file) else {
            return false;
        };
        let path = with_posix_separators(path);
        bun_glob::r#match(&self.glob, strings::trim_leading_char(&path, b'/')).matches()
    }
}

impl ImportMetaGlobScan {
    /// An error is a message for the user.
    fn find_files(&self) -> Result<Vec<Vec<u8>>, String> {
        let mut files = Vec::<Vec<u8>>::new();
        // "node_modules" is skipped below the directory that all the patterns share.
        let mut shared_dir: Option<&[u8]> = None;
        for pattern in self.patterns.iter().filter(|pattern| !pattern.negated) {
            let mut shared = shared_dir.unwrap_or(&pattern.dir);
            while path_below(shared, &pattern.dir).is_none() {
                shared = bun_paths::dirname(shared).unwrap_or_default();
            }
            shared_dir = Some(shared);

            let walked = BunGlobWalker::init_with_cwd(
                &pattern.glob,
                &pattern.dir,
                self.exhaustive,
                true,
                true,
                false,
                true,
                (!self.exhaustive).then_some(is_node_modules as fn(&[u8]) -> bool),
            )
            .and_then(|walker| match walker {
                Ok(mut walker) => Ok(walker.walk()?.map(|()| walker)),
                Err(err) => Ok(Err(err)),
            });
            match walked {
                Ok(Ok(walker)) => {
                    files.extend(walker.matched_paths.keys().iter().map(|file| file.to_vec()))
                }
                Ok(Err(err))
                    if matches!(err.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {}
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
            **file != *self.importer
                && (self.exhaustive
                    || !strings::contains(
                        &file[below_shared_dir..],
                        bun_paths::NODE_MODULES_NEEDLE,
                    ))
                && !self
                    .patterns
                    .iter()
                    .any(|pattern| pattern.negated && pattern.matches(file))
        });
        files.sort_by_cached_key(|file| with_posix_separators(file));
        files.dedup();
        Ok(files)
    }

    /// Where a file that appears or disappears can change the result. A directory below a
    /// wildcard is only here once a file in it matches.
    pub fn directories(&self) -> Vec<&[u8]> {
        let mut directories: Vec<&[u8]> = self
            .patterns
            .iter()
            .filter(|pattern| !pattern.negated)
            .map(|pattern| pattern.dir.as_slice())
            .chain(
                self.files
                    .iter()
                    .filter_map(|file| bun_paths::dirname(file)),
            )
            .collect();
        directories.sort_unstable();
        directories.dedup();
        directories
    }

    pub fn has_changed(&self) -> bool {
        !self.find_files().is_ok_and(|files| files == self.files)
    }
}

/// Reads a call. Nothing here depends on how the file is parsed.
struct Arguments<'a, 'log> {
    log: &'log mut bun_ast::Log,
    source: &'a bun_ast::Source,
    arena: &'a Arena,
}

impl<'a> Arguments<'a, '_> {
    fn error(&mut self, loc: Loc, message: core::fmt::Arguments<'_>) {
        self.log.add_error_fmt(self.source, loc, message);
    }

    /// Logs an error and returns `None` when the call is not valid.
    fn expand(
        &mut self,
        call: &E::Call,
        loc: Loc,
        host: ImportMetaGlobHost,
        is_bundling: bool,
    ) -> Option<Expansion<'a>> {
        let args = call.args.slice();
        if args.is_empty() || args.len() > 2 {
            self.error(
                loc,
                format_args!(
                    "\"import.meta.glob\" expects 1 or 2 arguments, but got {}",
                    args.len()
                ),
            );
            return None;
        }

        let mut globs = Vec::<(&'a [u8], Loc)>::new();
        let items = match args[0].data {
            ExprData::EArray(array) => array.items.slice().to_vec(),
            _ => vec![args[0]],
        };
        for item in &items {
            match item.data {
                ExprData::EMissing(_) => {}
                ExprData::EString(mut glob) => globs.push((glob.slice(self.arena), item.loc)),
                _ => {
                    self.error(
                        item.loc,
                        format_args!(
                            "Expected a glob pattern to be a string literal, but got {}",
                            item.data.tag_name()
                        ),
                    );
                    return None;
                }
            }
        }

        let options = match args.get(1) {
            Some(options) => self.options(*options)?,
            None => Options::default(),
        };
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
            return Some(expansion);
        };
        expansion.path_loc = path_loc;

        let root = fs::FileSystem::instance().top_level_dir();
        let source = self.source;
        let importer_dir = (source.path.is_file() && bun_paths::is_absolute(source.path.text))
            .then(|| source.path.name().dir);
        let is_relative = globs
            .iter()
            .all(|(glob, _)| matches!(glob.first(), Some(b'.' | b'!')));
        if importer_dir.is_none() && options.base.is_empty() && is_relative {
            self.error(
                path_loc,
                format_args!(
                    "Expected a glob pattern in a module that is not a file to start with \"/\", but got \"{}\"",
                    bstr::BStr::new(first_glob)
                ),
            );
            return None;
        }
        let base_dir = match options.base {
            [] => importer_dir.unwrap_or(root).to_vec(),
            [b'/', base @ ..] => join(root, base),
            base => join(importer_dir.unwrap_or(root), base),
        };

        let mut scan = ImportMetaGlobScan {
            patterns: Vec::with_capacity(globs.len()),
            exhaustive: options.exhaustive,
            importer: source.path.text.into(),
            files: Vec::new(),
        };
        for &(glob, glob_loc) in &globs {
            let (negated, glob) = match glob {
                [b'!', glob @ ..] => (true, glob),
                _ => (false, glob),
            };
            scan.patterns
                .push(if let Some(from_root) = glob.strip_prefix(b"/") {
                    Pattern::new(negated, root, from_root)
                } else if glob.starts_with(b"./") || glob.starts_with(b"../") {
                    Pattern::new(negated, &base_dir, glob)
                } else if glob.starts_with(b"**") {
                    if negated {
                        Pattern {
                            negated,
                            dir: Vec::new(),
                            glob: glob.to_vec(),
                        }
                    } else {
                        Pattern::new(negated, root, glob)
                    }
                } else if let Some((dir, glob)) =
                    host.resolve_alias(importer_dir.unwrap_or(root), glob)
                {
                    Pattern::new(negated, &dir, &glob)
                } else {
                    self.error(
                        glob_loc,
                        format_args!(
                            "Expected a glob pattern to start with \"/\", \"./\", \"../\", \"**\" or a path alias, but got \"{}\"",
                            bstr::BStr::new(glob)
                        ),
                    );
                    return None;
                });
        }

        scan.files = match scan.find_files() {
            Ok(files) => files,
            Err(message) => {
                self.error(path_loc, format_args!("{message}"));
                return None;
            }
        };

        expansion.entries.reserve(scan.files.len());
        for file in &scan.files {
            let import_path = match importer_dir {
                Some(dir) => relative(dir, file),
                None => with_posix_separators(file),
            };
            let key = if !options.base.is_empty() {
                relative(&base_dir, file)
            } else if is_relative {
                import_path.clone()
            } else {
                let from_root = relative(root, file);
                match from_root.strip_prefix(b".") {
                    Some(key) if key.starts_with(b"/") => key.to_vec(),
                    _ => from_root,
                }
            };
            expansion.entries.push((
                self.arena.alloc_slice_copy(&key),
                self.arena.alloc_slice_copy(&[&import_path, query].concat()),
            ));
        }
        host.did_scan(scan);
        Some(expansion)
    }

    /// The name, key and value of `name: value` in the options.
    fn option(
        &mut self,
        property: &G::Property,
        object_loc: Loc,
    ) -> Option<(&'a [u8], Expr, Expr)> {
        let (G::PropertyKind::Normal, Some(key), Some(value)) =
            (property.kind, property.key, property.value)
        else {
            self.error(
                property
                    .key
                    .or(property.value)
                    .map_or(object_loc, |e| e.loc),
                format_args!("Expected the options of \"import.meta.glob\" to be plain properties"),
            );
            return None;
        };
        let ExprData::EString(mut name) = key.data else {
            self.error(
                key.loc,
                format_args!(
                    "Expected the name of an \"import.meta.glob\" option to be a literal, but got {}",
                    key.data.tag_name()
                ),
            );
            return None;
        };
        Some((name.slice(self.arena), key, value))
    }

    fn options(&mut self, arg: Expr) -> Option<Options<'a>> {
        let ExprData::EObject(object) = arg.data else {
            self.error(
                arg.loc,
                format_args!(
                    "Expected the options of \"import.meta.glob\" to be an object literal, but got {}",
                    arg.data.tag_name()
                ),
            );
            return None;
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
                    self.error(
                        value.loc,
                        format_args!(
                            "The \"import.meta.glob\" option \"caseSensitive: false\" is not supported"
                        ),
                    );
                    return None;
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
                        self.error(
                            value.loc,
                            format_args!(
                                "Expected the \"import.meta.glob\" option \"base\" to start with \"/\", \"./\" or \"../\", but got \"{}\"",
                                bstr::BStr::new(options.base)
                            ),
                        );
                        return None;
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
                    self.error(
                        key.loc,
                        format_args!(
                            "Unknown \"import.meta.glob\" option \"{}\"",
                            bstr::BStr::new(name)
                        ),
                    );
                    return None;
                }
            };
            self.error(
                value.loc,
                format_args!(
                    "Expected the \"import.meta.glob\" option \"{}\" to be {} literal, but got {}",
                    bstr::BStr::new(name),
                    expected,
                    value.data.tag_name()
                ),
            );
            return None;
        }

        if !r#as.is_empty() {
            if !options.query.is_empty() {
                self.error(
                    arg.loc,
                    format_args!(
                        "The \"import.meta.glob\" options \"as\" and \"query\" cannot be used together"
                    ),
                );
                return None;
            }
            if matches!(r#as, b"raw" | b"url") {
                if !matches!(options.import, b"" | b"default" | b"*") {
                    self.error(
                        arg.loc,
                        format_args!(
                            "Expected the \"import.meta.glob\" option \"import\" to be \"default\" or \"*\" when \"as\" is \"{}\", but got \"{}\"",
                            bstr::BStr::new(r#as),
                            bstr::BStr::new(options.import)
                        ),
                    );
                    return None;
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
        Some(options)
    }

    fn query(&mut self, query: &E::Object, loc: Loc) -> Option<&'a [u8]> {
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
                self.error(
                    value.loc,
                    format_args!(
                        "Expected a value of the \"import.meta.glob\" option \"query\" to be a string, number or boolean literal, but got {}",
                        value.data.tag_name()
                    ),
                );
                return None;
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
        Some(self.arena.alloc_slice_copy(&out))
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

/// `(...args) => value`
fn arrow(arena: &Arena, args: &[js_ast::Ref], value: Expr) -> Expr {
    let loc = value.loc;
    let args = arena.alloc_slice_fill_iter(args.iter().map(|&r#ref| G::Arg {
        binding: js_ast::Binding::alloc(arena, B::Identifier { r#ref }, loc),
        ..Default::default()
    }));
    let stmts = arena.alloc_slice_copy(&[Stmt::alloc(S::Return { value: Some(value) }, loc)]);
    Expr::init(
        E::Arrow {
            args: js_ast::StoreSlice::new_mut(args),
            body: G::FnBody {
                loc,
                stmts: js_ast::StoreSlice::new_mut(stmts),
            },
            prefer_expr: true,
            ..Default::default()
        },
        loc,
    )
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
    pub(crate) fn is_import_meta_glob(&self, call: &E::Call) -> bool {
        self.options.import_meta_glob.is_some()
            && call.optional_chain.is_none()
            && matches!(
                call.target.data,
                ExprData::EDot(dot) if dot.optional_chain.is_none()
                    && dot.name == b"glob"
                    && matches!(dot.target.data, ExprData::EImportMeta(_))
            )
    }

    /// `Object.keys(import.meta.glob(...))` imports nothing.
    pub(crate) fn import_meta_glob_in_object_keys(
        &self,
        call: &E::Call,
    ) -> Option<js_ast::StoreRef<E::Call>> {
        let (ExprData::EDot(dot), Some(ExprData::ECall(glob))) = (
            call.target.data,
            call.args.slice().first().map(|arg| arg.data),
        ) else {
            return None;
        };
        (dot.name == b"keys"
            && matches!(
                dot.target.data,
                ExprData::EIdentifier(object) if self.load_name_from_ref(object.ref_) == b"Object"
            )
            && self.is_import_meta_glob(&glob))
        .then_some(glob)
    }

    pub(crate) fn visit_import_meta_glob(
        &mut self,
        call: &mut E::Call,
        loc: Loc,
        only_keys: bool,
    ) -> Expr {
        for arg in call.args.slice_mut() {
            self.visit_expr(arg);
        }

        let mut properties: G::PropertyList = bun_alloc::AstAlloc::vec();
        if !self.is_control_flow_dead
            && let Some(host) = self.options.import_meta_glob
        {
            // The result depends on the file system, which the cache's key does not cover.
            if let Some(cache) = self.options.features.runtime_transpiler_cache_mut() {
                cache.input_hash = None;
            }
            let expansion = Arguments {
                log: self.log(),
                source: self.source,
                arena: self.arena,
            }
            .expand(call, loc, host, self.options.bundle);
            if let Some(expansion) = expansion {
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
            }
        }
        Expr::init(
            E::Object {
                properties,
                ..Default::default()
            },
            loc,
        )
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

        let mut state = TransposeState {
            loc,
            ..Default::default()
        };
        if let Some((loader, r#type)) = expansion.loader {
            state.import_loader = Some(loader);
            state.import_options = object_of(
                b"with",
                object_of(b"type", Expr::init(E::String::init(r#type), loc)),
            );
        }
        let specifier = Expr::init(E::String::init(path), expansion.path_loc);
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
