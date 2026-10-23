use bstr::BStr;
use bun_alloc::Arena as Bump;
use bun_collections::{StringArrayHashMap, VecExt};
use bun_core::MutableString;
use bun_core::fmt as bun_fmt;
use bun_core::fmt::escape_control_chars;
use bun_core::strings;
use bun_core::{Global, Output, prettyln};
use bun_http as http;
use bun_install::PackageManager;
use bun_install::dependency;
use bun_install::npm::{self, PackageManifest};
use bun_js_parser as ast;
use bun_js_printer as JSPrinter;
use bun_parsers::json as JSON;
use bun_semver as Semver;
use bun_url::URL;

use crate::cli::pm_pkg_command::PmPkgCommand;

fn string_of<'b>(object: &ast::Expr, bump: &'b Bump, key: &[u8]) -> Option<&'b [u8]> {
    object.get_string_cloned(bump, key).ok().flatten()
}

/// A `--json` failure is one flat object on stdout.
fn print_json_error(error: &str, spec: &[u8], property: Option<&[u8]>) {
    let quoted = bun_fmt::JSONFormatterUTF8Options { quote: true };
    Output::print(format_args!(
        "{{ \"error\": \"{}\", \"version\": {}",
        error,
        bun_fmt::format_json_string_utf8(spec, quoted),
    ));
    if let Some(property) = property {
        Output::print(format_args!(
            ", \"property\": {}",
            bun_fmt::format_json_string_utf8(property, quoted),
        ));
    }
    Output::print(format_args!(" }}\n"));
    Output::flush();
}

fn to_json_text(value: ast::Expr, source: &bun_ast::Source) -> Result<Vec<u8>, crate::Error> {
    let mut printer = JSPrinter::BufferPrinter::init(JSPrinter::BufferWriter::init());
    let _ = JSPrinter::print_json(
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

pub(crate) fn view(
    manager: &mut PackageManager,
    spec_: &[u8],
    fields: &[&[u8]],
    json_output: bool,
) -> Result<(), crate::Error> {
    let bump = Bump::new();
    let (name, mut version) = dependency::split_name_and_version_or_latest('brk: {
        // Extremely best effort.
        if spec_ == b"." || spec_ == b"" {
            if strings::is_npm_package_name(&manager.root_package_json_name_at_time_of_init) {
                break 'brk &manager.root_package_json_name_at_time_of_init;
            }

            // Try our best to get the package.json name they meant
            'from_package_json: {
                // `root_dir` is in the resolver's directory cache, so lookups must hold
                // `entries_mutex`.
                let has_package_json = {
                    let _entries_lock = bun_resolver::fs::FileSystem::instance()
                        .fs
                        .entries_mutex
                        .lock_guard();
                    manager.root_dir.has_comptime_query(b"package.json")
                };
                if !has_package_json {
                    const NO_NAME: &str = "no package name given and no package.json found";
                    if json_output {
                        print_json_error(NO_NAME, spec_, None);
                    } else {
                        Output::err_generic(NO_NAME, ());
                    }
                    Global::exit(1);
                }
                let fd = manager.root_dir.fd;
                if !fd.is_valid() {
                    break 'from_package_json;
                }
                let Ok(str) = bun_sys::File::read_from(fd, b"package.json") else {
                    break 'from_package_json;
                };
                let str: &[u8] = bump.alloc_slice_copy(&str);
                let source = &bun_ast::Source::init_path_string(b"package.json", str);
                let mut pkg_log = bun_ast::Log::init();
                let Ok(pkg_json) = JSON::parse_package_json_utf8(source, &mut pkg_log, &bump)
                else {
                    break 'from_package_json;
                };
                if let Some(name) = string_of(&pkg_json, &bump, b"name").filter(|n| !n.is_empty()) {
                    break 'brk name;
                }
            }

            break 'brk bun_paths::basename(bun_paths::fs::FileSystem::instance().top_level_dir());
        }

        break 'brk spec_;
    });

    let scope = manager.scope_for_package_name(name);

    // Always fetch the full registry manifest, not a specific version
    let href = format!(
        "{}/{}",
        BStr::new(strings::without_trailing_slash(scope.url.href())),
        bun_fmt::dependency_url(name),
    );
    let url = URL::parse(href.as_bytes());

    let authorization = scope.authorization(&url);
    let mut pairs: Vec<(&[u8], &[u8])> = vec![(b"Accept", b"application/json")];
    if let Some(authorization) = &authorization {
        pairs.push((b"Authorization", authorization));
    }
    let headers = http::HeaderBuilder::from_pairs(&pairs)?;

    let mut response_buf = MutableString::init(2048)?;
    let header_buf: &[u8] = headers.content.written_slice();
    let mut req =
        manager.registry_request(http::Method::GET, url, headers.entries, header_buf, b"");

    let res = match manager.send_with_retries(&mut req, &mut response_buf) {
        Ok(r) => r,
        Err(err) => {
            Output::err(err, "view request failed to send", ());
            Global::crash();
        }
    };

    if res.status_code() >= 400 {
        npm::response_error::<false>(&req, &res, Some((name, version)), &mut response_buf)?;
    }

    let mut log = bun_ast::Log::init();
    let source = &bun_ast::Source::init_path_string(b"view.json", response_buf.list.as_slice());
    let json: ast::Expr = match JSON::parse_utf8(source, &mut log, &bump) {
        Ok(j) => j,
        Err(err) => {
            Output::err(err, "failed to parse response body as JSON", ());
            Global::crash();
        }
    };
    if log.errors > 0 {
        log.print(std::ptr::from_mut(Output::error_writer()))?;
        Global::crash();
    }

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
        Ok(None) => {
            Output::err_generic("failed to parse package manifest", ());
            Global::crash();
        }
        Err(err) => {
            Output::err(err, "failed to parse package manifest", ());
            Global::exit(1);
        }
    };

    let mut manifest;
    let versions_len: usize;

    'brk: {
        let mut not_found = bun_install::Error::NoMatchingVersion;
        'from_versions: {
            if let Some(versions_obj) = json.get_object(b"versions") {
                let versions_e_obj = versions_obj
                    .data
                    .e_object()
                    .expect("infallible: variant checked");
                let versions = versions_e_obj.properties.slice();
                versions_len = versions.len();

                let wanted_version: Semver::Version = match parsed_manifest.find_by_spec(version) {
                    Ok(result) => result.version,
                    Err(
                        err @ (bun_install::Error::DistTagNotFound
                        | bun_install::Error::NoMatchingVersion),
                    ) => {
                        not_found = err;
                        break 'from_versions;
                    }
                    Err(err) => return Err(err.into()),
                };

                for prop in versions {
                    let Some(version_str) = prop.key.and_then(|key| key.as_string(&bump)) else {
                        continue;
                    };
                    let sliced_version = Semver::SlicedString::init(version_str, version_str);
                    let parsed_version = Semver::Version::parse(sliced_version);
                    if parsed_version.valid && parsed_version.version.max().eql(wanted_version) {
                        let value = prop.value.expect("infallible: prop has value");
                        // The registry controls this value. `Expr::set` below requires an object.
                        if !value.is_object() {
                            Output::err_generic(
                                "failed to parse package manifest: version <b>{}<r> is not an object",
                                (bun_fmt::quote(version_str),),
                            );
                            Global::exit(1);
                        }
                        version = version_str;
                        manifest = value;
                        break 'brk;
                    }
                }
            }
        }

        let is_dist_tag = matches!(not_found, bun_install::Error::DistTagNotFound);
        if json_output {
            let error = if is_dist_tag {
                "Dist-tag not found"
            } else {
                "No matching version found"
            };
            print_json_error(error, spec_, None);
        } else if is_dist_tag {
            Output::err_generic(
                "Package <b>{}<r> with tag <b>{}<r> not found, but package exists",
                (bun_fmt::quote(name), bun_fmt::quote(version)),
            );

            let max_tags_to_display: usize = 10;
            let tags_len = parsed_manifest.dist_tags().count();
            if tags_len > 0 {
                bun_core::pretty_errorln!("\nTags:<r>");
                for (tag, v) in parsed_manifest.dist_tags().take(max_tags_to_display) {
                    bun_core::pretty_errorln!(
                        "<d>-<r> {}<d>:<r> {}",
                        escape_control_chars(tag),
                        v.fmt(&parsed_manifest.string_buf),
                    );
                }
                if tags_len > max_tags_to_display {
                    bun_core::pretty_errorln!(
                        "  <d>... and {} more<r>",
                        tags_len - max_tags_to_display
                    );
                }
            }
        } else {
            Output::err_generic(
                "No version of <b>{}<r> satisfying <b>{}<r> found",
                (bun_fmt::quote(name), bun_fmt::quote(version)),
            );

            let max_versions_to_display: usize = 5;

            // The newest published versions. Prereleases are only included if nothing else was ever
            // published.
            let mut all_versions = parsed_manifest.release_versions();
            if all_versions.is_empty() {
                all_versions = parsed_manifest.prerelease_versions();
            }
            let start_index = all_versions.len().saturating_sub(max_versions_to_display);
            let versions_to_display = &all_versions[start_index..];
            if !versions_to_display.is_empty() {
                bun_core::pretty_errorln!("\nRecent versions:<r>");
                for v in versions_to_display {
                    bun_core::pretty_errorln!("<d>-<r> {}", v.fmt(&parsed_manifest.string_buf));
                }

                if start_index > 0 {
                    bun_core::pretty_errorln!("  <d>... and {} more<r>", start_index);
                }
            }
        }
        Global::exit(1);
    }

    // Versions are handled specially, because npm normalizes them: only the valid ones, in semver
    // order.
    if let Some(versions_object) = json.get_object(b"versions") {
        let versions_e_obj = versions_object
            .data
            .e_object()
            .expect("infallible: variant checked");
        let mut keys: Vec<(Semver::Version, &[u8], ast::Expr)> = Vec::with_capacity(versions_len);
        for prop in versions_e_obj.properties.slice() {
            let Some(key) = prop.key else { continue };
            let Some(text) = key.as_string(&bump) else {
                continue;
            };
            let parsed = Semver::Version::parse(Semver::SlicedString::init(text, text));
            if parsed.valid {
                keys.push((parsed.version.min(), text, key));
            }
        }
        bun_collections::index_sort::sort_slice_by(&mut keys, |a, b| a.0.order(b.0, a.1, b.1));
        let keys: Vec<ast::Expr> = keys.into_iter().map(|(_, _, key)| key).collect();
        let versions_array = ast::Expr::init(
            ast::E::Array {
                items: ast::ExprNodeList::from_owned_slice(keys.into_boxed_slice()),
                ..Default::default()
            },
            bun_ast::Loc { start: -1 },
        );
        manifest.set(&bump, b"versions", versions_array)?;
    }

    // Like `npm view`, add the package-level fields (`dist-tags`, `time`). The readme is only added
    // on request.
    json.try_for_each_property(|key, _, value| {
        if key != b"versions"
            && (key != b"readme" || !fields.is_empty())
            && manifest.get(key).is_none()
        {
            manifest.set(&bump, key, value)?;
        }
        Ok::<(), bun_alloc::AllocError>(())
    })?;

    if !fields.is_empty() {
        let mut found: StringArrayHashMap<ast::Expr> = StringArrayHashMap::new();
        for &field in fields {
            match PmPkgCommand::query(manifest, field, &mut found) {
                Ok(()) => {}
                Err(crate::Error::InvalidPath) if strings::contains(field, b"[]") => {
                    if json_output {
                        print_json_error(PmPkgCommand::EMPTY_BRACKETS, spec_, Some(field));
                    } else {
                        Output::err_generic(PmPkgCommand::EMPTY_BRACKETS, ());
                    }
                    Global::exit(1);
                }
                Err(crate::Error::InvalidPath) => {}
                Err(err) => return Err(err),
            }
        }

        match (found.keys(), found.values()) {
            // A field that does not exist is skipped unless there is nothing else to print.
            ([], _) => {
                if json_output {
                    print_json_error("Property not found", spec_, Some(fields[0]));
                } else {
                    for &field in fields {
                        Output::err_generic(
                            "Property <b>{}<r> not found",
                            format_args!("{}", BStr::new(field)),
                        );
                    }
                }
                Global::exit(1);
            }
            ([_], [value]) => {
                if let bun_ast::ExprData::EString(e_string) = &value.data {
                    // `parse_utf8` always produces UTF-8 strings.
                    let slice = e_string.data.slice();
                    if json_output {
                        Output::print(format_args!(
                            "{}\n",
                            bun_fmt::format_json_string_utf8(slice, Default::default())
                        ));
                    } else {
                        Output::print(format_args!(
                            "{}\n",
                            bun_fmt::escape_control_chars_multiline(slice)
                        ));
                    }
                } else {
                    let text = to_json_text(*value, source)?;
                    if json_output {
                        Output::print(format_args!("{}\n", BStr::new(&text)));
                    } else {
                        Output::print(format_args!(
                            "{}\n",
                            bun_fmt::escape_control_chars_multiline(&text)
                        ));
                    }
                }
            }
            (labels, values) if json_output => {
                let mut object = ast::Expr::init(ast::E::Object::default(), bun_ast::Loc::EMPTY);
                for (label, value) in labels.iter().zip(values) {
                    object.set(&bump, label, *value)?;
                }
                Output::print(format_args!(
                    "{}\n",
                    BStr::new(&to_json_text(object, source)?)
                ));
            }
            (labels, values) => {
                for (label, value) in labels.iter().zip(values) {
                    Output::print(format_args!(
                        "{} = {}\n",
                        escape_control_chars(label),
                        bun_fmt::escape_control_chars_multiline(&to_json_text(*value, source)?),
                    ));
                }
            }
        }
        Output::flush();
        return Ok(());
    }

    if json_output {
        Output::print(format_args!(
            "{}\n",
            BStr::new(&to_json_text(manifest, source)?)
        ));
        Output::flush();
        return Ok(());
    }

    let string = |key: &[u8]| string_of(&manifest, &bump, key);
    let pkg_name: &[u8] = string(b"name").unwrap_or(name);
    let pkg_version: &[u8] = string(b"version").unwrap_or(version);
    // `license` is a string, or the legacy `{ "type": "MIT", "url": ... }`.
    let license: &[u8] = manifest
        .get(b"license")
        .and_then(|license| {
            license
                .as_string(&bump)
                .or_else(|| string_of(&license, &bump, b"type"))
        })
        .filter(|license| !license.is_empty())
        .unwrap_or(b"Proprietary");
    let dependencies_object = manifest
        .get_object(b"dependencies")
        .map(|deps| deps.data.e_object().expect("infallible: variant checked"));
    let dependencies = (dependencies_object.as_ref())
        .map(|deps| deps.properties.slice())
        .unwrap_or_default();

    // Every string printed below comes from the registry, so always pass it through
    // `escape_control_chars`.
    prettyln!(
        "<b><blue><u>{}<r><d>@<r><blue><b><u>{}<r> <d>|<r> <cyan>{}<r> <d>|<r> deps<d>:<r> {} <d>|<r> versions<d>:<r> {}",
        escape_control_chars(pkg_name),
        escape_control_chars(pkg_version),
        escape_control_chars(license),
        dependencies.len(),
        versions_len,
    );

    if let Some(desc) = string(b"description") {
        prettyln!("{}", escape_control_chars(desc));
    }
    if let Some(hp) = string(b"homepage") {
        prettyln!("<blue>{}<r>", bun_fmt::for_terminal(BStr::new(hp)));
    }

    if let Some(mut iter) = manifest.get_array(b"keywords") {
        let mut keywords = MutableString::init(64)?;
        let mut first = true;
        while let Some(kw_expr) = iter.next() {
            if let Some(kw) = kw_expr.as_string(&bump) {
                if !first {
                    keywords.append_slice(b", ")?;
                } else {
                    first = false;
                }
                keywords.append_slice(kw)?;
            }
        }
        if !keywords.list.is_empty() {
            let keywords = escape_control_chars(keywords.list.as_slice());
            prettyln!("<d>keywords:<r> {}", keywords);
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
            prettyln!("<d>bin:<r> <cyan>{}<r>", escape_control_chars(&bins));
        }
    }

    if let Some(deprecated) = string(b"deprecated") {
        let deprecated = escape_control_chars(deprecated);
        prettyln!("\n<red><b>DEPRECATED<r> ⚠️  - {}", deprecated);
    }

    if !dependencies.is_empty() {
        prettyln!("\n<b>dependencies<r><d> ({}):<r>", dependencies.len());
    }
    for prop in dependencies {
        let (Some(dep_name), Some(dep_version)) = (
            prop.key.and_then(|key| key.as_string(&bump)),
            prop.value.and_then(|value| value.as_string(&bump)),
        ) else {
            continue;
        };
        prettyln!(
            "- <cyan>{}<r><d>:<r> {}",
            escape_control_chars(dep_name),
            bun_fmt::for_terminal(BStr::new(dep_version)),
        );
    }

    if let Some(dist) = manifest.get_object(b"dist") {
        prettyln!("\n<d><r><b>dist<r>");
        if let Some(t) = string_of(&dist, &bump, b"tarball") {
            prettyln!(
                " <d>.<r>tarball<d>:<r> {}",
                bun_fmt::for_terminal(BStr::new(t))
            );
        }
        if let Some(s) = string_of(&dist, &bump, b"shasum") {
            let s = escape_control_chars(s);
            prettyln!(" <d>.<r>shasum<r><d>:<r> <green>{}<r>", s);
        }
        if let Some(i) = string_of(&dist, &bump, b"integrity") {
            let i = escape_control_chars(i);
            prettyln!(" <d>.<r>integrity<r><d>:<r> <green>{}<r>", i);
        }
        if let Some(u) = dist.get_number(b"unpackedSize") {
            prettyln!(
                " <d>.<r>unpackedSize<r><d>:<r> <blue>{}<r>",
                bun_fmt::size(u.0 as usize, Default::default()),
            );
        }
    }

    if let Some(tags_obj) = json.get_object(b"dist-tags") {
        prettyln!("\n<b>dist-tags<r><d>:<r>");
        for prop in tags_obj
            .data
            .e_object()
            .expect("infallible: variant checked")
            .properties
            .slice()
        {
            let (Some(tag), Some(val)) = (
                prop.key.and_then(|key| key.as_string(&bump)),
                prop.value.and_then(|value| value.as_string(&bump)),
            ) else {
                continue;
            };
            let tag_fmt = escape_control_chars(tag);
            let val_fmt = escape_control_chars(val);
            if tag == b"latest" {
                prettyln!("<cyan>{}<r><d>:<r> {}", tag_fmt, val_fmt);
            } else if tag == b"beta" {
                prettyln!("<blue>{}<r><d>:<r> {}", tag_fmt, val_fmt);
            } else {
                prettyln!("<magenta>{}<r><d>:<r> {}", tag_fmt, val_fmt);
            }
        }
    }

    if let Some(mut iter) = json.get_array(b"maintainers") {
        prettyln!("\nmaintainers<r><d>:<r>");
        while let Some(m) = iter.next() {
            let nm = escape_control_chars(string_of(&m, &bump, b"name").unwrap_or(b""));
            let em = escape_control_chars(string_of(&m, &bump, b"email").unwrap_or(b""));
            if !em.0.is_empty() {
                prettyln!("<d>-<r> {} <d>\\<{}\\><r>", nm, em);
            } else if !nm.0.is_empty() {
                prettyln!("<d>-<r> {}", nm);
            }
        }
    }

    if let Some(time_obj) = json.get_object(b"time") {
        let time = |key: &[u8]| string_of(&time_obj, &bump, key);
        // TODO: use a relative time formatter
        if let Some(published_time) = time(pkg_version).or_else(|| time(b"modified")) {
            let published_time = escape_control_chars(published_time);
            prettyln!("\n<b>Published<r><d>:<r> {}", published_time);
        }
    }

    Ok(())
}
