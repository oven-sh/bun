use bstr::BStr;
use std::io::Write as _;

use bun_collections::StringHashMap;
use bun_core::{Global, Output};
use bun_http::{self as http, HeaderBuilder};
use bun_install::package_manager::command_line_arguments::AuditLevel;
use bun_install::PackageManager;
use bun_interchange::json as bun_json;
use bun_libdeflate_sys::libdeflate;
use bun_logger as logger;
use bun_logger::js_ast::{Expr, ExprData};
use bun_str::{strings, MutableString};
use bun_url::URL;

use crate::cli::Command;

// TODO(port): in Zig these `[]const u8` fields borrow from the JSON parse arena (and a few are
// `allocator.dupe`d). Phase A boxes them to avoid a struct lifetime param; revisit in Phase B if
// the extra clones show up in profiling.
struct VulnerabilityInfo {
    severity: Box<[u8]>,
    title: Box<[u8]>,
    url: Box<[u8]>,
    vulnerable_versions: Box<[u8]>,
    id: Box<[u8]>,
    package_name: Box<[u8]>,
}

#[derive(Default)]
struct PackageInfo {
    package_id: u32,
    name: Box<[u8]>,
    version: Box<[u8]>,
    vulnerabilities: Vec<VulnerabilityInfo>,
    dependents: Vec<DependencyPath>,
}

// In Zig this is `PackageInfo.DependencyPath`; hoisted because Rust has no nested struct types.
struct DependencyPath {
    path: Vec<Box<[u8]>>,
    is_direct: bool,
}

struct AuditResult {
    vulnerable_packages: StringHashMap<PackageInfo>,
    all_vulnerabilities: Vec<VulnerabilityInfo>,
}

impl AuditResult {
    pub fn init() -> AuditResult {
        AuditResult {
            vulnerable_packages: StringHashMap::new(),
            all_vulnerabilities: Vec::new(),
        }
    }
}

// `deinit` body only freed owned fields → Drop is automatic on `StringHashMap`/`Vec`/`Box`.

pub struct AuditCommand;

impl AuditCommand {
    // TODO(port): `!noreturn` → `Result<Infallible, _>` so callers can `?`; all Ok paths Global::exit.
    pub fn exec(ctx: Command::Context) -> Result<core::convert::Infallible, bun_core::Error> {
        let _ = ctx;
        // Body depends on `bun_install::CommandLineArguments::parse`,
        // `bun_install::Subcommand::Audit`, `bun_install::PackageManager::init`,
        // and `PackageManager.options.json_output` — all gated behind the
        // upstream `package_manager_real` un-gate (reconciler-6).
        todo!("blocked_on: bun_install::PackageManager::init / bun_install::Subcommand::Audit")
    }

    /// Returns the exit code of the command. 0 if no vulnerabilities were found, 1 if vulnerabilities were found.
    /// The exception is when you pass --json, it will simply return 0 as that was considered a successful "request
    /// for the audit information"
    pub fn audit(
        ctx: Command::Context,
        pm: &mut PackageManager,
        json_output: bool,
        audit_level: Option<AuditLevel>,
        audit_prod_only: bool,
        ignore_list: &[&[u8]],
    ) -> Result<u32, bun_alloc::AllocError> {
        // TODO(port): comptime `Output.prettyFmt(..., true)` pre-expands ANSI tags at compile time.
        Output::pretty_error(format_args!(
            "<r><b>bun audit <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        ));
        Output::flush();

        // TODO(port): blocked_on bun_install::PackageManager::lockfile (stub gated).
        // let load_lockfile = pm.lockfile.load_from_cwd(pm, ctx.log, true);
        // PackageManagerCommand::handle_load_lockfile_errors(&load_lockfile, pm);
        let _ = ctx;

        let dependency_tree = build_dependency_tree(pm)?;

        let packages_result = collect_packages_for_audit(pm, audit_prod_only)?;

        let response_text = send_audit_request(pm, &packages_result.audit_body)?;

        if json_output {
            let _ = Output::writer().write_all(&response_text);
            let _ = Output::writer().write_all(b"\n");

            if !response_text.is_empty() {
                let source =
                    logger::Source::init_path_string(b"audit-response.json", &response_text[..]);
                let mut log = logger::Log::init();
                let bump = bun_alloc::Arena::new();

                let expr = match bun_json::parse::<true>(&source, &mut log, &bump) {
                    Ok(e) => e,
                    Err(_) => {
                        Output::pretty_errorln(format_args!(
                            "<red>error<r>: audit request failed to parse json. Is the registry down?"
                        ));
                        return Ok(1); // If we can't parse then safe to assume a similar failure
                    }
                };

                // If the response is an empty object, no vulnerabilities
                if let ExprData::EObject(obj) = &expr.data {
                    if obj.properties.len == 0 {
                        return Ok(0);
                    }
                }

                // If there's any content in the response, there are vulnerabilities
                return Ok(1);
            }

            return Ok(0);
        } else if !response_text.is_empty() {
            let exit_code = print_enhanced_audit_report(
                &response_text,
                pm,
                &dependency_tree,
                audit_level,
                ignore_list,
            )?;

            print_skipped_packages(&packages_result.skipped_packages);

            return Ok(exit_code);
        } else {
            Output::prettyln(format_args!("<green>No vulnerabilities found<r>"));

            print_skipped_packages(&packages_result.skipped_packages);

            return Ok(0);
        }
    }
}

fn print_skipped_packages(skipped_packages: &Vec<Box<[u8]>>) {
    if !skipped_packages.is_empty() {
        Output::pretty(format_args!("<d>Skipped<r> "));
        for (i, package_name) in skipped_packages.iter().enumerate() {
            if i > 0 {
                Output::pretty(format_args!(", "));
            }
            Output::pretty(format_args!("{}", BStr::new(package_name)));
        }

        if skipped_packages.len() > 1 {
            Output::prettyln(format_args!(
                " <d>because they do not come from the default registry<r>"
            ));
        } else {
            Output::prettyln(format_args!(
                " <d>because it does not come from the default registry<r>"
            ));
        }

        Output::prettyln(format_args!(""));
    }
}

fn build_dependency_tree(
    pm: &mut PackageManager,
) -> Result<StringHashMap<Vec<Box<[u8]>>>, bun_alloc::AllocError> {
    let _ = pm;
    // Body iterates `pm.lockfile.packages` / `pm.lockfile.buffers` and
    // `Resolution::Tag` columns — all gated behind the upstream
    // `bun_install::PackageManager::lockfile` field (reconciler-6).
    todo!("blocked_on: bun_install::PackageManager::lockfile")
}

fn build_production_package_set(
    pm: &mut PackageManager,
    prod_set: &mut StringHashMap<()>,
) -> Result<(), bun_alloc::AllocError> {
    let _ = (pm, prod_set);
    // Body walks `pm.lockfile.packages` / `pm.root_package_id` /
    // `pm.workspace_name_hash` — gated behind upstream PackageManager stub.
    todo!("blocked_on: bun_install::PackageManager::lockfile")
}

struct CollectPackagesResult {
    audit_body: Box<[u8]>,
    skipped_packages: Vec<Box<[u8]>>,
}

struct PackageVersions {
    name: Box<[u8]>,
    versions: Vec<Box<[u8]>>,
}

#[allow(unreachable_code, unused)]
fn collect_packages_for_audit(
    pm: &mut PackageManager,
    prod_only: bool,
) -> Result<CollectPackagesResult, bun_alloc::AllocError> {
    // Body iterates `pm.lockfile.packages` / `pm.root_package_id` /
    // `pm.workspace_name_hash` and per-package resolution tags — all gated
    // behind the upstream PackageManager stub (reconciler-6).
    let packages_list: Vec<PackageVersions> =
        todo!("blocked_on: bun_install::PackageManager::lockfile");
    let _ = (pm, prod_only, build_production_package_set as fn(_, _) -> _);
    let skipped_packages: Vec<Box<[u8]>> = Vec::new();

    // PERF(port): Zig used MutableString with initial capacity 1024.
    let mut body: Vec<u8> = Vec::with_capacity(1024);
    body.push(b'{');

    for (pkg_idx, package) in packages_list.iter().enumerate() {
        if pkg_idx > 0 {
            body.push(b',');
        }
        body.push(b'"');
        body.extend_from_slice(&package.name);
        body.push(b'"');
        body.push(b':');
        body.push(b'[');
        for (ver_idx, version) in package.versions.iter().enumerate() {
            if ver_idx > 0 {
                body.push(b',');
            }
            body.push(b'"');
            body.extend_from_slice(version);
            body.push(b'"');
        }
        body.push(b']');
    }
    body.push(b'}');

    Ok(CollectPackagesResult {
        audit_body: body.into_boxed_slice(),
        skipped_packages,
    })
}

fn send_audit_request(
    pm: &mut PackageManager,
    body: &[u8],
) -> Result<Box<[u8]>, bun_alloc::AllocError> {
    libdeflate::load();
    let compressor_ptr = libdeflate::Compressor::alloc(6);
    if compressor_ptr.is_null() {
        return Err(bun_alloc::AllocError);
    }
    // SAFETY: non-null checked above; libdeflate hands back a heap-allocated
    // compressor that lives until `deinit` (Zig: `*Compressor`).
    let compressor = unsafe { &mut *compressor_ptr };

    let max_compressed_size = compressor.max_bytes_needed(body, libdeflate::Encoding::Gzip);
    let mut compressed_body = vec![0u8; max_compressed_size];

    let compression_result = compressor.gzip(body, &mut compressed_body);
    compressed_body.truncate(compression_result.written);
    // PORT NOTE: AsyncHTTP::init_sync wants `&'static [u8]` (Zig had no
    // lifetimes). Leak the request body — single-shot CLI, freed at exit.
    let final_compressed_body: &'static [u8] = Box::leak(compressed_body.into_boxed_slice());

    let mut headers = HeaderBuilder::default();
    headers.count(b"accept", b"application/json");
    headers.count(b"content-type", b"application/json");
    headers.count(b"content-encoding", b"gzip");
    if !pm.options.scope.token.is_empty() {
        headers.count(b"authorization", b"");
        headers.content.cap += b"Bearer ".len() + pm.options.scope.token.len();
    } else if !pm.options.scope.auth.is_empty() {
        headers.count(b"authorization", b"");
        headers.content.cap += b"Basic ".len() + pm.options.scope.auth.len();
    }
    headers.allocate()?;
    headers.append(b"accept", b"application/json");
    headers.append(b"content-type", b"application/json");
    headers.append(b"content-encoding", b"gzip");
    if !pm.options.scope.token.is_empty() {
        headers.append_fmt(
            b"authorization",
            format_args!("Bearer {}", BStr::new(&pm.options.scope.token)),
        );
    } else if !pm.options.scope.auth.is_empty() {
        headers.append_fmt(
            b"authorization",
            format_args!("Basic {}", BStr::new(&pm.options.scope.auth)),
        );
    }

    let mut url_str: Vec<u8> = Vec::new();
    write!(
        &mut url_str,
        "{}/-/npm/v1/security/advisories/bulk",
        BStr::new(strings::without_trailing_slash(&pm.options.scope.url.href))
    )
    .expect("unreachable");
    // PORT NOTE: leak to satisfy `URL<'static>` (Zig had no lifetimes).
    let url_str: &'static [u8] = Box::leak(url_str.into_boxed_slice());
    let url = URL::parse(url_str);

    // TODO(port): blocked_on bun_install::PackageManager::env (stub gated).
    // let http_proxy = pm.env.get_http_proxy_for(&url);
    let http_proxy: Option<URL<'static>> = None;

    // PORT NOTE: Zig passed `headers.content.ptr.?[0..headers.content.len]`.
    // SAFETY: `allocate()` succeeded above so `ptr` is non-null when `len > 0`;
    // the buffer outlives the synchronous request.
    let headers_buf: &'static [u8] = match headers.content.ptr {
        Some(p) => unsafe { core::slice::from_raw_parts(p.as_ptr(), headers.content.len) },
        None => &[],
    };

    // PERF(port): Zig used MutableString with initial capacity 1024.
    let response_buf: &mut MutableString = Box::leak(Box::new(MutableString::init(1024)?));
    let mut req = http::AsyncHTTP::init_sync(
        http::Method::POST,
        url,
        headers.entries,
        headers_buf,
        response_buf as *mut MutableString,
        final_compressed_body,
        http_proxy,
        None,
        http::FetchRedirect::Follow,
    );
    let res = match req.send_sync() {
        Ok(r) => r,
        Err(err) => {
            Output::err(err, "audit request failed", ());
            Global::crash();
        }
    };

    if res.status_code >= 400 {
        Output::pretty_errorln(format_args!(
            "<red>error<r>: audit request failed (status {})",
            res.status_code
        ));
        Global::crash();
    }

    Ok(Box::<[u8]>::from(response_buf.list.as_slice()))
}

fn parse_vulnerability(
    package_name: &[u8],
    vuln: &Expr,
) -> Result<VulnerabilityInfo, bun_alloc::AllocError> {
    let mut vulnerability = VulnerabilityInfo {
        severity: Box::<[u8]>::from(b"moderate" as &[u8]),
        title: Box::<[u8]>::from(b"Vulnerability found" as &[u8]),
        url: Box::default(),
        vulnerable_versions: Box::default(),
        id: Box::default(),
        package_name: Box::<[u8]>::from(package_name),
    };

    if let ExprData::EObject(obj) = &vuln.data {
        let props = obj.properties.slice();
        for prop in props {
            if let Some(key) = &prop.key {
                if let ExprData::EString(key_str) = &key.data {
                    let field_name: &[u8] = key_str.data;
                    if let Some(value) = &prop.value {
                        if let ExprData::EString(val_str) = &value.data {
                            let field_value: &[u8] = val_str.data;
                            if field_name == b"severity" {
                                vulnerability.severity = Box::<[u8]>::from(field_value);
                            } else if field_name == b"title" {
                                vulnerability.title = Box::<[u8]>::from(field_value);
                            } else if field_name == b"url" {
                                vulnerability.url = Box::<[u8]>::from(field_value);
                            } else if field_name == b"vulnerable_versions" {
                                vulnerability.vulnerable_versions = Box::<[u8]>::from(field_value);
                            } else if field_name == b"id" {
                                vulnerability.id = Box::<[u8]>::from(field_value);
                            }
                        } else if let ExprData::ENumber(num) = &value.data {
                            if field_name == b"id" {
                                let mut s: Vec<u8> = Vec::new();
                                write!(&mut s, "{}", num.value as u64).expect("unreachable");
                                vulnerability.id = s.into_boxed_slice();
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(vulnerability)
}

fn find_dependency_paths(
    target_package: &[u8],
    dependency_tree: &StringHashMap<Vec<Box<[u8]>>>,
    pm: &mut PackageManager,
) -> Result<Vec<DependencyPath>, bun_alloc::AllocError> {
    let mut paths: Vec<DependencyPath> = Vec::new();

    let packages = pm.lockfile.packages.slice();
    let root_id = pm.root_package_id.get(&pm.lockfile, pm.workspace_name_hash);
    let root_deps = packages.items_dependencies()[root_id as usize];
    let dependencies = pm.lockfile.buffers.dependencies.as_slice();
    let buf = pm.lockfile.buffers.string_bytes.as_slice();
    let pkg_names = packages.items_name();
    let pkg_resolutions = packages.items_resolution();
    let pkg_deps = packages.items_dependencies();

    let dep_slice = root_deps.get(dependencies);
    for dependency in dep_slice {
        let dep_name = dependency.name.slice(buf);
        if dep_name == target_package {
            let mut direct_path = DependencyPath {
                path: Vec::new(),
                is_direct: true,
            };
            direct_path.path.push(Box::<[u8]>::from(target_package));
            paths.push(direct_path);
            break;
        }
    }

    debug_assert_eq!(pkg_resolutions.len(), pkg_deps.len());
    debug_assert_eq!(pkg_resolutions.len(), pkg_names.len());
    for ((resolution, workspace_deps), pkg_name) in
        pkg_resolutions.iter().zip(pkg_deps).zip(pkg_names)
    {
        if resolution.tag != bun_install::Resolution::Tag::Workspace {
            continue;
        }

        let workspace_name = pkg_name.slice(buf);
        let workspace_dep_slice = workspace_deps.get(dependencies);

        for dependency in workspace_dep_slice {
            let dep_name = dependency.name.slice(buf);
            if dep_name == target_package {
                let mut workspace_path = DependencyPath {
                    path: Vec::new(),
                    is_direct: false,
                };

                let mut workspace_prefix: Vec<u8> = Vec::new();
                write!(&mut workspace_prefix, "workspace:{}", BStr::new(workspace_name))
                    .expect("unreachable");
                workspace_path.path.push(workspace_prefix.into_boxed_slice());
                workspace_path.path.push(Box::<[u8]>::from(target_package));
                paths.push(workspace_path);
                break;
            }
        }
    }

    // TODO(port): bun.LinearFifo([]const u8, .Dynamic) → VecDeque<Box<[u8]>>; Zig stored borrowed
    // slices, but the lifetime crosses map insertions — boxed here for safety.
    let mut queue: VecDeque<Box<[u8]>> = VecDeque::new();
    let mut visited: StringHashMap<()> = StringHashMap::new();
    let mut parent_map: StringHashMap<Box<[u8]>> = StringHashMap::new();

    if let Some(dependents) = dependency_tree.get(target_package) {
        for dependent in dependents {
            queue.push_back(dependent.clone());
            parent_map.put(dependent.as_ref(), Box::<[u8]>::from(target_package))?;
        }
    }

    while let Some(current) = queue.pop_front() {
        if visited.contains(&current) {
            continue;
        }
        visited.put(&current, ())?;

        let mut is_root_dep = false;
        for dependency in dep_slice {
            let dep_name = dependency.name.slice(buf);
            if strings::eql(dep_name, &current) {
                is_root_dep = true;
                break;
            }
        }

        let mut workspace_name_for_dep: Option<&[u8]> = None;
        for ((resolution, workspace_deps), pkg_name) in
            pkg_resolutions.iter().zip(pkg_deps).zip(pkg_names)
        {
            if resolution.tag != bun_install::Resolution::Tag::Workspace {
                continue;
            }

            let workspace_dep_slice = workspace_deps.get(dependencies);
            for dependency in workspace_dep_slice {
                let dep_name = dependency.name.slice(buf);
                if strings::eql(dep_name, &current) {
                    workspace_name_for_dep = Some(pkg_name.slice(buf));
                    break;
                }
            }
            if workspace_name_for_dep.is_some() {
                break;
            }
        }

        if is_root_dep || workspace_name_for_dep.is_some() {
            let mut path = DependencyPath {
                path: Vec::new(),
                is_direct: false,
            };

            let mut trace: Box<[u8]> = current.clone();
            let mut seen_in_trace: StringHashMap<()> = StringHashMap::new();

            loop {
                // Check for cycle before processing
                if seen_in_trace.contains(&trace) {
                    // Cycle detected, stop tracing
                    break;
                }

                // Add to path and mark as seen
                path.path.insert(0, trace.clone());
                seen_in_trace.put(&trace, ())?;

                // Get parent for next iteration
                if let Some(parent) = parent_map.get(&trace) {
                    trace = parent.clone();
                } else {
                    break;
                }
            }

            if let Some(workspace_name) = workspace_name_for_dep {
                let mut workspace_prefix: Vec<u8> = Vec::new();
                write!(&mut workspace_prefix, "workspace:{}", BStr::new(workspace_name))
                    .expect("unreachable");
                path.path.insert(0, workspace_prefix.into_boxed_slice());
            }

            paths.push(path);
        } else {
            if let Some(dependents) = dependency_tree.get(&current) {
                for dependent in dependents {
                    if !visited.contains(dependent) {
                        queue.push_back(dependent.clone());
                        parent_map.put(dependent.as_ref(), current.clone())?;
                    }
                }
            }
        }
    }

    Ok(paths)
}

#[derive(Default)]
struct VulnCounts {
    low: u32,
    moderate: u32,
    high: u32,
    critical: u32,
}

fn print_enhanced_audit_report(
    response_text: &[u8],
    pm: &mut PackageManager,
    dependency_tree: &StringHashMap<Vec<Box<[u8]>>>,
    audit_level: Option<AuditLevel>,
    ignore_list: &[&[u8]],
) -> Result<u32, bun_alloc::AllocError> {
    let source = logger::Source::init_path_string(b"audit-response.json", response_text);
    let mut log = logger::Log::init();
    let bump = bun_alloc::Arena::new();

    let expr = match bun_json::parse::<true>(&source, &mut log, &bump) {
        Ok(e) => e,
        Err(_) => {
            let _ = Output::writer().write_all(response_text);
            let _ = Output::writer().write_all(b"\n");
            return Ok(1);
        }
    };

    if let bun_js_parser::ExprData::EObject(obj) = &expr.data {
        if obj.properties.len() == 0 {
            Output::prettyln(format_args!("<green>No vulnerabilities found<r>"));
            return Ok(0);
        }
    }

    let mut audit_result = AuditResult::init();

    let mut vuln_counts = VulnCounts::default();

    if let bun_js_parser::ExprData::EObject(obj) = &expr.data {
        let properties = obj.properties.slice();

        for prop in properties {
            if let Some(key) = &prop.key {
                if let bun_js_parser::ExprData::EString(key_str) = &key.data {
                    let package_name = &key_str.data;

                    if let Some(value) = &prop.value {
                        if let bun_js_parser::ExprData::EArray(arr) = &value.data {
                            let vulns = arr.items.slice();
                            for vuln in vulns {
                                if let bun_js_parser::ExprData::EObject(_) = &vuln.data {
                                    let vulnerability = parse_vulnerability(package_name, vuln)?;

                                    if let Some(level) = audit_level {
                                        if !level.should_include_severity(&vulnerability.severity) {
                                            continue;
                                        }
                                    }

                                    if !ignore_list.is_empty() {
                                        let mut should_ignore = false;
                                        for ignored_cve in ignore_list {
                                            if strings::eql(&vulnerability.id, ignored_cve)
                                                || strings::index_of(
                                                    &vulnerability.url,
                                                    ignored_cve,
                                                )
                                                .is_some()
                                            {
                                                should_ignore = true;
                                                break;
                                            }
                                        }
                                        if should_ignore {
                                            continue;
                                        }
                                    }

                                    if vulnerability.severity.as_ref() == b"low" {
                                        vuln_counts.low += 1;
                                    } else if vulnerability.severity.as_ref() == b"moderate" {
                                        vuln_counts.moderate += 1;
                                    } else if vulnerability.severity.as_ref() == b"high" {
                                        vuln_counts.high += 1;
                                    } else if vulnerability.severity.as_ref() == b"critical" {
                                        vuln_counts.critical += 1;
                                    } else {
                                        vuln_counts.moderate += 1;
                                    }

                                    audit_result.all_vulnerabilities.push(vulnerability);
                                }
                            }
                        }
                    }
                }
            }
        }

        for vulnerability in &audit_result.all_vulnerabilities {
            let paths = find_dependency_paths(&vulnerability.package_name, dependency_tree, pm)?;

            let result = audit_result
                .vulnerable_packages
                .get_or_put(&vulnerability.package_name)?;
            if !result.found_existing {
                *result.value_ptr = PackageInfo {
                    package_id: 0,
                    // TODO(port): Zig aliased these slices; cloned here because fields are Box<[u8]>.
                    name: vulnerability.package_name.clone(),
                    version: vulnerability.vulnerable_versions.clone(),
                    vulnerabilities: Vec::new(),
                    dependents: paths,
                };
            }
            // TODO(port): Zig pushes a copy of the (POD) struct; cloned here.
            result.value_ptr.vulnerabilities.push(VulnerabilityInfo {
                severity: vulnerability.severity.clone(),
                title: vulnerability.title.clone(),
                url: vulnerability.url.clone(),
                vulnerable_versions: vulnerability.vulnerable_versions.clone(),
                id: vulnerability.id.clone(),
                package_name: vulnerability.package_name.clone(),
            });
        }

        let mut package_iter = audit_result.vulnerable_packages.iterator();
        while let Some(entry) = package_iter.next() {
            let package_info = entry.value_ptr;

            if !package_info.vulnerabilities.is_empty() {
                let main_vuln = &package_info.vulnerabilities[0];

                // const is_direct_dependency: bool = brk: {
                //     for (package_info.dependents.items) |path| {
                //         if (path.is_direct) {
                //             break :brk true;
                //         }
                //     }
                //
                //     break :brk false;
                // };

                if !main_vuln.vulnerable_versions.is_empty() {
                    Output::prettyln(format_args!(
                        "<red>{}<r>  {}",
                        BStr::new(&main_vuln.package_name),
                        BStr::new(&main_vuln.vulnerable_versions)
                    ));
                } else {
                    Output::prettyln(format_args!(
                        "<red>{}<r>",
                        BStr::new(&main_vuln.package_name)
                    ));
                }

                for path in &package_info.dependents {
                    if path.path.len() > 1 {
                        if path.path[0].starts_with(b"workspace:") {
                            let vulnerable_pkg = &path.path[path.path.len() - 1];
                            let workspace_part = &path.path[0];

                            Output::prettyln(format_args!(
                                "  <d>{} › <red>{}<r>",
                                BStr::new(workspace_part),
                                BStr::new(vulnerable_pkg)
                            ));
                        } else {
                            let vulnerable_pkg = &path.path[0];

                            let mut reversed_items: Vec<&[u8]> = Vec::new();
                            for item in &path.path[1..] {
                                reversed_items.push(item);
                            }
                            reversed_items.reverse();

                            // TODO(port): std.mem.join → manual join into Vec<u8>.
                            let mut vuln_pkg_path: Vec<u8> = Vec::new();
                            for (i, item) in reversed_items.iter().enumerate() {
                                if i > 0 {
                                    vuln_pkg_path.extend_from_slice(" › ".as_bytes());
                                }
                                vuln_pkg_path.extend_from_slice(item);
                            }

                            Output::prettyln(format_args!(
                                "  <d>{} › <red>{}<r>",
                                BStr::new(&vuln_pkg_path),
                                BStr::new(vulnerable_pkg)
                            ));
                        }
                    } else {
                        Output::prettyln(format_args!("  <d>(direct dependency)<r>"));
                    }
                }

                for vuln in &package_info.vulnerabilities {
                    if !vuln.title.is_empty() {
                        if vuln.severity.as_ref() == b"critical" {
                            Output::prettyln(format_args!(
                                "  <red>critical<d>:<r> {} - <d>{}<r>",
                                BStr::new(&vuln.title),
                                BStr::new(&vuln.url)
                            ));
                        } else if vuln.severity.as_ref() == b"high" {
                            Output::prettyln(format_args!(
                                "  <red>high<d>:<r> {} - <d>{}<r>",
                                BStr::new(&vuln.title),
                                BStr::new(&vuln.url)
                            ));
                        } else if vuln.severity.as_ref() == b"moderate" {
                            Output::prettyln(format_args!(
                                "  <yellow>moderate<d>:<r> {} - <d>{}<r>",
                                BStr::new(&vuln.title),
                                BStr::new(&vuln.url)
                            ));
                        } else {
                            Output::prettyln(format_args!(
                                "  <cyan>low<d>:<r> {} - <d>{}<r>",
                                BStr::new(&vuln.title),
                                BStr::new(&vuln.url)
                            ));
                        }
                    }
                }

                // if (is_direct_dependency) {
                //     Output.prettyln("  To fix: <green>`bun update {s}`<r>", .{package_info.name});
                // } else {
                //     Output.prettyln("  To fix: <green>`bun update --latest`<r><d> (may be a breaking change)<r>", .{});
                // }

                Output::prettyln(format_args!(""));
            }
        }

        let total = vuln_counts.low + vuln_counts.moderate + vuln_counts.high + vuln_counts.critical;
        if total > 0 {
            Output::pretty(format_args!("<b>{} vulnerabilities<r> (", total));

            let mut has_previous = false;
            if vuln_counts.critical > 0 {
                Output::pretty(format_args!("<red><b>{} critical<r>", vuln_counts.critical));
                has_previous = true;
            }
            if vuln_counts.high > 0 {
                if has_previous {
                    Output::pretty(format_args!(", "));
                }
                Output::pretty(format_args!("<red>{} high<r>", vuln_counts.high));
                has_previous = true;
            }
            if vuln_counts.moderate > 0 {
                if has_previous {
                    Output::pretty(format_args!(", "));
                }
                Output::pretty(format_args!("<yellow>{} moderate<r>", vuln_counts.moderate));
                has_previous = true;
            }
            if vuln_counts.low > 0 {
                if has_previous {
                    Output::pretty(format_args!(", "));
                }
                Output::pretty(format_args!("<cyan>{} low<r>", vuln_counts.low));
            }
            Output::prettyln(format_args!(")"));

            Output::prettyln(format_args!(""));
            Output::prettyln(format_args!(
                "To update all dependencies to the latest compatible versions:"
            ));
            Output::prettyln(format_args!("  <green>bun update<r>"));
            Output::prettyln(format_args!(""));
            Output::prettyln(format_args!(
                "To update all dependencies to the latest versions (including breaking changes):"
            ));
            Output::prettyln(format_args!("  <green>bun update --latest<r>"));
            Output::prettyln(format_args!(""));
        }

        if total > 0 {
            return Ok(1);
        }
    } else {
        let _ = Output::writer().write_all(response_text);
        let _ = Output::writer().write_all(b"\n");
    }

    Ok(0)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/audit_command.zig (837 lines)
//   confidence: medium
//   todos:      12
//   notes:      Output::* fns assumed to take fmt::Arguments; ExprData enum variant names, MultiArrayList column accessors, StringHashMap get_or_put API, and bun_json::parse signature are all guesses; VulnerabilityInfo string fields boxed instead of borrowing JSON arena.
// ──────────────────────────────────────────────────────────────────────────
