use std::io::Write as _;

use bstr::BStr;
use bun_alloc::Arena as Bump;
use bun_ast::{E, Expr, ExprData, G};
use bun_collections::VecExt;
use bun_core::MutableString;
use bun_core::fmt as bun_fmt;
use bun_core::strings;
use bun_core::{Global, Output, prettyln};
use bun_http as http;
use bun_install::PackageManager;
use bun_install::dependency;
use bun_install::npm::{self, PackageManifest};
use bun_js_printer as JSPrinter;
use bun_parsers::json as JSON;
use bun_semver as Semver;
use bun_url::URL;

use super::npm_queryable::{self, FieldPathError, FieldResult};
use bun_core::fmt::buf_print_infallible as buf_print;

/// `bun pm view` / `bun info`: fetch the packument for `spec_`, pick the
/// version the same way `bun add` would, then print either the whole
/// manifest, or the requested `fields` (npm `view` field-path grammar).
pub(crate) fn view(
    manager: &mut PackageManager,
    spec_: &[u8],
    fields: &[&[u8]],
    json_output: bool,
) -> Result<(), crate::Error> {
    let bump = Bump::new();
    let (name, version) = dependency::split_name_and_version_or_latest('brk: {
        // Extremely best effort.
        if spec_ == b"." || spec_ == b"" {
            if strings::is_npm_package_name(&manager.root_package_json_name_at_time_of_init) {
                break 'brk &manager.root_package_json_name_at_time_of_init;
            }

            // Try our best to get the package.json name they meant
            'from_package_json: {
                // `root_dir` is set once by `PackageManager::init()` and points
                // into the resolver's directory cache for the process lifetime.
                // `.data` probes must hold `entries_mutex` (uncontended on
                // this single-threaded CLI path).
                let has_package_json = {
                    let _entries_lock = bun_resolver::fs::FileSystem::instance()
                        .fs
                        .entries_mutex
                        .lock_guard();
                    manager.root_dir.has_comptime_query(b"package.json")
                };
                if !has_package_json {
                    fail(
                        json_output,
                        b"EUSAGE",
                        b"No package name was given and no package.json was found",
                        b"",
                    );
                }
                let fd = manager.root_dir.fd;
                if !fd.is_valid() {
                    break 'from_package_json;
                }
                let str = match bun_sys::File::read_from(fd, b"package.json") {
                    Ok(s) => s,
                    Err(_) => break 'from_package_json,
                };
                // Note: copy into the function-scope bump so the slice
                // outlives this block.
                let str: &[u8] = bump.alloc_slice_copy(&str);
                let source = &bun_ast::Source::init_path_string(b"package.json", str);
                let mut pkg_log = bun_ast::Log::init();
                let Ok(pkg_json) = JSON::parse_utf8(source, &mut pkg_log, &bump) else {
                    break 'from_package_json;
                };
                if let Some(name) = pkg_json.get_string_cloned(&bump, b"name").ok().flatten() {
                    if !name.is_empty() {
                        break 'brk name;
                    }
                }
            }

            break 'brk bun_paths::basename(bun_paths::fs::FileSystem::instance().top_level_dir());
        }

        break 'brk spec_;
    });

    for field in fields {
        if let Err(err) = npm_queryable::parse(field) {
            fail_field_path(json_output, err);
        }
    }

    let scope = manager.scope_for_package_name(name);

    let mut url_buf = bun_paths::path_buffer_pool::get();
    let encoded_name = buf_print(
        url_buf.0.as_mut_slice(),
        format_args!("{}", bun_fmt::dependency_url(name)),
    );
    let mut path_buf = bun_paths::path_buffer_pool::get();
    // Always fetch the full registry manifest, not a specific version
    let url_slice = buf_print(
        path_buf.0.as_mut_slice(),
        format_args!(
            "{}/{}",
            BStr::new(strings::without_trailing_slash(scope.url.href())),
            BStr::new(encoded_name),
        ),
    );
    let url = URL::parse(url_slice);

    let mut headers = http::HeaderBuilder::default();
    headers.count(b"Accept", b"application/json");
    if !scope.token.is_empty() {
        headers.count(b"Authorization", b"");
        headers.content.cap += b"Bearer ".len() + scope.token.len();
    } else if !scope.auth.is_empty() {
        headers.count(b"Authorization", b"");
        headers.content.cap += b"Basic ".len() + scope.auth.len();
    }
    headers.allocate()?;
    headers.append(b"Accept", b"application/json");
    if !scope.token.is_empty() {
        headers.append_fmt(
            b"Authorization",
            format_args!("Bearer {}", BStr::new(&*scope.token)),
        );
    } else if !scope.auth.is_empty() {
        headers.append_fmt(
            b"Authorization",
            format_args!("Basic {}", BStr::new(&*scope.auth)),
        );
    }

    let mut response_buf = MutableString::init(2048)?;
    let header_buf: &[u8] = headers.content.written_slice();
    let http_proxy = manager.http_proxy(&url);
    let mut req = http::AsyncHTTP::init_sync(
        http::Method::GET,
        url,
        headers.entries,
        header_buf,
        b"",
        http_proxy,
        http::FetchRedirect::Follow,
    );
    req.client.flags.reject_unauthorized = manager.tls_reject_unauthorized();

    let res = match req.send_sync(&mut response_buf) {
        Ok(r) => r,
        Err(err) => {
            if json_output {
                let mut summary: Vec<u8> = Vec::new();
                let _ = write!(
                    &mut summary,
                    "request to {} failed to send",
                    bun_fmt::redacted_npm_url(req.url.href)
                );
                fail(true, err.name().as_bytes(), &summary, b"");
            }
            Output::err(err, "view request failed to send", ());
            Global::crash();
        }
    };

    if res.status_code() >= 400 {
        if json_output {
            let mut code: Vec<u8> = Vec::new();
            let _ = write!(&mut code, "E{}", res.status_code());
            let mut summary: Vec<u8> = Vec::new();
            let _ = write!(
                &mut summary,
                "{}{}{}: {}",
                res.status_code(),
                if res.status_text().is_empty() {
                    ""
                } else {
                    " "
                },
                BStr::new(res.status_text()),
                bun_fmt::redacted_npm_url(req.url.href),
            );
            let mut detail: Vec<u8> = Vec::new();
            if res.status_code() == 404 {
                let _ = write!(
                    &mut detail,
                    "'{}@{}' does not exist in this registry",
                    BStr::new(name),
                    BStr::new(version)
                );
            } else if let Some(message) = npm::response_error_message(&response_buf)? {
                detail = message;
            }
            fail(true, &code, &summary, &detail);
        }
        npm::response_error::<false>(&req, &res, Some((name, version)), &mut response_buf)?;
    }

    let mut log = bun_ast::Log::init();
    let source = &bun_ast::Source::init_path_string(b"view.json", response_buf.list.as_slice());
    let json: Expr = match JSON::parse_utf8(source, &mut log, &bump) {
        Ok(j) if log.errors == 0 => j,
        result => {
            if json_output {
                fail(
                    true,
                    b"EJSONPARSE",
                    b"failed to parse response body as JSON",
                    b"",
                );
            }
            match result {
                Err(err) => Output::err(err, "failed to parse response body as JSON", ()),
                Ok(_) => log.print(std::ptr::from_mut(Output::error_writer()))?,
            }
            Global::crash();
        }
    };

    let parsed_manifest = match PackageManifest::parse(
        scope,
        &mut log,
        response_buf.list.as_slice(),
        name,
        b"",  // last_modified (not needed for view)
        b"",  // etag (not needed for view)
        0,    // public_max_age (not needed for view)
        true, // is_extended_manifest (view uses application/json Accept header)
    ) {
        Ok(Some(m)) => m,
        result => {
            if json_output {
                fail(
                    true,
                    b"EINVALIDMANIFEST",
                    b"failed to parse package manifest",
                    b"",
                );
            }
            match result {
                Err(err) => Output::err(err, "failed to parse package manifest", ()),
                Ok(_) => Output::err_generic("failed to parse package manifest", ()),
            }
            Global::crash();
        }
    };

    // `versions` keys that parse as semver, oldest first. npm sorts and
    // validates this list too, so publish order never leaks into `versions`,
    // the `versions: N` header count, or the "Recent versions" hint.
    let sorted_versions = SortedVersions::from_packument(&bump, &json);

    let selected: Option<(&[u8], Expr)> = 'select: {
        let Some(versions_obj) = json.get_object(b"versions") else {
            break 'select None;
        };
        let wanted_version: Semver::Version =
            if let Some(result) = parsed_manifest.find_by_dist_tag(version) {
                result.version
            } else {
                let sliced_literal = Semver::SlicedString::init(version, version);
                let query = Semver::query::parse(version, sliced_literal)?;
                // A spec that is neither a dist-tag nor a range (`pkg@notatag`)
                // parses to an empty group, which every version satisfies.
                // `latest` is the default spec, so without that tag it still
                // means the newest version.
                if query.is_empty() && version != b"latest" {
                    break 'select None;
                }
                match parsed_manifest.find_best_version(&query, version) {
                    Some(result) => result.version,
                    None => break 'select None,
                }
            };

        let mut found: Option<(&[u8], Expr)> = None;
        versions_obj.for_each_property(|key, _, value| {
            if found.is_some() {
                return;
            }
            let parsed = Semver::Version::parse(Semver::SlicedString::init(key, key));
            if parsed.valid && parsed.version.max().eql(wanted_version) {
                found = Some((&*bump.alloc_slice_copy(key), value));
            }
        });
        found
    };

    let Some((version, manifest)) = selected else {
        if json_output {
            let mut summary: Vec<u8> = Vec::new();
            let _ = write!(
                &mut summary,
                "No version of \"{}\" satisfying \"{}\" found",
                BStr::new(name),
                BStr::new(version)
            );
            let mut detail: Vec<u8> = Vec::new();
            let recent = sorted_versions.recent(MAX_RECENT_VERSIONS);
            if !recent.is_empty() {
                let _ = write!(&mut detail, "Recent versions:");
                for (i, v) in recent.iter().enumerate() {
                    let _ = write!(
                        &mut detail,
                        "{}{}",
                        if i == 0 { " " } else { ", " },
                        BStr::new(v)
                    );
                }
            }
            fail(true, b"E404", &summary, &detail);
        }

        Output::err_generic(
            "No version of <b>{}<r> satisfying <b>{}<r> found",
            (bun_fmt::quote(name), bun_fmt::quote(version)),
        );
        let recent = sorted_versions.recent(MAX_RECENT_VERSIONS);
        if !recent.is_empty() {
            bun_core::pretty_errorln!("\nRecent versions:<r>");
            for v in &recent {
                bun_core::pretty_errorln!("<d>-<r> {}", BStr::new(*v));
            }
            let hidden = sorted_versions.len() - recent.len();
            if hidden > 0 {
                bun_core::pretty_errorln!("  <d>... and {} more<r>", hidden);
            }
        }
        Global::exit(1);
    };

    // What npm calls the manifest for `view`: the packument root with the
    // selected version's fields laid over it, `versions` replaced by the
    // sorted list, and `readme` dropped unless a field asks for it.
    let wants_readme = fields.iter().any(|f| {
        npm_queryable::parse(f).is_ok_and(|keys| keys.first().is_some_and(|k| *k == b"readme"))
    });
    let merged = merge_manifest(json, manifest, sorted_versions.to_array(), wants_readme);

    if !fields.is_empty() {
        let mut results: Vec<FieldResult<'_>> = Vec::new();
        for field in fields {
            if let Err(err) = npm_queryable::query(&bump, merged, field, &mut results) {
                fail_field_path(json_output, err);
            }
        }
        print_fields(&results, source, json_output)?;
        return Ok(());
    }

    if json_output {
        Output::print(format_args!(
            "{}",
            BStr::new(&to_json_text(merged, source, true)?)
        ));
        Output::flush();
        return Ok(());
    }

    print_pretty(&bump, name, version, json, merged, sorted_versions.len())
}

const MAX_RECENT_VERSIONS: usize = 5;

/// Print an error and exit 1. Under `--json` every failure has this one
/// shape on stdout (the same keys as `npm view --json`), so a consumer can
/// always read `.error.code`.
#[cold]
fn fail(json_output: bool, code: &[u8], summary: &[u8], detail: &[u8]) -> ! {
    if json_output {
        let quote = || bun_fmt::JSONFormatterUTF8Options { quote: true };
        Output::print(format_args!(
            "{{\n  \"error\": {{\n    \"code\": {},\n    \"summary\": {},\n    \"detail\": {}\n  }}\n}}\n",
            bun_fmt::format_json_string_utf8(code, quote()),
            bun_fmt::format_json_string_utf8(summary, quote()),
            bun_fmt::format_json_string_utf8(detail, quote()),
        ));
        Output::flush();
    } else {
        Output::err_generic("{}", (BStr::new(summary),));
        if !detail.is_empty() {
            bun_core::pretty_errorln!("{}", BStr::new(detail));
        }
    }
    Global::exit(1);
}

#[cold]
fn fail_field_path(json_output: bool, err: FieldPathError) -> ! {
    match err {
        FieldPathError::EmptyBrackets => fail(
            json_output,
            b"EINVALIDSYNTAX",
            b"Empty brackets are not valid syntax for retrieving values.",
            b"",
        ),
    }
}

struct SortedVersions<'a> {
    /// `(key expr, key text)` sorted by semver, oldest first.
    entries: Vec<(Expr, &'a [u8])>,
}

impl<'a> SortedVersions<'a> {
    fn from_packument(bump: &'a Bump, json: &Expr) -> Self {
        let mut entries: Vec<(Expr, &'a [u8], Semver::Version)> = Vec::new();
        if let Some(versions_obj) = json.get_object(b"versions") {
            entries.reserve(versions_obj.property_count());
            versions_obj.for_each_property(|key, loc, _| {
                let parsed = Semver::Version::parse(Semver::SlicedString::init(key, key));
                if !parsed.valid {
                    return;
                }
                let key: &'a [u8] = bump.alloc_slice_copy(key);
                let key_expr = Expr::init(
                    E::String {
                        data: E::Str::new(key),
                        ..Default::default()
                    },
                    loc,
                );
                entries.push((key_expr, key, parsed.version.min()));
            });
        }
        entries.sort_by(|a, b| a.2.order(b.2, a.1, b.1));
        Self {
            entries: entries.into_iter().map(|(e, k, _)| (e, k)).collect(),
        }
    }

    fn len(&self) -> usize {
        self.entries.len()
    }

    /// The newest `max` versions, oldest first.
    fn recent(&self, max: usize) -> Vec<&'a [u8]> {
        let start = self.entries.len().saturating_sub(max);
        self.entries[start..].iter().map(|(_, k)| *k).collect()
    }

    fn to_array(&self) -> Expr {
        let mut items: Vec<Expr> = Vec::with_capacity(self.entries.len());
        for (expr, _) in &self.entries {
            items.push(*expr);
        }
        Expr::init(
            E::Array {
                items: bun_ast::ExprNodeList::from_owned_slice(items.into_boxed_slice()),
                ..Default::default()
            },
            bun_ast::Loc::EMPTY,
        )
    }
}

fn property_key(prop: &G::Property) -> Option<&[u8]> {
    let key = prop.key.as_ref()?;
    let ExprData::EString(s) = &key.data else {
        return None;
    };
    Some(s.data.slice())
}

fn new_property(key: &[u8], value: Expr) -> G::Property {
    G::Property {
        key: Some(Expr::init(
            E::String {
                data: E::Str::new(key),
                ..Default::default()
            },
            bun_ast::Loc::EMPTY,
        )),
        value: Some(value),
        ..Default::default()
    }
}

fn new_object(properties: Vec<G::Property>) -> Expr {
    Expr::init(
        E::Object {
            properties: G::PropertyList::from_owned_slice(properties.into_boxed_slice()),
            ..Default::default()
        },
        bun_ast::Loc::EMPTY,
    )
}

/// Root packument fields first (in registry order), then the selected
/// version's fields override or append. This is the object every field path
/// is resolved against and what bare `--json` prints, same as npm.
fn merge_manifest(root: Expr, version: Expr, versions_array: Expr, wants_readme: bool) -> Expr {
    let mut props: Vec<G::Property> =
        Vec::with_capacity(root.property_count() + version.property_count());
    let mut has_versions = false;
    if let ExprData::EObject(obj) = &root.data {
        for prop in obj.properties.slice() {
            let (Some(key), Some(value)) = (property_key(prop), prop.value) else {
                continue;
            };
            match key {
                b"readme" if !wants_readme => continue,
                b"versions" => {
                    has_versions = true;
                    props.push(new_property(key, versions_array));
                }
                _ => props.push(new_property(key, value)),
            }
        }
    }
    if !has_versions {
        props.push(new_property(b"versions", versions_array));
    }
    if let ExprData::EObject(obj) = &version.data {
        'next: for prop in obj.properties.slice() {
            let (Some(key), Some(value)) = (property_key(prop), prop.value) else {
                continue;
            };
            // A requested readme comes from the packument root, like npm.
            if key == b"versions" || (key == b"readme" && wants_readme) {
                continue;
            }
            for existing in props.iter_mut() {
                if property_key(existing) == Some(key) {
                    existing.value = Some(value);
                    continue 'next;
                }
            }
            props.push(new_property(key, value));
        }
    }
    new_object(props)
}

fn to_json_text(
    value: Expr,
    source: &bun_ast::Source,
    newline: bool,
) -> Result<Vec<u8>, crate::Error> {
    let mut buffer_writer = JSPrinter::BufferWriter::init();
    buffer_writer.append_newline = newline;
    let mut printer = JSPrinter::BufferPrinter::init(buffer_writer);
    JSPrinter::print_json(
        &mut printer,
        value,
        source,
        JSPrinter::PrintJsonOptions {
            mangled_props: None,
            ..Default::default()
        },
    )?;
    Ok(printer.ctx.get_written().to_vec())
}

/// One result prints bare (a string without quotes unless `--json`). Several
/// results print as `label = <json>` lines, or as one JSON object.
fn print_fields(
    results: &[FieldResult<'_>],
    source: &bun_ast::Source,
    json_output: bool,
) -> Result<(), crate::Error> {
    match results {
        [] => {}
        [single] => {
            if let ExprData::EString(s) = &single.value.data {
                let slice = s.data.slice();
                if json_output {
                    Output::print(format_args!(
                        "{}\n",
                        bun_fmt::format_json_string_utf8(slice, Default::default())
                    ));
                } else {
                    Output::print(format_args!("{}\n", BStr::new(slice)));
                }
            } else {
                Output::print(format_args!(
                    "{}",
                    BStr::new(&to_json_text(single.value, source, true)?)
                ));
            }
        }
        many => {
            if json_output {
                let props: Vec<G::Property> = many
                    .iter()
                    .map(|r| new_property(r.label, r.value))
                    .collect();
                Output::print(format_args!(
                    "{}",
                    BStr::new(&to_json_text(new_object(props), source, true)?)
                ));
            } else {
                for r in many {
                    Output::print(format_args!(
                        "{} = {}\n",
                        BStr::new(r.label),
                        BStr::new(&to_json_text(r.value, source, false)?)
                    ));
                }
            }
        }
    }
    Output::flush();
    Ok(())
}

fn print_pretty(
    bump: &Bump,
    name: &[u8],
    version: &[u8],
    root: Expr,
    manifest: Expr,
    versions_len: usize,
) -> Result<(), crate::Error> {
    let pkg_name: &[u8] = manifest
        .get_string_cloned(bump, b"name")
        .ok()
        .flatten()
        .unwrap_or(name);
    let pkg_version: &[u8] = manifest
        .get_string_cloned(bump, b"version")
        .ok()
        .flatten()
        .unwrap_or(version);
    // `license` is a string, or the legacy `{ "type": "MIT", "url": ... }`.
    let license: &[u8] = manifest
        .get(b"license")
        .and_then(|l| {
            l.as_string(bump)
                .or_else(|| l.get_string_cloned(bump, b"type").ok().flatten())
        })
        .filter(|l| !l.is_empty())
        .unwrap_or(b"Proprietary");
    let dependencies_object = manifest.get_object(b"dependencies");
    let dep_count = dependencies_object.map_or(0, |deps| deps.property_count());

    prettyln!(
        "<b><blue><u>{}<r><d>@<r><blue><b><u>{}<r> <d>|<r> <cyan>{}<r> <d>|<r> deps<d>:<r> {} <d>|<r> versions<d>:<r> {}",
        BStr::new(pkg_name),
        BStr::new(pkg_version),
        BStr::new(license),
        dep_count,
        versions_len,
    );

    if let Some(desc) = manifest
        .get_string_cloned(bump, b"description")
        .ok()
        .flatten()
    {
        prettyln!("{}", BStr::new(desc));
    }
    if let Some(homepage) = manifest.get(b"homepage").and_then(|h| {
        h.as_string(bump)
            .or_else(|| h.get_string_cloned(bump, b"url").ok().flatten())
    }) {
        prettyln!("<blue>{}<r>", BStr::new(homepage));
    }

    if let Some(mut iter) = manifest.get_array(b"keywords") {
        let mut keywords: Vec<u8> = Vec::new();
        while let Some(kw_expr) = iter.next() {
            if let Some(kw) = kw_expr.as_string(bump) {
                if !keywords.is_empty() {
                    keywords.extend_from_slice(b", ");
                }
                keywords.extend_from_slice(kw);
            }
        }
        if !keywords.is_empty() {
            prettyln!("<d>keywords:<r> {}", BStr::new(&keywords));
        }
    }

    if let Some(bin) = manifest.get_object(b"bin") {
        let mut bins: Vec<u8> = Vec::new();
        bin.for_each_property(|key, _, _| {
            if !bins.is_empty() {
                bins.extend_from_slice(b", ");
            }
            bins.extend_from_slice(key);
        });
        if !bins.is_empty() {
            prettyln!("<d>bin:<r> <cyan>{}<r>", BStr::new(&bins));
        }
    }

    if let Some(deprecated) = manifest
        .get_string_cloned(bump, b"deprecated")
        .ok()
        .flatten()
    {
        prettyln!("\n<red><b>DEPRECATED<r> ⚠️  - {}", BStr::new(deprecated));
    }

    if let Some(deps) = &dependencies_object {
        if dep_count > 0 {
            prettyln!("\n<b>dependencies<r><d> ({}):<r>", dep_count);
        }
        deps.for_each_property(|dep_name, _, value| {
            if let Some(dep_version) = value.as_string(bump) {
                prettyln!(
                    "- <cyan>{}<r><d>:<r> {}",
                    BStr::new(dep_name),
                    BStr::new(dep_version),
                );
            }
        });
    }

    if let Some(dist) = manifest.get_object(b"dist") {
        prettyln!("\n<d><r><b>dist<r>");
        if let Some(t) = dist.get_string_cloned(bump, b"tarball").ok().flatten() {
            prettyln!(" <d>.<r>tarball<d>:<r> {}", BStr::new(t));
        }
        if let Some(s) = dist.get_string_cloned(bump, b"shasum").ok().flatten() {
            prettyln!(" <d>.<r>shasum<r><d>:<r> <green>{}<r>", BStr::new(s));
        }
        if let Some(i) = dist.get_string_cloned(bump, b"integrity").ok().flatten() {
            prettyln!(" <d>.<r>integrity<r><d>:<r> <green>{}<r>", BStr::new(i));
        }
        if let Some(u) = dist.get_number(b"unpackedSize") {
            prettyln!(
                " <d>.<r>unpackedSize<r><d>:<r> <blue>{}<r>",
                bun_fmt::size(u.0 as usize, Default::default()),
            );
        }
    }

    if let Some(tags_obj) = root.get_object(b"dist-tags") {
        prettyln!("\n<b>dist-tags<r><d>:<r>");
        tags_obj.for_each_property(|tag, _, value| {
            let Some(val) = value.as_string(bump) else {
                return;
            };
            if tag == b"latest" {
                prettyln!("<cyan>{}<r><d>:<r> {}", BStr::new(tag), BStr::new(val));
            } else if tag == b"beta" {
                prettyln!("<blue>{}<r><d>:<r> {}", BStr::new(tag), BStr::new(val));
            } else {
                prettyln!("<magenta>{}<r><d>:<r> {}", BStr::new(tag), BStr::new(val));
            }
        });
    }

    // Current owners live on the packument root; the copy inside a version
    // is frozen at publish time.
    if let Some(mut iter) = root
        .get_array(b"maintainers")
        .or_else(|| manifest.get_array(b"maintainers"))
    {
        prettyln!("\nmaintainers<r><d>:<r>");
        while let Some(m) = iter.next() {
            let nm: &[u8] = m
                .get_string_cloned(bump, b"name")
                .ok()
                .flatten()
                .unwrap_or(b"");
            let em: &[u8] = m
                .get_string_cloned(bump, b"email")
                .ok()
                .flatten()
                .unwrap_or(b"");
            if !em.is_empty() {
                prettyln!("<d>-<r> {} <d>\\<{}\\><r>", BStr::new(nm), BStr::new(em));
            } else if !nm.is_empty() {
                prettyln!("<d>-<r> {}", BStr::new(nm));
            }
        }
    }

    if let Some(time_obj) = root.get_object(b"time") {
        if let Some(published_time) = time_obj
            .get_string_cloned(bump, pkg_version)
            .ok()
            .flatten()
            .or_else(|| time_obj.get_string_cloned(bump, b"modified").ok().flatten())
        {
            prettyln!("\n<b>Published<r><d>:<r> {}", BStr::new(published_time));
        }
    }

    Ok(())
}
