use bun_core::{Global, Output};
use bun_core::fmt as bun_fmt;
use bun_http as http;
use bun_install::install::PackageManager;
use bun_install::npm::{self, PackageManifest};
use bun_install::Dependency;
use bun_json as JSON;
use bun_logger as logger;
use bun_paths::PathBuffer;
use bun_semver as Semver;
use bun_str::strings;
use bun_str::MutableString;
use bun_sys::File;
use bun_url::URL;
use bun_js_parser as ast;
use bun_js_parser::js_printer as JSPrinter;
use bstr::BStr;

pub fn view(
    manager: &mut PackageManager,
    spec_: &[u8],
    property_path: Option<&[u8]>,
    json_output: bool,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let (name, mut version) = Dependency::split_name_and_version_or_latest('brk: {
        // Extremely best effort.
        if spec_ == b"." || spec_ == b"" {
            if strings::is_npm_package_name(manager.root_package_json_name_at_time_of_init.as_slice()) {
                break 'brk manager.root_package_json_name_at_time_of_init.as_slice();
            }

            // Try our best to get the package.json name they meant
            'from_package_json: {
                if manager.root_dir.has_comptime_query(b"package.json") {
                    if manager.root_dir.fd.is_valid() {
                        match File::read_from(manager.root_dir.fd, b"package.json") {
                            bun_sys::Result::Err(_) => {}
                            bun_sys::Result::Ok(str_) => {
                                let source = &logger::Source::init_path_string(b"package.json", &str_);
                                let mut log = logger::Log::init();
                                let Ok(json) = JSON::parse(source, &mut log, false) else {
                                    break 'from_package_json;
                                };
                                if let Some(name) = json.get_string_cloned(b"name").ok().flatten() {
                                    if !name.is_empty() {
                                        // TODO(port): lifetime — Zig leaks `name` for the duration of this fn; Box::leak matches behavior
                                        break 'brk Box::leak(name);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            break 'brk bun_paths::basename(bun_fs::FileSystem::instance().top_level_dir.as_slice());
        }

        break 'brk spec_;
    });

    let scope = manager.scope_for_package_name(name);

    let mut url_buf = PathBuffer::uninit();
    // TODO(port): std.fmt.bufPrint — `buf_print` returns the written slice
    let encoded_name = bun_core::fmt::buf_print(
        url_buf.as_mut_slice(),
        format_args!("{}", bun_fmt::dependency_url(name)),
    )?;
    let mut path_buf = PathBuffer::uninit();
    // Always fetch the full registry manifest, not a specific version
    let url = URL::parse(bun_core::fmt::buf_print(
        path_buf.as_mut_slice(),
        format_args!(
            "{}/{}",
            BStr::new(strings::without_trailing_slash(scope.url.href.as_slice())),
            BStr::new(encoded_name),
        ),
    )?);

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
        headers.append_fmt(b"Authorization", format_args!("Bearer {}", BStr::new(scope.token.as_slice())));
    } else if !scope.auth.is_empty() {
        headers.append_fmt(b"Authorization", format_args!("Basic {}", BStr::new(scope.auth.as_slice())));
    }

    let mut response_buf = MutableString::init(2048)?;
    let mut req = http::AsyncHTTP::init_sync(
        http::Method::GET,
        url,
        headers.entries,
        // TODO(port): headers.content.ptr.?[0..headers.content.len] — verify HeaderBuilder.content slice accessor
        headers.content.as_slice(),
        &mut response_buf,
        b"",
        manager.http_proxy(url),
        None,
        http::Redirect::Follow,
    );
    req.client.flags.reject_unauthorized = manager.tls_reject_unauthorized();

    let res = match req.send_sync() {
        Ok(r) => r,
        Err(err) => {
            Output::err(err, "view request failed to send", format_args!(""));
            Global::crash();
        }
    };

    if res.status_code >= 400 {
        npm::response_error(&req, &res, (name, version), &response_buf, false)?;
    }

    let mut log = logger::Log::init();
    let source = &logger::Source::init_path_string(b"view.json", response_buf.list.as_slice());
    let json = match JSON::parse_utf8(source, &mut log) {
        Ok(j) => j,
        Err(err) => {
            Output::err(err, "failed to parse response body as JSON", format_args!(""));
            Global::crash();
        }
    };
    if log.errors > 0 {
        log.print(Output::error_writer())?;
        Global::crash();
    }

    // Parse the existing JSON response into a PackageManifest using the now-public parse function
    let parsed_manifest = match PackageManifest::parse(
        scope,
        &mut log,
        response_buf.list.as_slice(),
        name,
        b"", // last_modified (not needed for view)
        b"", // etag (not needed for view)
        0,   // public_max_age (not needed for view)
        true, // is_extended_manifest (view uses application/json Accept header)
    ) {
        Ok(Some(m)) => m,
        Ok(None) => {
            Output::err_generic("failed to parse package manifest", format_args!(""));
            Global::crash();
        }
        Err(err) => {
            Output::err(err, "failed to parse package manifest", format_args!(""));
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
                let versions = versions_obj.data.e_object().properties.slice();
                versions_len = versions.len();

                let wanted_version: Semver::Version = 'brk2: {
                    // First try dist-tag lookup (like "latest", "beta", etc.)
                    if let Some(result) = parsed_manifest.find_by_dist_tag(version) {
                        break 'brk2 result.version;
                    } else {
                        // Parse as semver query and find best version - exactly like outdated_command.zig line 325
                        let sliced_literal = Semver::SlicedString::init(version, version);
                        let query = Semver::Query::parse(version, sliced_literal)?;
                        // `defer query.deinit()` — handled by Drop
                        // Use the same pattern as outdated_command: findBestVersion(query.head, string_buf)
                        if let Some(result) = parsed_manifest.find_best_version(&query, parsed_manifest.string_buf.as_slice()) {
                            break 'brk2 result.version;
                        }
                    }

                    break 'from_versions;
                };

                for prop in versions {
                    let Some(key) = prop.key.as_ref() else { continue };
                    let Some(version_str) = key.as_string() else { continue };
                    let sliced_version = Semver::SlicedString::init(version_str, version_str);
                    let parsed_version = Semver::Version::parse(sliced_version);
                    if parsed_version.valid && parsed_version.version.max().eql(&wanted_version) {
                        version = version_str;
                        manifest = prop.value.unwrap();
                        break 'brk;
                    }
                }
            }
        }

        if json_output {
            Output::print(format_args!(
                "{{ \"error\": \"No matching version found\", \"version\": {} }}\n",
                bun_fmt::format_json_string_utf8(spec_, bun_fmt::JsonStringOptions { quote: true }),
            ));
            Output::flush();
        } else {
            Output::err_generic(
                "No version of <b>{}<r> satisfying <b>{}<r> found",
                format_args!("{} {}", bun_fmt::quote(name), bun_fmt::quote(version)),
            );
            // TODO(port): Output::err_generic format string interpolation — verify API shape

            let max_versions_to_display: usize = 5;

            let start_index = parsed_manifest.versions.len().saturating_sub(max_versions_to_display);
            let mut versions_to_display = &parsed_manifest.versions[start_index..];
            versions_to_display = &versions_to_display[..versions_to_display.len().min(max_versions_to_display)];
            if !versions_to_display.is_empty() {
                Output::pretty_errorln("\nRecent versions:<r>", format_args!(""));
                for v in versions_to_display {
                    Output::pretty_errorln("<d>-<r> {}", format_args!("{}", v.fmt(parsed_manifest.string_buf.as_slice())));
                }

                if start_index > 0 {
                    Output::pretty_errorln("  <d>... and {} more<r>", format_args!("{}", start_index));
                }
            }
        }
        Global::exit(1);
    }

    // Treat versions specially because npm does some normalization on there.
    if let Some(versions_object) = json.get_object(b"versions") {
        let props = versions_object.data.e_object().properties.slice();
        let mut keys: Vec<ast::Expr> = Vec::with_capacity(props.len());
        debug_assert_eq!(props.len(), keys.capacity());
        for prop in props {
            keys.push(prop.key.unwrap());
        }
        let versions_array = ast::Expr::init(
            ast::E::Array(ast::EArray {
                items: ast::ExprNodeList::from_owned_slice(keys.into_boxed_slice()),
                ..Default::default()
            }),
            ast::Loc { start: -1 },
        );
        manifest.set(b"versions", versions_array)?;
    }

    // Handle property lookup if specified
    if let Some(prop_path) = property_path {
        // This is similar to what npm does.
        // `bun pm view react version ` => 1.2.3
        // `bun pm view react versions` => ['1.2.3', '1.2.4', '1.2.5']
        if let Some(value) = manifest.get_path_may_be_index(prop_path).or_else(|| json.get_path_may_be_index(prop_path)) {
            if let ast::ExprData::EString(e_string) = &value.data {
                let slice = e_string.slice();
                if json_output {
                    Output::println(format_args!("{}", bun_fmt::format_json_string_utf8(slice, Default::default())));
                } else {
                    Output::println(format_args!("{}", BStr::new(slice)));
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
                JSPrinter::Options {
                    mangled_props: None,
                    ..Default::default()
                },
            )?;
            Output::print(format_args!("{}", BStr::new(package_json_writer.ctx.get_written())));
            Output::flush();
            Global::exit(0);
        } else {
            if json_output {
                Output::print(format_args!(
                    "{{ \"error\": \"Property not found\", \"version\": {}, \"property\": {} }}\n",
                    bun_fmt::format_json_string_utf8(spec_, bun_fmt::JsonStringOptions { quote: true }),
                    bun_fmt::format_json_string_utf8(prop_path, bun_fmt::JsonStringOptions { quote: true }),
                ));
                Output::flush();
            } else {
                Output::err_generic("Property <b>{}<r> not found", format_args!("{}", BStr::new(prop_path)));
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
            JSPrinter::Options {
                mangled_props: None,
                indent: JSPrinter::Indent { count: 2, ..Default::default() },
                ..Default::default()
            },
        )?;
        Output::print(format_args!("{}", BStr::new(package_json_writer.ctx.get_written())));
        Output::flush();
        return Ok(());
    }

    let pkg_name = manifest.get_string_cloned(b"name").ok().flatten().unwrap_or_else(|| Box::from(name));
    let pkg_version = manifest.get_string_cloned(b"version").ok().flatten().unwrap_or_else(|| Box::from(version));
    let license = manifest.get_string_cloned(b"license").ok().flatten().unwrap_or_default();
    let mut dep_count: usize = 0;
    let dependencies_object = manifest.get_object(b"dependencies");
    if let Some(deps) = &dependencies_object {
        dep_count = deps.data.e_object().properties.len();
    }

    Output::prettyln(
        "<b><blue><u>{}<r><d>@<r><blue><b><u>{}<r> <d>|<r> <cyan>{}<r> <d>|<r> deps<d>:<r> {} <d>|<r> versions<d>:<r> {}",
        format_args!(
            "{} {} {} {} {}",
            BStr::new(&pkg_name),
            BStr::new(&pkg_version),
            BStr::new(&license),
            dep_count,
            versions_len,
        ),
    );
    // TODO(port): Output::prettyln — verify Rust API for color-tag template + format_args (Zig passes fmt str + tuple)

    // Get description and homepage from the top-level package manifest, not the version-specific one
    if let Some(desc) = json.get_string_cloned(b"description").ok().flatten() {
        Output::prettyln("{}", format_args!("{}", BStr::new(&desc)));
    }
    if let Some(hp) = json.get_string_cloned(b"homepage").ok().flatten() {
        Output::prettyln("<blue>{}<r>", format_args!("{}", BStr::new(&hp)));
    }

    if let Some(arr) = json.get_array(b"keywords") {
        let mut keywords = MutableString::init(64)?;
        let mut iter = arr;
        let mut first = true;
        while let Some(kw_expr) = iter.next() {
            if let Some(kw) = kw_expr.as_string() {
                if !first {
                    keywords.append_slice(b", ")?;
                } else {
                    first = false;
                }
                keywords.append_slice(kw)?;
            }
        }
        if !keywords.list.is_empty() {
            Output::prettyln("<d>keywords:<r> {}", format_args!("{}", BStr::new(keywords.list.as_slice())));
        }
    }

    // Display dependencies if they exist
    if let Some(deps) = &dependencies_object {
        let dependencies = deps.data.e_object().properties.slice();
        if !dependencies.is_empty() {
            Output::prettyln("\n<b>dependencies<r><d> ({}):<r>", format_args!("{}", dependencies.len()));
        }

        for prop in dependencies {
            if prop.key.is_none() || prop.value.is_none() {
                continue;
            }
            let Some(dep_name) = prop.key.as_ref().unwrap().as_string() else { continue };
            let Some(dep_version) = prop.value.as_ref().unwrap().as_string() else { continue };
            Output::prettyln(
                "- <cyan>{}<r><d>:<r> {}",
                format_args!("{} {}", BStr::new(dep_name), BStr::new(dep_version)),
            );
        }
    }

    if let Some(dist) = manifest.get_object(b"dist") {
        Output::prettyln("\n<d><r><b>dist<r>", format_args!(""));
        if let Some(t) = dist.get_string_cloned(b"tarball").ok().flatten() {
            Output::prettyln(" <d>.<r>tarball<d>:<r> {}", format_args!("{}", BStr::new(&t)));
        }
        if let Some(s) = dist.get_string_cloned(b"shasum").ok().flatten() {
            Output::prettyln(" <d>.<r>shasum<r><d>:<r> <green>{}<r>", format_args!("{}", BStr::new(&s)));
        }
        if let Some(i) = dist.get_string_cloned(b"integrity").ok().flatten() {
            Output::prettyln(" <d>.<r>integrity<r><d>:<r> <green>{}<r>", format_args!("{}", BStr::new(&i)));
        }
        if let Some(u) = dist.get_number(b"unpackedSize") {
            // TODO(port): Zig `getNumber` returns indexable (u[0]); verify Rust return type
            Output::prettyln(
                " <d>.<r>unpackedSize<r><d>:<r> <blue>{}<r>",
                format_args!("{}", bun_fmt::size(u[0] as u64, Default::default())),
            );
        }
    }

    if let Some(tags_obj) = json.get_object(b"dist-tags") {
        Output::prettyln("\n<b>dist-tags<r><d>:<r>", format_args!(""));
        for prop in tags_obj.data.e_object().properties.slice() {
            if prop.key.is_none() || prop.value.is_none() {
                continue;
            }
            let tagname_expr = prop.key.as_ref().unwrap();
            let val_expr = prop.value.as_ref().unwrap();
            if let Some(tag) = tagname_expr.as_string() {
                if let Some(val) = val_expr.as_string() {
                    if tag == b"latest" {
                        Output::prettyln("<cyan>{}<r><d>:<r> {}", format_args!("{} {}", BStr::new(tag), BStr::new(val)));
                    } else if tag == b"beta" {
                        Output::prettyln("<blue>{}<r><d>:<r> {}", format_args!("{} {}", BStr::new(tag), BStr::new(val)));
                    } else {
                        Output::prettyln("<magenta>{}<r><d>:<r> {}", format_args!("{} {}", BStr::new(tag), BStr::new(val)));
                    }
                }
            }
        }
    }

    if let Some(maint_iter) = json.get_array(b"maintainers") {
        Output::prettyln("\nmaintainers<r><d>:<r>", format_args!(""));
        let mut iter = maint_iter;
        while let Some(m) = iter.next() {
            let nm = m.get_string_cloned(b"name").ok().flatten().unwrap_or_default();
            let em = m.get_string_cloned(b"email").ok().flatten().unwrap_or_default();
            if !em.is_empty() {
                Output::prettyln("<d>-<r> {} <d>\\<{}\\><r>", format_args!("{} {}", BStr::new(&nm), BStr::new(&em)));
            } else if !nm.is_empty() {
                Output::prettyln("<d>-<r> {}", format_args!("{}", BStr::new(&nm)));
            }
        }
    }

    // Add published date information
    if let Some(time_obj) = json.get_object(b"time") {
        // TODO: use a relative time formatter
        if let Some(published_time) = time_obj.get_string_cloned(&pkg_version).ok().flatten() {
            Output::prettyln("\n<b>Published<r><d>:<r> {}", format_args!("{}", BStr::new(&published_time)));
        } else if let Some(modified_time) = time_obj.get_string_cloned(b"modified").ok().flatten() {
            Output::prettyln("\n<b>Published<r><d>:<r> {}", format_args!("{}", BStr::new(&modified_time)));
        }
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/pm_view_command.zig (410 lines)
//   confidence: medium
//   todos:      6
//   notes:      Output::prettyln/err_generic API shape (color-tag template + args) needs Phase B decision; bufPrint helper assumed in bun_core::fmt; AST Expr accessors (.data.e_object(), get_string_cloned) and getNumber return type need verification.
// ──────────────────────────────────────────────────────────────────────────
