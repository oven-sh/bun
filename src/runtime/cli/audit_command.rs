use bstr::BStr;
use std::io::Write as _;

use bun_ast::{ExprData, e as E};
use bun_collections::{StringArrayHashMap, StringHashMap};
use bun_core::{Global, Output, pretty, prettyln};
use bun_core::{MutableString, strings};
use bun_http::{self as http, HeaderBuilder};
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::package_manager_real::command_line_arguments::AuditLevel;
use bun_install::resolution::Tag as ResolutionTag;
use bun_install::{CommandLineArguments, PackageManager, Subcommand};
use bun_libdeflate_sys::libdeflate;
use bun_parsers::json as bun_json;
use bun_url::URL;

use crate::cli::Command;
use crate::cli::package_manager_command::PackageManagerCommand;

// Boxed to avoid a struct lifetime param; the
// clones are per-vulnerability, terminal-UI-bound, and not perf-relevant.
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
    vulnerabilities: Vec<VulnerabilityInfo>,
    dependents: Vec<DependencyPath>,
}

struct DependencyPath {
    path: Vec<Box<[u8]>>,
}

struct AuditResult {
    // Insertion-ordered so the printed report follows the registry's response
    // property order instead of std HashMap's randomized iteration.
    vulnerable_packages: StringArrayHashMap<PackageInfo>,
    all_vulnerabilities: Vec<VulnerabilityInfo>,
}

impl AuditResult {
    pub(crate) fn init() -> AuditResult {
        AuditResult {
            vulnerable_packages: StringArrayHashMap::default(),
            all_vulnerabilities: Vec::new(),
        }
    }
}

// `deinit` body only freed owned fields → Drop is automatic on `StringHashMap`/`Vec`/`Box`.

pub(crate) struct AuditCommand;

impl AuditCommand {
    // `!noreturn` → `Result<Infallible, _>` so callers can `?`; all Ok paths Global::exit.
    pub(crate) fn exec(ctx: Command::Context) -> crate::Result<core::convert::Infallible> {
        let cli = CommandLineArguments::parse(Subcommand::Audit)?;
        // Note: `init` consumes `cli`; capture the fields read after it.
        let audit_level = cli.audit_level;
        let production = cli.production;
        let audit_ignore_list = cli.audit_ignore_list;

        let (manager, _original_cwd) = match PackageManager::init(&mut *ctx, cli, Subcommand::Audit)
        {
            Ok(v) => v,
            Err(err) => {
                if err == bun_install::Error::MissingPackageJSON {
                    let mut cwd_buf = bun_paths::PathBuffer::uninit();
                    if let Ok(cwd) = bun_core::getcwd(&mut cwd_buf) {
                        Output::err_generic(
                            "No package.json was found for directory \"{s}\"",
                            (BStr::new(cwd.as_bytes()),),
                        );
                    } else {
                        Output::err_generic("No package.json was found", ());
                    }
                    bun_core::note!("Run \"bun init\" to initialize a project");
                    Global::exit(1);
                }

                return Err(err.into());
            }
        };
        let json_output = manager.options.json_output;

        let code = Self::audit(
            ctx,
            manager,
            json_output,
            audit_level,
            production,
            audit_ignore_list,
        )?;
        Global::exit(code);
    }

    /// Returns the exit code of the command. 0 if no vulnerabilities were found, 1 if vulnerabilities were found.
    /// The exception is when you pass --json, it will simply return 0 as that was considered a successful "request
    /// for the audit information"
    pub(crate) fn audit(
        _ctx: Command::Context,
        pm: &mut PackageManager,
        json_output: bool,
        audit_level: Option<AuditLevel>,
        audit_prod_only: bool,
        ignore_list: &[&[u8]],
    ) -> Result<u32, bun_alloc::AllocError> {
        bun_core::pretty_error!(
            "<r><b>bun audit <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        );
        Output::flush();

        // Note: a self-referential split borrow; encapsulated upstream as
        // `PackageManager::load_lockfile_from_cwd`.
        {
            let log_level = pm.options.log_level;
            let load_lockfile = pm.load_lockfile_from_cwd::<true>();
            PackageManagerCommand::handle_load_lockfile_errors(&load_lockfile, log_level);
        }

        let dependency_tree = build_dependency_tree(pm)?;

        let packages_result = collect_packages_for_audit(pm, audit_prod_only)?;

        let response_text = send_audit_request(pm, &packages_result.audit_body)?;

        if json_output {
            let _ = Output::writer().write_all(&response_text);
            let _ = Output::writer().write_all(b"\n");

            if !response_text.is_empty() {
                let source =
                    bun_ast::Source::init_path_string(b"audit-response.json", &response_text[..]);
                let mut log = bun_ast::Log::init();

                let parsed = match bun_json::ParsedJson::parse_json(&source, &mut log) {
                    Ok(e) => e,
                    Err(_) => {
                        bun_core::pretty_errorln!(
                            "<red>error<r>: audit request failed to parse json. Is the registry down?"
                        );
                        return Ok(1); // If we can't parse then safe to assume a similar failure
                    }
                };

                // If the response is an empty object, no vulnerabilities
                if let ExprData::EObjectJSON(obj) = &parsed.root.data {
                    if obj.get().properties().is_empty() {
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
            prettyln!("<green>No vulnerabilities found<r>");

            print_skipped_packages(&packages_result.skipped_packages);

            return Ok(0);
        }
    }
}

fn print_skipped_packages(skipped_packages: &[Box<[u8]>]) {
    if !skipped_packages.is_empty() {
        pretty!("<d>Skipped<r> ");
        for (i, package_name) in skipped_packages.iter().enumerate() {
            if i > 0 {
                pretty!(", ");
            }
            pretty!("{}", BStr::new(package_name));
        }

        if skipped_packages.len() > 1 {
            prettyln!(" <d>because they do not come from the default registry<r>");
        } else {
            prettyln!(" <d>because it does not come from the default registry<r>");
        }

        prettyln!("");
    }
}

fn build_dependency_tree(
    pm: &mut PackageManager,
) -> Result<StringHashMap<Vec<Box<[u8]>>>, bun_alloc::AllocError> {
    let mut dependency_tree: StringHashMap<Vec<Box<[u8]>>> = StringHashMap::default();

    let packages = pm.lockfile.packages.slice();
    let pkg_names = packages.items_name();
    let pkg_dependencies = packages.items_dependencies();
    let pkg_resolutions = packages.items_resolutions();
    let pkg_resolution = packages.items_resolution();
    let buf = pm.lockfile.buffers.string_bytes.as_slice();
    let dependencies = pm.lockfile.buffers.dependencies.as_slice();
    let resolutions = pm.lockfile.buffers.resolutions.as_slice();

    for pkg_idx in 0..pkg_names.len() {
        let package_name = pkg_names[pkg_idx].slice(buf);

        if pkg_resolution[pkg_idx].tag != ResolutionTag::Npm {
            continue;
        }

        let dep_slice = pkg_dependencies[pkg_idx].get(dependencies);
        let res_slice = pkg_resolutions[pkg_idx].get(resolutions);

        for (_, &resolved_pkg_id) in dep_slice.iter().zip(res_slice.iter()) {
            if (resolved_pkg_id as usize) >= pkg_names.len() {
                continue;
            }

            let resolved_name = pkg_names[resolved_pkg_id as usize].slice(buf);

            // `StringHashMap::get_or_put` always boxes the key on miss.
            let result = dependency_tree.get_or_put(resolved_name)?;
            result.value_ptr.push(Box::<[u8]>::from(package_name));
        }
    }

    Ok(dependency_tree)
}

fn build_production_package_set(
    pm: &mut PackageManager,
    prod_set: &mut StringHashMap<()>,
) -> Result<(), bun_alloc::AllocError> {
    let root_id = pm.root_package_id.get(&pm.lockfile, pm.workspace_name_hash);

    let packages = pm.lockfile.packages.slice();
    let pkg_names = packages.items_name();
    let pkg_dependencies = packages.items_dependencies();
    let pkg_resolutions = packages.items_resolutions();
    let buf = pm.lockfile.buffers.string_bytes.as_slice();
    let dependencies = pm.lockfile.buffers.dependencies.as_slice();
    let resolutions = pm.lockfile.buffers.resolutions.as_slice();

    let mut queue: std::collections::VecDeque<u32> = std::collections::VecDeque::new();

    let root_deps = pkg_dependencies[root_id as usize];
    let root_resolutions = pkg_resolutions[root_id as usize];
    let dep_slice = root_deps.get(dependencies);
    let res_slice = root_resolutions.get(resolutions);

    for (dep, &resolved_pkg_id) in dep_slice.iter().zip(res_slice.iter()) {
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

        for (_, &resolved_pkg_id) in current_dep_slice.iter().zip(current_res_slice.iter()) {
            if (resolved_pkg_id as usize) >= pkg_names.len() {
                continue;
            }

            let pkg_name = pkg_names[resolved_pkg_id as usize].slice(buf);
            if !prod_set.contains_key(pkg_name) {
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
    let root_id = pm.root_package_id.get(&pm.lockfile, pm.workspace_name_hash);

    let mut packages_list: Vec<PackageVersions> = Vec::new();
    let mut skipped_packages: Vec<Box<[u8]>> = Vec::new();

    let mut prod_packages: Option<StringHashMap<()>> = None;
    if prod_only {
        let mut set = StringHashMap::default();
        build_production_package_set(pm, &mut set)?;
        prod_packages = Some(set);
    }

    // Note: reshaped for borrowck — column slices borrow `pm.lockfile`
    // immutably for the loop, so resolve `root_id` / `prod_packages` (which
    // need `&mut pm`) above, and split-borrow `pm.options` for the scope lookup
    // (disjoint from `pm.lockfile`).
    let options = &pm.options;
    let default_url_hash = options.scope.url_hash;
    let packages = pm.lockfile.packages.slice();
    let pkg_names = packages.items_name();
    let pkg_resolutions = packages.items_resolution();
    let buf = pm.lockfile.buffers.string_bytes.as_slice();

    for (idx, (name, res)) in pkg_names.iter().zip(pkg_resolutions.iter()).enumerate() {
        if idx as u32 == root_id {
            continue;
        }
        if res.tag != ResolutionTag::Npm {
            continue;
        }

        let name_slice = name.slice(buf);

        if prod_only {
            if let Some(ref prod) = prod_packages {
                if !prod.contains_key(name_slice) {
                    continue;
                }
            }
        }

        let package_scope = options.scope_for_package_name(name_slice);
        if package_scope.url_hash != default_url_hash {
            skipped_packages.push(Box::<[u8]>::from(name_slice));
            continue;
        }

        let mut ver_str: Vec<u8> = Vec::new();
        // `res.tag == ResolutionTag::Npm` checked above.
        let npm = *res.npm();
        write!(&mut ver_str, "{}", npm.version.fmt(buf)).expect("unreachable");
        let ver_str: Box<[u8]> = ver_str.into_boxed_slice();

        let found_package = packages_list
            .iter_mut()
            .find(|item| item.name.as_ref() == name_slice);

        let found_package = match found_package {
            Some(p) => p,
            None => {
                packages_list.push(PackageVersions {
                    name: Box::<[u8]>::from(name_slice),
                    versions: Vec::new(),
                });
                packages_list.last_mut().unwrap()
            }
        };

        let version_exists = found_package
            .versions
            .iter()
            .any(|existing_ver| existing_ver.as_ref() == ver_str.as_ref());

        if !version_exists {
            found_package.versions.push(ver_str);
        }
    }

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
    let mut compressor = libdeflate::OwnedCompressor::new(6).ok_or(bun_alloc::AllocError)?;

    let max_compressed_size = compressor.max_bytes_needed(body, libdeflate::Encoding::Gzip);
    let mut compressed_body = Vec::with_capacity(max_compressed_size);
    let _ = compressor.compress_to_vec(body, &mut compressed_body, libdeflate::Encoding::Gzip);
    drop(compressor);
    let final_compressed_body = compressed_body;

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
        // `format_args!`/`BStr` Display is lossy for non-UTF-8 credentials (U+FFFD
        // expands 1->3 bytes) and overruns the byte count reserved above. Raw bytes.
        headers.append_bytes_value(b"authorization", b"Bearer ", &pm.options.scope.token);
    } else if !pm.options.scope.auth.is_empty() {
        headers.append_bytes_value(b"authorization", b"Basic ", &pm.options.scope.auth);
    }

    let mut url_str: Vec<u8> = Vec::new();
    write!(
        &mut url_str,
        "{}/-/npm/v1/security/advisories/bulk",
        BStr::new(strings::without_trailing_slash(pm.options.scope.url.href()))
    )
    .expect("unreachable");
    let url = URL::parse(&url_str);

    let http_proxy = pm.http_proxy(&url);

    let headers_buf: &[u8] = headers.content.written_slice();

    let mut response_buf = MutableString::init(1024)?;
    // `init_sync` erases lifetimes internally (port-erased raw pointers); all
    // borrowed inputs live on this stack frame past `send_sync()`.
    let mut req = http::AsyncHTTP::init_sync(
        http::Method::POST,
        url,
        headers.entries,
        headers_buf,
        &raw mut response_buf,
        &final_compressed_body,
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
        bun_core::pretty_errorln!(
            "<red>error<r>: audit request failed (status {})",
            res.status_code
        );
        Global::crash();
    }

    Ok(Box::<[u8]>::from(response_buf.list.as_slice()))
}

fn parse_vulnerability(
    package_name: &[u8],
    vuln: &E::ObjectJSON,
) -> Result<VulnerabilityInfo, bun_alloc::AllocError> {
    let mut vulnerability = VulnerabilityInfo {
        severity: Box::<[u8]>::from(b"moderate" as &[u8]),
        title: Box::<[u8]>::from(b"Vulnerability found" as &[u8]),
        url: Box::default(),
        vulnerable_versions: Box::default(),
        id: Box::default(),
        package_name: Box::<[u8]>::from(package_name),
    };

    for prop in vuln.properties() {
        let field_name: &[u8] = prop.key.slice();
        match &prop.value {
            E::JsonValue::String(val_str) => {
                let field_value: &[u8] = val_str.slice();
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
            }
            E::JsonValue::Number(num) => {
                if field_name == b"id" {
                    let mut s: Vec<u8> = Vec::new();
                    write!(&mut s, "{}", num.value() as u64).expect("unreachable");
                    vulnerability.id = s.into_boxed_slice();
                }
            }
            _ => {}
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

    let root_id = pm.root_package_id.get(&pm.lockfile, pm.workspace_name_hash);

    let packages = pm.lockfile.packages.slice();
    let dependencies = pm.lockfile.buffers.dependencies.as_slice();
    let buf = pm.lockfile.buffers.string_bytes.as_slice();
    let pkg_names = packages.items_name();
    let pkg_resolutions = packages.items_resolution();
    let pkg_deps = packages.items_dependencies();

    let root_deps = pkg_deps[root_id as usize];
    let dep_slice = root_deps.get(dependencies);

    for dependency in dep_slice {
        let dep_name = dependency.name.slice(buf);
        if dep_name == target_package {
            paths.push(DependencyPath {
                path: vec![Box::<[u8]>::from(target_package)],
            });
            break;
        }
    }

    for ((resolution, workspace_deps), pkg_name) in pkg_resolutions
        .iter()
        .zip(pkg_deps.iter())
        .zip(pkg_names.iter())
    {
        if resolution.tag != ResolutionTag::Workspace {
            continue;
        }

        let workspace_name = pkg_name.slice(buf);
        let workspace_dep_slice = workspace_deps.get(dependencies);

        for dependency in workspace_dep_slice {
            let dep_name = dependency.name.slice(buf);
            if dep_name == target_package {
                let mut workspace_prefix: Vec<u8> = Vec::new();
                write!(
                    &mut workspace_prefix,
                    "workspace:{}",
                    BStr::new(workspace_name)
                )
                .expect("unreachable");
                paths.push(DependencyPath {
                    path: vec![
                        workspace_prefix.into_boxed_slice(),
                        Box::<[u8]>::from(target_package),
                    ],
                });
                break;
            }
        }
    }

    let mut queue: std::collections::VecDeque<Box<[u8]>> = std::collections::VecDeque::new();
    let mut visited: StringHashMap<()> = StringHashMap::default();
    let mut parent_map: StringHashMap<Box<[u8]>> = StringHashMap::default();

    if let Some(dependents) = dependency_tree.get(target_package) {
        for dependent in dependents {
            queue.push_back(dependent.clone());
            parent_map.put(dependent, Box::<[u8]>::from(target_package))?;
        }
    }

    while let Some(current) = queue.pop_front() {
        if visited.contains_key(&*current) {
            continue;
        }
        visited.put(&current, ())?;

        let mut is_root_dep = false;
        for dependency in dep_slice {
            let dep_name = dependency.name.slice(buf);
            if dep_name == &*current {
                is_root_dep = true;
                break;
            }
        }

        let mut workspace_name_for_dep: Option<&[u8]> = None;
        for ((resolution, workspace_deps), pkg_name) in pkg_resolutions
            .iter()
            .zip(pkg_deps.iter())
            .zip(pkg_names.iter())
        {
            if resolution.tag != ResolutionTag::Workspace {
                continue;
            }

            let workspace_dep_slice = workspace_deps.get(dependencies);
            for dependency in workspace_dep_slice {
                let dep_name = dependency.name.slice(buf);
                if dep_name == &*current {
                    workspace_name_for_dep = Some(pkg_name.slice(buf));
                    break;
                }
            }
            if workspace_name_for_dep.is_some() {
                break;
            }
        }

        if is_root_dep || workspace_name_for_dep.is_some() {
            let mut path = DependencyPath { path: Vec::new() };

            let mut trace: Box<[u8]> = current.clone();
            let mut seen_in_trace: StringHashMap<()> = StringHashMap::default();

            loop {
                // Check for cycle before processing
                if seen_in_trace.contains_key(&*trace) {
                    // Cycle detected, stop tracing
                    break;
                }

                // Add to path and mark as seen
                path.path.insert(0, trace.clone());
                seen_in_trace.put(&trace, ())?;

                // Get parent for next iteration
                if let Some(parent) = parent_map.get(&*trace) {
                    trace.clone_from(parent);
                } else {
                    break;
                }
            }

            if let Some(workspace_name) = workspace_name_for_dep {
                let mut workspace_prefix: Vec<u8> = Vec::new();
                write!(
                    &mut workspace_prefix,
                    "workspace:{}",
                    BStr::new(workspace_name)
                )
                .expect("unreachable");
                path.path.insert(0, workspace_prefix.into_boxed_slice());
            }

            paths.push(path);
        } else if let Some(dependents) = dependency_tree.get(&*current) {
            for dependent in dependents {
                if !visited.contains_key(&**dependent) {
                    queue.push_back(dependent.clone());
                    parent_map.put(dependent, current.clone())?;
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
    let source = bun_ast::Source::init_path_string(b"audit-response.json", response_text);
    let mut log = bun_ast::Log::init();

    let parsed = match bun_json::ParsedJson::parse_json(&source, &mut log) {
        Ok(e) => e,
        Err(_) => {
            let _ = Output::writer().write_all(response_text);
            let _ = Output::writer().write_all(b"\n");
            return Ok(1);
        }
    };
    let expr = parsed.root;

    if let ExprData::EObjectJSON(obj) = &expr.data {
        if obj.get().properties().is_empty() {
            prettyln!("<green>No vulnerabilities found<r>");
            return Ok(0);
        }
    }

    let mut audit_result = AuditResult::init();

    let mut vuln_counts = VulnCounts::default();

    if let ExprData::EObjectJSON(obj) = &expr.data {
        for prop in obj.get().properties() {
            let package_name: &[u8] = prop.key.slice();

            if let Some(arr) = prop.value.as_array() {
                for vuln in arr.items() {
                    if let Some(vuln_obj) = vuln.as_object() {
                        let vulnerability = parse_vulnerability(package_name, vuln_obj)?;

                        if let Some(level) = audit_level {
                            if !level.should_include_severity(&vulnerability.severity) {
                                continue;
                            }
                        }

                        if !ignore_list.is_empty() {
                            let mut should_ignore = false;
                            for ignored_cve in ignore_list {
                                if strings::eql(&vulnerability.id, ignored_cve)
                                    || strings::index_of(&vulnerability.url, ignored_cve).is_some()
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

        for vulnerability in &audit_result.all_vulnerabilities {
            let paths = find_dependency_paths(&vulnerability.package_name, dependency_tree, pm)?;

            let result = audit_result
                .vulnerable_packages
                .get_or_put(&vulnerability.package_name)?;
            if !result.found_existing {
                *result.value_ptr = PackageInfo {
                    vulnerabilities: Vec::new(),
                    dependents: paths,
                };
            }
            result.value_ptr.vulnerabilities.push(VulnerabilityInfo {
                severity: vulnerability.severity.clone(),
                title: vulnerability.title.clone(),
                url: vulnerability.url.clone(),
                vulnerable_versions: vulnerability.vulnerable_versions.clone(),
                id: vulnerability.id.clone(),
                package_name: vulnerability.package_name.clone(),
            });
        }

        for (_, package_info) in audit_result.vulnerable_packages.iter() {
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
                    prettyln!(
                        "<red>{}<r>  {}",
                        BStr::new(&main_vuln.package_name),
                        BStr::new(&main_vuln.vulnerable_versions)
                    );
                } else {
                    prettyln!("<red>{}<r>", BStr::new(&main_vuln.package_name));
                }

                for path in &package_info.dependents {
                    if path.path.len() > 1 {
                        if path.path[0].starts_with(b"workspace:") {
                            let vulnerable_pkg = &path.path[path.path.len() - 1];
                            let workspace_part = &path.path[0];

                            prettyln!(
                                "  <d>{} › <red>{}<r>",
                                BStr::new(workspace_part),
                                BStr::new(vulnerable_pkg)
                            );
                        } else {
                            let vulnerable_pkg = &path.path[0];

                            let mut reversed_items: Vec<&[u8]> = Vec::new();
                            for item in &path.path[1..] {
                                reversed_items.push(item);
                            }
                            reversed_items.reverse();

                            let mut vuln_pkg_path: Vec<u8> = Vec::new();
                            for (i, item) in reversed_items.iter().enumerate() {
                                if i > 0 {
                                    vuln_pkg_path.extend_from_slice(" › ".as_bytes());
                                }
                                vuln_pkg_path.extend_from_slice(item);
                            }

                            prettyln!(
                                "  <d>{} › <red>{}<r>",
                                BStr::new(&vuln_pkg_path),
                                BStr::new(vulnerable_pkg)
                            );
                        }
                    } else {
                        prettyln!("  <d>(direct dependency)<r>");
                    }
                }

                for vuln in &package_info.vulnerabilities {
                    if !vuln.title.is_empty() {
                        if vuln.severity.as_ref() == b"critical" {
                            prettyln!(
                                "  <red>critical<d>:<r> {} - <d>{}<r>",
                                BStr::new(&vuln.title),
                                BStr::new(&vuln.url)
                            );
                        } else if vuln.severity.as_ref() == b"high" {
                            prettyln!(
                                "  <red>high<d>:<r> {} - <d>{}<r>",
                                BStr::new(&vuln.title),
                                BStr::new(&vuln.url)
                            );
                        } else if vuln.severity.as_ref() == b"moderate" {
                            prettyln!(
                                "  <yellow>moderate<d>:<r> {} - <d>{}<r>",
                                BStr::new(&vuln.title),
                                BStr::new(&vuln.url)
                            );
                        } else {
                            prettyln!(
                                "  <cyan>low<d>:<r> {} - <d>{}<r>",
                                BStr::new(&vuln.title),
                                BStr::new(&vuln.url)
                            );
                        }
                    }
                }

                // if (is_direct_dependency) {
                //     Output.prettyln("  To fix: <green>`bun update {s}`<r>", .{package_info.name});
                // } else {
                //     Output.prettyln("  To fix: <green>`bun update --latest`<r><d> (may be a breaking change)<r>", .{});
                // }

                prettyln!("");
            }
        }

        let total =
            vuln_counts.low + vuln_counts.moderate + vuln_counts.high + vuln_counts.critical;
        if total > 0 {
            pretty!("<b>{} vulnerabilities<r> (", total);

            let mut has_previous = false;
            if vuln_counts.critical > 0 {
                pretty!("<red><b>{} critical<r>", vuln_counts.critical);
                has_previous = true;
            }
            if vuln_counts.high > 0 {
                if has_previous {
                    pretty!(", ");
                }
                pretty!("<red>{} high<r>", vuln_counts.high);
                has_previous = true;
            }
            if vuln_counts.moderate > 0 {
                if has_previous {
                    pretty!(", ");
                }
                pretty!("<yellow>{} moderate<r>", vuln_counts.moderate);
                has_previous = true;
            }
            if vuln_counts.low > 0 {
                if has_previous {
                    pretty!(", ");
                }
                pretty!("<cyan>{} low<r>", vuln_counts.low);
            }
            prettyln!(")");

            prettyln!("");
            prettyln!("To update all dependencies to the latest compatible versions:");
            prettyln!("  <green>bun update<r>");
            prettyln!("");
            prettyln!(
                "To update all dependencies to the latest versions (including breaking changes):"
            );
            prettyln!("  <green>bun update --latest<r>");
            prettyln!("");
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
