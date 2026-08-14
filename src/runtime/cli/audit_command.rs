use bstr::BStr;
use std::io::Write as _;

use bun_ast::{ExprData, e as E};
use bun_collections::{DynamicBitSet, StringArrayHashMap, StringHashMap};
use bun_core::{Global, Output, pretty, prettyln};
use bun_core::{MutableString, strings};
use bun_http::{self as http, HeaderBuilder};
use bun_install::audit_fix::{self, Advisory};
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::lockfile::reachable;
use bun_install::package_manager_real::command_line_arguments::AuditLevel;
use bun_install::package_manager_real::{ROOT_PACKAGE_JSON_PATH, install_with_manager};
use bun_install::resolution::Tag as ResolutionTag;
use bun_install::{CommandLineArguments, PackageManager, Subcommand};
use bun_libdeflate_sys::libdeflate;
use bun_parsers::json as bun_json;
use bun_url::URL;

use crate::cli::Command;
use crate::cli::install_command::InstallCommand;
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
    fn init() -> AuditResult {
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
        let audit_ignore_list = cli.audit_ignore_list;
        let fix = cli.positionals.len() > 1 && cli.positionals[1] == b"fix";
        if fix && cli.positionals.len() > 2 {
            Output::err_generic("bun audit fix does not take arguments", ());
            Global::exit(1);
        }
        if !fix && cli.positionals.len() > 1 {
            Output::err_generic(
                "unknown subcommand \"{s}\" for bun audit",
                (BStr::new(cli.positionals[1]),),
            );
            bun_core::note!("did you mean 'bun audit fix'?");
            Global::exit(1);
        }

        let (manager, original_cwd) = match PackageManager::init(&mut *ctx, cli, Subcommand::Audit)
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
        if fix {
            return Self::audit_fix(
                ctx,
                manager,
                json_output,
                audit_level,
                audit_ignore_list,
                &original_cwd,
            );
        }

        let code = Self::audit(ctx, manager, json_output, audit_level, audit_ignore_list)?;
        Global::exit(code);
    }

    fn audit(
        _ctx: Command::Context,
        pm: &mut PackageManager,
        json_output: bool,
        audit_level: Option<AuditLevel>,
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

        let collected = collect_packages_for_audit(pm, true)?;
        let responses = send_audit_requests(pm, &collected)?;
        let response_text = responses.response_text;

        if json_output {
            let _ = Output::writer().write_all(&response_text);
            let _ = Output::writer().write_all(b"\n");

            if response_text.is_empty() {
                return Ok(0);
            }

            return match collect_vulnerabilities(&response_text, audit_level, ignore_list)? {
                Some(vulnerabilities) => Ok(u32::from(!vulnerabilities.is_empty())),
                None => {
                    bun_core::pretty_errorln!(
                        "<red>error<r>: audit request failed to parse json. Is the registry down?"
                    );
                    Ok(1)
                }
            };
        } else if !response_text.is_empty() {
            let exit_code = print_enhanced_audit_report(
                &response_text,
                pm,
                &dependency_tree,
                audit_level,
                ignore_list,
            )?;

            audit_fix::print_unaudited(&responses.unaudited);

            return Ok(exit_code);
        } else {
            prettyln!("<green>No vulnerabilities found<r>");

            audit_fix::print_unaudited(&responses.unaudited);

            return Ok(0);
        }
    }

    fn audit_fix(
        ctx: Command::Context,
        pm: &mut PackageManager,
        json_output: bool,
        audit_level: Option<AuditLevel>,
        ignore_list: &[&[u8]],
        original_cwd: &[u8],
    ) -> crate::Result<core::convert::Infallible> {
        bun_core::pretty_error!(
            "<r><b>bun audit fix <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        );
        Output::flush();

        {
            let log_level = pm.options.log_level;
            let load_lockfile = pm.load_lockfile_from_cwd::<true>();
            PackageManagerCommand::handle_load_lockfile_errors(&load_lockfile, log_level);
        }

        audit_fix::exit_unless_lockfile_writable(pm);

        let collected = collect_packages_for_audit(pm, false)?;
        let responses = send_audit_requests(pm, &collected)?;
        let response_text = responses.response_text;

        let vulnerabilities = if response_text.is_empty() {
            Vec::new()
        } else {
            match collect_vulnerabilities(&response_text, audit_level, ignore_list)? {
                Some(vulnerabilities) => vulnerabilities,
                None => {
                    bun_core::pretty_errorln!(
                        "<red>error<r>: audit request failed to parse json. Is the registry down?"
                    );
                    Output::flush();
                    Global::exit(1);
                }
            }
        };

        if !json_output {
            audit_fix::print_unaudited(&responses.unaudited);
        }

        if vulnerabilities.is_empty() && !json_output {
            prettyln!("<green>No vulnerabilities found<r>");
            Output::flush();
            Global::exit(0);
        }

        let advisories: Vec<Advisory> = vulnerabilities
            .iter()
            .map(|vulnerability| Advisory {
                package_name: vulnerability.package_name.clone(),
                vulnerable_versions: vulnerability.vulnerable_versions.clone(),
                ignore_token: ignore_token(vulnerability),
            })
            .collect();
        let dry_run = pm.options.dry_run;
        let mut plan = audit_fix::plan_fixes(pm, &advisories)?;
        plan.unaudited = responses.unaudited;
        if !json_output {
            plan.print_sections();
        }

        if dry_run || plan.fixes.is_empty() {
            Global::exit(plan.finish_planned(json_output, dry_run));
        }

        audit_fix::prepare_install(pm, &plan)?;

        // SAFETY: `ROOT_PACKAGE_JSON_PATH` is written exactly once inside `PackageManager::init`; only read thereafter.
        let root_package_json_path = unsafe { ROOT_PACKAGE_JSON_PATH.read() };
        if let Err(e) = install_with_manager(pm, &mut *ctx, root_package_json_path, original_cwd) {
            InstallCommand::handle_error(crate::Error::from(e))?;
            Global::exit(1);
        }

        if pm.any_failed_to_install {
            Global::exit(1);
        }

        Global::exit(plan.finish_installed(&pm.lockfile, json_output));
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

struct AuditRegistry {
    href: Box<[u8]>,
    url_hash: u64,
    token: Box<[u8]>,
    auth: Box<[u8]>,
    is_default: bool,
}

impl AuditRegistry {
    fn from_scope(scope: &bun_install::npm::registry::Scope, is_default: bool) -> AuditRegistry {
        AuditRegistry {
            href: Box::<[u8]>::from(strings::without_trailing_slash(scope.url.href())),
            url_hash: scope.url_hash,
            token: scope.token.clone(),
            auth: scope.auth.clone(),
            is_default,
        }
    }
}

struct AuditRequest {
    registry: AuditRegistry,
    package_names: Vec<Box<[u8]>>,
    body: Box<[u8]>,
}

struct CollectPackagesResult {
    requests: Vec<AuditRequest>,
}

struct AuditResponses {
    response_text: Box<[u8]>,
    unaudited: Vec<audit_fix::UnauditedRegistry>,
}

struct PackageVersions {
    name: Box<[u8]>,
    versions: Vec<Box<[u8]>>,
}

fn collect_packages_for_audit(
    pm: &mut PackageManager,
    apply_omit: bool,
) -> Result<CollectPackagesResult, bun_alloc::AllocError> {
    let root_id = pm.root_package_id.get(&pm.lockfile, pm.workspace_name_hash);

    let mut groups: Vec<(AuditRegistry, Vec<PackageVersions>)> = vec![(
        AuditRegistry::from_scope(&pm.options.scope, true),
        Vec::new(),
    )];

    let features = pm.options.local_package_features;
    let omits_something = apply_omit
        && !(features.dev_dependencies
            && features.optional_dependencies
            && features.peer_dependencies);
    let wanted_packages: Option<DynamicBitSet> = omits_something.then(|| {
        reachable::packages(
            &pm.lockfile,
            pm.lockfile.buffers.resolutions.as_slice(),
            reachable::Options {
                root: root_id,
                dev: features.dev_dependencies,
                optional: features.optional_dependencies,
                peer: features.peer_dependencies,
                optional_peer: false,
                bundled: true,
                platform: None,
            },
        )
    });

    let options = &pm.options;
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

        if wanted_packages
            .as_ref()
            .is_some_and(|wanted| !wanted.is_set(idx))
        {
            continue;
        }

        let name_slice = name.slice(buf);

        let package_scope = options.scope_for_package_name(name_slice);
        let group_idx = match groups
            .iter()
            .position(|(registry, _)| registry.url_hash == package_scope.url_hash)
        {
            Some(i) => i,
            None => {
                groups.push((AuditRegistry::from_scope(package_scope, false), Vec::new()));
                groups.len() - 1
            }
        };
        let packages_list = &mut groups[group_idx].1;

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

    let requests = groups
        .into_iter()
        .enumerate()
        .filter(|(i, (_, list))| *i == 0 || !list.is_empty())
        .map(|(_, (registry, list))| AuditRequest {
            registry,
            package_names: list.iter().map(|package| package.name.clone()).collect(),
            body: build_body(&list),
        })
        .collect();

    Ok(CollectPackagesResult { requests })
}

fn build_body(packages_list: &[PackageVersions]) -> Box<[u8]> {
    let mut body: Vec<u8> = Vec::with_capacity(1024);
    body.push(b'{');

    for (pkg_idx, package) in packages_list.iter().enumerate() {
        if pkg_idx > 0 {
            body.push(b',');
        }
        write!(
            &mut body,
            "{}",
            bun_core::fmt::format_json_string_utf8(&package.name, Default::default())
        )
        .expect("unreachable");
        body.push(b':');
        body.push(b'[');
        for (ver_idx, version) in package.versions.iter().enumerate() {
            if ver_idx > 0 {
                body.push(b',');
            }
            write!(
                &mut body,
                "{}",
                bun_core::fmt::format_json_string_utf8(version, Default::default())
            )
            .expect("unreachable");
        }
        body.push(b']');
    }
    body.push(b'}');

    body.into_boxed_slice()
}

fn send_audit_requests(
    pm: &mut PackageManager,
    collected: &CollectPackagesResult,
) -> Result<AuditResponses, bun_alloc::AllocError> {
    let mut bodies: Vec<Box<[u8]>> = Vec::with_capacity(collected.requests.len());
    let mut unaudited: Vec<audit_fix::UnauditedRegistry> = Vec::new();

    for request in &collected.requests {
        match send_audit_request(pm, &request.registry, &request.body)? {
            Some(body) => bodies.push(body),
            None => unaudited.push(audit_fix::UnauditedRegistry {
                registry: request.registry.href.clone(),
                packages: request.package_names.clone(),
            }),
        }
    }

    Ok(AuditResponses {
        response_text: merge_bulk_bodies(&bodies),
        unaudited,
    })
}

fn is_empty_bulk_body(body: &[u8]) -> bool {
    let body = body.trim_ascii();
    body.is_empty()
        || body
            .strip_prefix(b"{")
            .and_then(|rest| rest.strip_suffix(b"}"))
            .is_some_and(|inner| inner.trim_ascii().is_empty())
}

fn merge_bulk_bodies(bodies: &[Box<[u8]>]) -> Box<[u8]> {
    let mut non_empty = bodies.iter().filter(|body| !is_empty_bulk_body(body));
    let Some(first) = non_empty.next() else {
        return bodies
            .iter()
            .find(|body| !body.trim_ascii().is_empty())
            .cloned()
            .unwrap_or_default();
    };
    let Some(second) = non_empty.next() else {
        return first.clone();
    };

    let mut merged: Vec<u8> = Vec::with_capacity(bodies.iter().map(|body| body.len()).sum());
    merged.push(b'{');
    for (i, body) in [first, second].into_iter().chain(non_empty).enumerate() {
        let body = body.trim_ascii();
        let inner = body
            .strip_prefix(b"{")
            .and_then(|rest| rest.strip_suffix(b"}"))
            .unwrap_or(body);
        if i > 0 {
            merged.push(b',');
        }
        merged.extend_from_slice(inner);
    }
    merged.push(b'}');
    merged.into_boxed_slice()
}

fn send_audit_request(
    pm: &mut PackageManager,
    registry: &AuditRegistry,
    body: &[u8],
) -> Result<Option<Box<[u8]>>, bun_alloc::AllocError> {
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
    if !registry.token.is_empty() {
        headers.count(b"authorization", b"");
        headers.content.cap += b"Bearer ".len() + registry.token.len();
    } else if !registry.auth.is_empty() {
        headers.count(b"authorization", b"");
        headers.content.cap += b"Basic ".len() + registry.auth.len();
    }
    headers.allocate()?;
    headers.append(b"accept", b"application/json");
    headers.append(b"content-type", b"application/json");
    headers.append(b"content-encoding", b"gzip");
    if !registry.token.is_empty() {
        headers.append_fmt(
            b"authorization",
            format_args!("Bearer {}", BStr::new(&registry.token)),
        );
    } else if !registry.auth.is_empty() {
        headers.append_fmt(
            b"authorization",
            format_args!("Basic {}", BStr::new(&registry.auth)),
        );
    }

    let mut url_str: Vec<u8> = Vec::new();
    write!(
        &mut url_str,
        "{}/-/npm/v1/security/advisories/bulk",
        BStr::new(&registry.href)
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
        &final_compressed_body,
        http_proxy,
        None,
        http::FetchRedirect::Follow,
    );
    let res = match req.send_sync(&mut response_buf) {
        Ok(r) => r,
        Err(err) => {
            if !registry.is_default {
                return Ok(None);
            }
            Output::err(err, "audit request failed", ());
            Global::crash();
        }
    };

    if res.status_code() >= 400 {
        if !registry.is_default {
            return Ok(None);
        }
        bun_core::pretty_errorln!(
            "<red>error<r>: audit request failed (status {})",
            res.status_code()
        );
        Global::crash();
    }

    let response = response_buf.list.as_slice();
    if !registry.is_default {
        let trimmed = response.trim_ascii();
        if !trimmed.is_empty() && trimmed[0] != b'{' {
            return Ok(None);
        }
    }

    Ok(Some(Box::<[u8]>::from(response)))
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

fn keep_vulnerability(
    vulnerability: &VulnerabilityInfo,
    audit_level: Option<AuditLevel>,
    ignore_list: &[&[u8]],
) -> bool {
    if let Some(level) = audit_level {
        if !level.should_include_severity(&vulnerability.severity) {
            return false;
        }
    }

    !ignore_list.iter().any(|ignored_cve| {
        strings::eql(&vulnerability.id, ignored_cve)
            || strings::index_of(&vulnerability.url, ignored_cve).is_some()
    })
}

fn ignore_token(vulnerability: &VulnerabilityInfo) -> Box<[u8]> {
    match strings::index_of(&vulnerability.url, b"GHSA-") {
        Some(i) => Box::from(&vulnerability.url[i..]),
        None => vulnerability.id.clone(),
    }
}

fn collect_vulnerabilities(
    response_text: &[u8],
    audit_level: Option<AuditLevel>,
    ignore_list: &[&[u8]],
) -> Result<Option<Vec<VulnerabilityInfo>>, bun_alloc::AllocError> {
    let source = bun_ast::Source::init_path_string(b"audit-response.json", response_text);
    let mut log = bun_ast::Log::init();

    let parsed = match bun_json::ParsedJson::parse_json(&source, &mut log) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };

    let ExprData::EObjectJSON(obj) = &parsed.root.data else {
        return Ok(None);
    };

    let mut vulnerabilities: Vec<VulnerabilityInfo> = Vec::new();
    for prop in obj.get().properties() {
        let package_name: &[u8] = prop.key.slice();

        let Some(arr) = prop.value.as_array() else {
            continue;
        };
        for vuln in arr.items() {
            let Some(vuln_obj) = vuln.as_object() else {
                continue;
            };
            let vulnerability = parse_vulnerability(package_name, vuln_obj)?;
            if keep_vulnerability(&vulnerability, audit_level, ignore_list) {
                vulnerabilities.push(vulnerability);
            }
        }
    }

    Ok(Some(vulnerabilities))
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

                        if !keep_vulnerability(&vulnerability, audit_level, ignore_list) {
                            continue;
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
            pretty!("<b>{} {}<r> (", total, audit_fix::vuln_word(total));

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
            prettyln!("To upgrade only the vulnerable packages, within their declared ranges:");
            prettyln!("  <green>bun audit fix<r>");
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
