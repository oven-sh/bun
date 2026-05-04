use bstr::BStr;
use std::collections::VecDeque;
use std::io::Write as _;

use bun_collections::StringHashMap;
use bun_core::{Global, Output};
use bun_http::{self as http, HeaderBuilder};
use bun_install::package_manager::command_line_arguments::AuditLevel;
use bun_install::PackageManager;
use bun_js_parser::Expr;
use bun_libdeflate_sys as libdeflate;
use bun_logger as logger;
use bun_str::strings;
use bun_url::URL;

use crate::cli::Command;
use crate::package_manager_command::PackageManagerCommand;

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
    // TODO(port): `!noreturn` → `Result<!, _>`; `!` is unstable in this position on stable Rust,
    // Phase B may swap to `Result<core::convert::Infallible, _>`.
    pub fn exec(ctx: Command::Context) -> Result<!, bun_core::Error> {
        let cli = PackageManager::CommandLineArguments::parse(PackageManager::Subcommand::Audit)?;
        let (manager, _) = match PackageManager::init(ctx, cli, PackageManager::Subcommand::Audit) {
            Ok(v) => v,
            Err(err) => {
                if err == bun_core::err!("MissingPackageJSON") {
                    let mut cwd_buf = bun_paths::PathBuffer::uninit();
                    match bun_sys::getcwd(&mut cwd_buf) {
                        Ok(cwd) => {
                            Output::err_generic(format_args!(
                                "No package.json was found for directory \"{}\"",
                                BStr::new(cwd)
                            ));
                        }
                        Err(_) => {
                            Output::err_generic(format_args!("No package.json was found"));
                        }
                    }
                    Output::note(format_args!("Run \"bun init\" to initialize a project"));
                    Global::exit(1);
                }

                return Err(err);
            }
        };

        let code = audit(
            ctx,
            manager,
            manager.options.json_output,
            cli.audit_level,
            cli.production,
            &cli.audit_ignore_list,
        )?;
        Global::exit(code);
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
        Output::pretty_error(format_args!(const_format::concatcp!(
            "<r><b>bun audit <r><d>v",
            Global::PACKAGE_JSON_VERSION_WITH_SHA,
            "<r>\n"
        )));
        Output::flush();

        let load_lockfile = pm.lockfile.load_from_cwd(pm, ctx.log, true);
        PackageManagerCommand::handle_load_lockfile_errors(load_lockfile, pm);

        let dependency_tree = build_dependency_tree(pm)?;

        let packages_result = collect_packages_for_audit(pm, audit_prod_only)?;

        let response_text = send_audit_request(pm, &packages_result.audit_body)?;

        if json_output {
            let _ = Output::writer().write_all(&response_text);
            let _ = Output::writer().write_all(b"\n");

            if !response_text.is_empty() {
                let source = logger::Source::init_path_string(b"audit-response.json", &response_text);
                let mut log = logger::Log::init();

                let expr = match bun_json::parse(&source, &mut log, true) {
                    Ok(e) => e,
                    Err(_) => {
                        Output::pretty_errorln(format_args!(
                            "<red>error<r>: audit request failed to parse json. Is the registry down?"
                        ));
                        return Ok(1); // If we can't parse then safe to assume a similar failure
                    }
                };

                // If the response is an empty object, no vulnerabilities
                // TODO(port): `expr.data` tagged-union access; assumes Rust enum `ExprData::EObject(..)`.
                if let bun_js_parser::ExprData::EObject(obj) = &expr.data {
                    if obj.properties.len() == 0 {
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
    let mut dependency_tree: StringHashMap<Vec<Box<[u8]>>> = StringHashMap::new();

    let packages = pm.lockfile.packages.slice();
    let pkg_names = packages.items_name();
    let pkg_dependencies = packages.items_dependencies();
    let pkg_resolutions = packages.items_resolutions();
    let buf = pm.lockfile.buffers.string_bytes.as_slice();
    let dependencies = pm.lockfile.buffers.dependencies.as_slice();
    let resolutions = pm.lockfile.buffers.resolutions.as_slice();

    // TODO(port): MultiArrayList column accessors (`items(.field)`) are placeholder method names.
    let pkg_resolution_tags = packages.items_resolution();

    debug_assert_eq!(pkg_names.len(), pkg_dependencies.len());
    debug_assert_eq!(pkg_names.len(), pkg_resolutions.len());
    for (pkg_idx, ((pkg_name, deps), res_list)) in pkg_names
        .iter()
        .zip(pkg_dependencies)
        .zip(pkg_resolutions)
        .enumerate()
    {
        let package_name = pkg_name.slice(buf);

        if pkg_resolution_tags[pkg_idx].tag != bun_install::Resolution::Tag::Npm {
            continue;
        }

        let dep_slice = deps.get(dependencies);
        let res_slice = res_list.get(resolutions);

        debug_assert_eq!(dep_slice.len(), res_slice.len());
        for (_, &resolved_pkg_id) in dep_slice.iter().zip(res_slice) {
            if (resolved_pkg_id as usize) >= pkg_names.len() {
                continue;
            }

            let resolved_name = pkg_names[resolved_pkg_id as usize].slice(buf);

            let result = dependency_tree.get_or_put(resolved_name)?;
            if !result.found_existing {
                *result.key_ptr = Box::<[u8]>::from(resolved_name);
                *result.value_ptr = Vec::new();
            }
            result.value_ptr.push(Box::<[u8]>::from(package_name));
        }
    }

    Ok(dependency_tree)
}

fn build_production_package_set(
    pm: &mut PackageManager,
    prod_set: &mut StringHashMap<()>,
) -> Result<(), bun_alloc::AllocError> {
    let packages = pm.lockfile.packages.slice();
    let pkg_names = packages.items_name();
    let pkg_dependencies = packages.items_dependencies();
    let pkg_resolutions = packages.items_resolutions();
    let buf = pm.lockfile.buffers.string_bytes.as_slice();
    let dependencies = pm.lockfile.buffers.dependencies.as_slice();
    let resolutions = pm.lockfile.buffers.resolutions.as_slice();
    let root_id = pm.root_package_id.get(&pm.lockfile, pm.workspace_name_hash);

    // TODO(port): bun.LinearFifo(u32, .Dynamic) → VecDeque<u32>
    let mut queue: VecDeque<u32> = VecDeque::new();

    let root_deps = pkg_dependencies[root_id as usize];
    let root_resolutions = pkg_resolutions[root_id as usize];
    let dep_slice = root_deps.get(dependencies);
    let res_slice = root_resolutions.get(resolutions);

    debug_assert_eq!(dep_slice.len(), res_slice.len());
    for (dep, &resolved_pkg_id) in dep_slice.iter().zip(res_slice) {
        if !dep.behavior.is_dev() && (resolved_pkg_id as usize) < packages.len() {
            let pkg_name = pkg_names[resolved_pkg_id as usize].slice(buf);
            prod_set.put(pkg_name, ())?;
            queue.push_back(resolved_pkg_id);
        }
    }

    while let Some(current_pkg_id) = queue.pop_front() {
        let current_deps = pkg_dependencies[current_pkg_id as usize];
        let current_resolutions = pkg_resolutions[current_pkg_id as usize];
        let current_dep_slice = current_deps.get(dependencies);
        let current_res_slice = current_resolutions.get(resolutions);

        debug_assert_eq!(current_dep_slice.len(), current_res_slice.len());
        for (_, &resolved_pkg_id) in current_dep_slice.iter().zip(current_res_slice) {
            if (resolved_pkg_id as usize) >= pkg_names.len() {
                continue;
            }

            let pkg_name = pkg_names[resolved_pkg_id as usize].slice(buf);
            if !prod_set.contains(pkg_name) {
                prod_set.put(pkg_name, ())?;
                queue.push_back(resolved_pkg_id);
            }
        }
    }

    Ok(())
}

struct CollectPackagesResult {
    audit_body: Box<[u8]>,
    skipped_packages: Vec<Box<[u8]>>,
}

struct PackageVersions {
    name: Box<[u8]>,
    versions: Vec<Box<[u8]>>,
}

fn collect_packages_for_audit(
    pm: &mut PackageManager,
    prod_only: bool,
) -> Result<CollectPackagesResult, bun_alloc::AllocError> {
    let packages = pm.lockfile.packages.slice();
    let pkg_names = packages.items_name();
    let pkg_resolutions = packages.items_resolution();
    let buf = pm.lockfile.buffers.string_bytes.as_slice();
    let root_id = pm.root_package_id.get(&pm.lockfile, pm.workspace_name_hash);

    let mut packages_list: Vec<PackageVersions> = Vec::new();

    let mut skipped_packages: Vec<Box<[u8]>> = Vec::new();

    let mut prod_packages: Option<StringHashMap<()>> = None;

    if prod_only {
        prod_packages = Some(StringHashMap::new());
        build_production_package_set(pm, prod_packages.as_mut().unwrap())?;
    }

    debug_assert_eq!(pkg_names.len(), pkg_resolutions.len());
    for (idx, (name, res)) in pkg_names.iter().zip(pkg_resolutions).enumerate() {
        if idx == root_id as usize {
            continue;
        }
        if res.tag != bun_install::Resolution::Tag::Npm {
            continue;
        }

        let name_slice = name.slice(buf);

        if prod_only {
            if let Some(map) = &prod_packages {
                if !map.contains(name_slice) {
                    continue;
                }
            }
        }

        let package_scope = pm.scope_for_package_name(name_slice);
        if package_scope.url_hash != pm.options.scope.url_hash {
            skipped_packages.push(Box::<[u8]>::from(name_slice));
            continue;
        }

        let mut ver_str: Vec<u8> = Vec::new();
        write!(&mut ver_str, "{}", res.value.npm.version.fmt(buf)).expect("unreachable");
        let ver_str: Box<[u8]> = ver_str.into_boxed_slice();

        // PORT NOTE: reshaped for borrowck — find index instead of holding `&mut` across push.
        let mut found_idx: Option<usize> = None;
        for (i, item) in packages_list.iter().enumerate() {
            if item.name.as_ref() == name_slice {
                found_idx = Some(i);
                break;
            }
        }

        let found_idx = match found_idx {
            Some(i) => i,
            None => {
                packages_list.push(PackageVersions {
                    name: Box::<[u8]>::from(name_slice),
                    versions: Vec::new(),
                });
                packages_list.len() - 1
            }
        };

        let found_package = &mut packages_list[found_idx];

        let mut version_exists = false;
        for existing_ver in &found_package.versions {
            if existing_ver.as_ref() == ver_str.as_ref() {
                version_exists = true;
                break;
            }
        }

        if !version_exists {
            found_package.versions.push(ver_str);
        }
        // else: drop(ver_str) — Rust frees automatically.
    }

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
    let mut compressor = libdeflate::Compressor::alloc(6).ok_or(bun_alloc::AllocError)?;

    let max_compressed_size = compressor.max_bytes_needed(body, libdeflate::Format::Gzip);
    let mut compressed_body = vec![0u8; max_compressed_size];

    let compression_result = compressor.gzip(body, &mut compressed_body);
    let final_compressed_body = &compressed_body[..compression_result.written];

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
    let url = URL::parse(&url_str);

    let http_proxy = pm.env.get_http_proxy_for(&url);

    // PERF(port): Zig used MutableString with initial capacity 1024.
    let mut response_buf: Vec<u8> = Vec::with_capacity(1024);
    let mut req = http::AsyncHTTP::init_sync(
        http::Method::POST,
        url,
        headers.entries,
        // TODO(port): Zig passes `headers.content.ptr.?[0..headers.content.len]`.
        headers.content.slice(),
        &mut response_buf,
        final_compressed_body,
        http_proxy,
        None,
        http::Redirect::Follow,
    );
    let res = match req.send_sync() {
        Ok(r) => r,
        Err(err) => {
            Output::err(err, format_args!("audit request failed"));
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

    Ok(Box::<[u8]>::from(response_buf.as_slice()))
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

    // TODO(port): `Expr.data` tagged-union access; assumes Rust enum `ExprData`.
    if let bun_js_parser::ExprData::EObject(obj) = &vuln.data {
        let props = obj.properties.slice();
        for prop in props {
            if let Some(key) = &prop.key {
                if let bun_js_parser::ExprData::EString(key_str) = &key.data {
                    let field_name = &key_str.data;
                    if let Some(value) = &prop.value {
                        if let bun_js_parser::ExprData::EString(val_str) = &value.data {
                            let field_value: &[u8] = &val_str.data;
                            if field_name.as_ref() == b"severity" {
                                vulnerability.severity = Box::<[u8]>::from(field_value);
                            } else if field_name.as_ref() == b"title" {
                                vulnerability.title = Box::<[u8]>::from(field_value);
                            } else if field_name.as_ref() == b"url" {
                                vulnerability.url = Box::<[u8]>::from(field_value);
                            } else if field_name.as_ref() == b"vulnerable_versions" {
                                vulnerability.vulnerable_versions = Box::<[u8]>::from(field_value);
                            } else if field_name.as_ref() == b"id" {
                                vulnerability.id = Box::<[u8]>::from(field_value);
                            }
                        } else if let bun_js_parser::ExprData::ENumber(num) = &value.data {
                            if field_name.as_ref() == b"id" {
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

    let expr = match bun_json::parse(&source, &mut log, true) {
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
