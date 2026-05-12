use bstr::BStr;
use bun_alloc::{AllocError, Arena as Bump};
use bun_collections::VecExt;
use bun_core::MutableString;
use bun_core::fmt as bun_fmt;
use bun_core::strings;
use bun_core::{Global, Output, prettyln};
use bun_http as http;
use bun_install::PackageManager;
use bun_install::dependency;
use bun_install::npm::{self, PackageManifest};
use bun_js_parser as ast;
use bun_js_printer as JSPrinter;
use bun_parsers::json as JSON;
use bun_paths::PathBuffer;
use bun_semver as Semver;
use bun_url::URL; // bumpalo::Bump re-export

use bun_core::fmt::buf_print_infallible as buf_print;

pub fn view(
    manager: &mut PackageManager,
    spec_: &[u8],
    property_path: Option<&[u8]>,
    json_output: bool,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let bump = Bump::new();
    let (name, mut version) = dependency::split_name_and_version_or_latest('brk: {
        // Extremely best effort.
        if spec_ == b"." || spec_ == b"" {
            if strings::is_npm_package_name(&manager.root_package_json_name_at_time_of_init) {
                // PORT NOTE: reshaped for borrowck — copy into the function-scope
                // bump so `name` doesn't keep `manager` borrowed across the
                // `&mut self` calls (`http_proxy`, `tls_reject_unauthorized`) below.
                break 'brk &*bump
                    .alloc_slice_copy(&manager.root_package_json_name_at_time_of_init);
            }

            // Try our best to get the package.json name they meant
            'from_package_json: {
                // `root_dir` is set once by `PackageManager::init()` and points
                // into the resolver's directory cache for the process lifetime;
                // mirrors Zig's non-optional `*DirEntry` field.
                if !manager.root_dir.has_comptime_query(b"package.json") {
                    break 'from_package_json;
                }
                let fd = manager.root_dir.fd;
                if !fd.is_valid() {
                    break 'from_package_json;
                }
                let str = match bun_sys::File::read_from(fd, b"package.json") {
                    Ok(s) => s,
                    Err(_) => break 'from_package_json,
                };
                // PORT NOTE: copy into the function-scope bump so the slice
                // outlives this block (Zig never frees this allocation either).
                let str: &[u8] = bump.alloc_slice_copy(&str);
                let source = &bun_ast::Source::init_path_string(b"package.json", str);
                let mut pkg_log = bun_ast::Log::init();
                let Ok(pkg_json) = JSON::parse::<false>(source, &mut pkg_log, &bump) else {
                    break 'from_package_json;
                };
                let pkg_json: ast::Expr = pkg_json.into();
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

    // PORT NOTE: reshaped for borrowck — clone the registry scope so it doesn't
    // keep `manager` borrowed across `http_proxy` / `tls_reject_unauthorized`
    // (`&mut self`) below; matches `outdated_command` / `update_interactive_command`.
    let scope = manager.scope_for_package_name(name).clone();

    let mut url_buf = PathBuffer::uninit();
    // TODO(port): std.fmt.bufPrint — `buf_print` returns the written slice
    let encoded_name = buf_print(
        url_buf.0.as_mut_slice(),
        format_args!("{}", bun_fmt::dependency_url(name)),
    );
    let mut path_buf = PathBuffer::uninit();
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
        &raw mut response_buf,
        b"",
        http_proxy,
        None,
        http::FetchRedirect::Follow,
    );
    req.client.flags.reject_unauthorized = manager.tls_reject_unauthorized();

    let res = match req.send_sync() {
        Ok(r) => r,
        Err(err) => {
            Output::err(err, "view request failed to send", ());
            Global::crash();
        }
    };

    if res.status_code >= 400 {
        npm::response_error::<false>(&req, &res, Some((name, version)), &mut response_buf)?;
    }

    let mut log = bun_ast::Log::init();
    let source = &bun_ast::Source::init_path_string(b"view.json", response_buf.list.as_slice());
    let json: ast::Expr = match JSON::parse_utf8(source, &mut log, &bump) {
        Ok(j) => j.into(),
        Err(err) => {
            Output::err(err, "failed to parse response body as JSON", ());
            Global::crash();
        }
    };
    if log.errors > 0 {
        log.print(std::ptr::from_mut(Output::error_writer()))?;
        Global::crash();
    }

    // Parse the existing JSON response into a PackageManifest using the now-public parse function
    let parsed_manifest = match PackageManifest::parse(
        &scope,
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

    // Now use the existing version resolution logic from outdated_command
    let mut manifest = json;

    let mut versions_len: usize = 1;

    // PORT NOTE: reshaped for borrowck — Zig used a labeled block returning a tuple to reassign (version, manifest)
    'brk: {
        'from_versions: {
            if let Some(versions_obj) = json.get_object(b"versions") {
                // Find the version string from JSON that matches the resolved version
                let versions_e_obj = versions_obj
                    .data
                    .e_object()
                    .expect("infallible: variant checked");
                let versions = versions_e_obj.properties.slice();
                versions_len = versions.len();

                let wanted_version: Semver::Version = 'brk2: {
                    // First try dist-tag lookup (like "latest", "beta", etc.)
                    if let Some(result) = parsed_manifest.find_by_dist_tag(version) {
                        break 'brk2 result.version;
                    } else {
                        // Parse as semver query and find best version - exactly like outdated_command.zig line 325
                        let sliced_literal = Semver::SlicedString::init(version, version);
                        let query = Semver::query::parse(version, sliced_literal)?;
                        // `defer query.deinit()` — handled by Drop
                        // Use the same pattern as outdated_command: findBestVersion(query.head, string_buf)
                        if let Some(result) =
                            parsed_manifest.find_best_version(&query, &parsed_manifest.string_buf)
                        {
                            break 'brk2 result.version;
                        }
                    }

                    break 'from_versions;
                };

                for prop in versions {
                    let Some(key) = prop.key.as_ref() else {
                        continue;
                    };
                    let Some(version_str) = key.as_string(&bump) else {
                        continue;
                    };
                    let sliced_version = Semver::SlicedString::init(version_str, version_str);
                    let parsed_version = Semver::Version::parse(sliced_version);
                    if parsed_version.valid && parsed_version.version.max().eql(wanted_version) {
                        version = version_str;
                        manifest = prop.value.expect("infallible: prop has value");
                        break 'brk;
                    }
                }
            }
        }

        if json_output {
            Output::print(format_args!(
                "{{ \"error\": \"No matching version found\", \"version\": {} }}\n",
                bun_fmt::format_json_string_utf8(
                    spec_,
                    bun_fmt::JSONFormatterUTF8Options { quote: true }
                ),
            ));
            Output::flush();
        } else {
            Output::err_generic(
                "No version of <b>{}<r> satisfying <b>{}<r> found",
                (bun_fmt::quote(name), bun_fmt::quote(version)),
            );

            let max_versions_to_display: usize = 5;

            let start_index = parsed_manifest
                .versions
                .len()
                .saturating_sub(max_versions_to_display);
            let mut versions_to_display = &parsed_manifest.versions[start_index..];
            versions_to_display =
                &versions_to_display[..versions_to_display.len().min(max_versions_to_display)];
            if !versions_to_display.is_empty() {
                Output::pretty_errorln("\nRecent versions:<r>");
                for v in versions_to_display {
                    Output::pretty_errorln(format_args!(
                        "<d>-<r> {}",
                        v.fmt(&parsed_manifest.string_buf)
                    ));
                }

                if start_index > 0 {
                    Output::pretty_errorln(format_args!("  <d>... and {} more<r>", start_index));
                }
            }
        }
        Global::exit(1);
    }

    // Treat versions specially because npm does some normalization on there.
    if let Some(versions_object) = json.get_object(b"versions") {
        let versions_e_obj = versions_object
            .data
            .e_object()
            .expect("infallible: variant checked");
        let props = versions_e_obj.properties.slice();
        let mut keys: Vec<ast::Expr> = Vec::with_capacity(props.len());
        debug_assert_eq!(props.len(), keys.capacity());
        for prop in props {
            keys.push(prop.key.expect("infallible: prop has key"));
        }
        let versions_array = ast::Expr::init(
            ast::E::Array {
                items: ast::ExprNodeList::from_owned_slice(keys.into_boxed_slice()),
                ..Default::default()
            },
            bun_ast::Loc { start: -1 },
        );
        manifest.set(&bump, b"versions", versions_array)?;
    }

    // Handle property lookup if specified
    if let Some(prop_path) = property_path {
        // This is similar to what npm does.
        // `bun pm view react version ` => 1.2.3
        // `bun pm view react versions` => ['1.2.3', '1.2.4', '1.2.5']
        if let Some(value) = manifest
            .get_path_may_be_index(&bump, prop_path)
            .or_else(|| json.get_path_may_be_index(&bump, prop_path))
        {
            if let bun_ast::ExprData::EString(e_string) = &value.data {
                // JSON parse_utf8 always produces UTF-8 strings, so the raw
                // `data` slice is the literal value.
                let slice = e_string.data.slice();
                if json_output {
                    Output::print(format_args!(
                        "{}\n",
                        bun_fmt::format_json_string_utf8(&slice, Default::default())
                    ));
                } else {
                    Output::print(format_args!("{}\n", BStr::new(&*slice)));
                }
                Output::flush();
                return Ok(());
            }

            let mut buffer_writer = JSPrinter::BufferWriter::init();
            buffer_writer.append_newline = true;
            let mut package_json_writer = JSPrinter::BufferPrinter::init(buffer_writer);
            let _ = JSPrinter::print_json(
                &mut package_json_writer,
                value,
                source,
                JSPrinter::PrintJsonOptions {
                    mangled_props: None,
                    ..Default::default()
                },
            )?;
            Output::print(format_args!(
                "{}",
                BStr::new(package_json_writer.ctx.get_written())
            ));
            Output::flush();
            Global::exit(0);
        } else {
            if json_output {
                Output::print(format_args!(
                    "{{ \"error\": \"Property not found\", \"version\": {}, \"property\": {} }}\n",
                    bun_fmt::format_json_string_utf8(
                        spec_,
                        bun_fmt::JSONFormatterUTF8Options { quote: true }
                    ),
                    bun_fmt::format_json_string_utf8(
                        prop_path,
                        bun_fmt::JSONFormatterUTF8Options { quote: true }
                    ),
                ));
                Output::flush();
            } else {
                Output::err_generic(
                    "Property <b>{}<r> not found",
                    format_args!("{}", BStr::new(prop_path)),
                );
            }
        }
        Global::exit(1);
    }

    if json_output {
        // Output formatted JSON using JSPrinter
        let mut buffer_writer = JSPrinter::BufferWriter::init();
        buffer_writer.append_newline = true;
        let mut package_json_writer = JSPrinter::BufferPrinter::init(buffer_writer);
        let _ = JSPrinter::print_json(
            &mut package_json_writer,
            manifest,
            source,
            JSPrinter::PrintJsonOptions {
                mangled_props: None,
                indent: bun_ast::Indentation {
                    count: 2,
                    ..Default::default()
                },
                ..Default::default()
            },
        )?;
        Output::print(format_args!(
            "{}",
            BStr::new(package_json_writer.ctx.get_written())
        ));
        Output::flush();
        return Ok(());
    }

    let pkg_name: &[u8] = manifest
        .get_string_cloned(&bump, b"name")
        .ok()
        .flatten()
        .unwrap_or(name);
    let pkg_version: &[u8] = manifest
        .get_string_cloned(&bump, b"version")
        .ok()
        .flatten()
        .unwrap_or(version);
    let license: &[u8] = manifest
        .get_string_cloned(&bump, b"license")
        .ok()
        .flatten()
        .unwrap_or(b"");
    let mut dep_count: usize = 0;
    let dependencies_object = manifest.get_object(b"dependencies");
    if let Some(deps) = &dependencies_object {
        dep_count = deps
            .data
            .e_object()
            .expect("infallible: variant checked")
            .properties
            .len_u32() as usize;
    }

    prettyln!(
        "<b><blue><u>{}<r><d>@<r><blue><b><u>{}<r> <d>|<r> <cyan>{}<r> <d>|<r> deps<d>:<r> {} <d>|<r> versions<d>:<r> {}",
        BStr::new(pkg_name),
        BStr::new(pkg_version),
        BStr::new(license),
        dep_count,
        versions_len,
    );

    // Get description and homepage from the top-level package manifest, not the version-specific one
    if let Some(desc) = json.get_string_cloned(&bump, b"description").ok().flatten() {
        prettyln!("{}", BStr::new(desc));
    }
    if let Some(hp) = json.get_string_cloned(&bump, b"homepage").ok().flatten() {
        prettyln!("<blue>{}<r>", BStr::new(hp));
    }

    if let Some(mut iter) = json.get_array(b"keywords") {
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
            prettyln!("<d>keywords:<r> {}", BStr::new(keywords.list.as_slice()));
        }
    }

    // Display dependencies if they exist
    if let Some(deps) = &dependencies_object {
        let deps_e_obj = deps.data.e_object().expect("infallible: variant checked");
        let dependencies = deps_e_obj.properties.slice();
        if !dependencies.is_empty() {
            prettyln!("\n<b>dependencies<r><d> ({}):<r>", dependencies.len());
        }

        for prop in dependencies {
            if prop.key.is_none() || prop.value.is_none() {
                continue;
            }
            let Some(dep_name) = prop
                .key
                .as_ref()
                .expect("infallible: prop has key")
                .as_string(&bump)
            else {
                continue;
            };
            let Some(dep_version) = prop
                .value
                .as_ref()
                .expect("infallible: prop has value")
                .as_string(&bump)
            else {
                continue;
            };
            prettyln!(
                "- <cyan>{}<r><d>:<r> {}",
                BStr::new(dep_name),
                BStr::new(dep_version),
            );
        }
    }

    if let Some(dist) = manifest.get_object(b"dist") {
        prettyln!("\n<d><r><b>dist<r>");
        if let Some(t) = dist.get_string_cloned(&bump, b"tarball").ok().flatten() {
            prettyln!(" <d>.<r>tarball<d>:<r> {}", BStr::new(t));
        }
        if let Some(s) = dist.get_string_cloned(&bump, b"shasum").ok().flatten() {
            prettyln!(" <d>.<r>shasum<r><d>:<r> <green>{}<r>", BStr::new(s));
        }
        if let Some(i) = dist.get_string_cloned(&bump, b"integrity").ok().flatten() {
            prettyln!(" <d>.<r>integrity<r><d>:<r> <green>{}<r>", BStr::new(i));
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
            if prop.key.is_none() || prop.value.is_none() {
                continue;
            }
            let tagname_expr = prop.key.as_ref().expect("infallible: prop has key");
            let val_expr = prop.value.as_ref().expect("infallible: prop has value");
            if let Some(tag) = tagname_expr.as_string(&bump) {
                if let Some(val) = val_expr.as_string(&bump) {
                    if tag == b"latest" {
                        prettyln!("<cyan>{}<r><d>:<r> {}", BStr::new(tag), BStr::new(val));
                    } else if tag == b"beta" {
                        prettyln!("<blue>{}<r><d>:<r> {}", BStr::new(tag), BStr::new(val));
                    } else {
                        prettyln!("<magenta>{}<r><d>:<r> {}", BStr::new(tag), BStr::new(val));
                    }
                }
            }
        }
    }

    if let Some(mut iter) = json.get_array(b"maintainers") {
        prettyln!("\nmaintainers<r><d>:<r>");
        while let Some(m) = iter.next() {
            let nm: &[u8] = m
                .get_string_cloned(&bump, b"name")
                .ok()
                .flatten()
                .unwrap_or(b"");
            let em: &[u8] = m
                .get_string_cloned(&bump, b"email")
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

    // Add published date information
    if let Some(time_obj) = json.get_object(b"time") {
        // TODO: use a relative time formatter
        if let Some(published_time) = time_obj
            .get_string_cloned(&bump, pkg_version)
            .ok()
            .flatten()
        {
            prettyln!("\n<b>Published<r><d>:<r> {}", BStr::new(published_time));
        } else if let Some(modified_time) = time_obj
            .get_string_cloned(&bump, b"modified")
            .ok()
            .flatten()
        {
            prettyln!("\n<b>Published<r><d>:<r> {}", BStr::new(modified_time));
        }
    }

    Ok(())
}

// ported from: src/cli/pm_view_command.zig
