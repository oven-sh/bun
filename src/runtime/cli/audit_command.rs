use bstr::BStr;
use std::io::Write as _;

use bun_ast::{ExprData, e as E};
use bun_collections::{DynamicBitSet, HashMap, StringHashMap, index_sort};
use bun_core::{Global, Output, pretty, prettyln};
use bun_core::{MutableString, strings};
use bun_http::{self as http, HeaderBuilder};
use bun_install::audit_fix::{self, Advisory};
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::lockfile::reachable;
use bun_install::package_manager_real::command_line_arguments::AuditLevel;
use bun_install::package_manager_real::{ROOT_PACKAGE_JSON_PATH, install_with_manager};
use bun_install::resolution::Tag as ResolutionTag;
use bun_install::{CommandLineArguments, LogLevel, PackageManager, PackageNameHash, Subcommand};
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

struct DependencyPath {
    path: Vec<Box<[u8]>>,
}

#[derive(Default)]
struct AuditStats {
    checked: usize,
    skipped: usize,
    below_level: u32,
    ignored: u32,
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

fn audit_level_name(level: AuditLevel) -> &'static str {
    match level {
        AuditLevel::Low => "low",
        AuditLevel::Moderate => "moderate",
        AuditLevel::High => "high",
        AuditLevel::Critical => "critical",
    }
}

fn print_no_vulnerabilities(stats: &AuditStats, audit_level: Option<AuditLevel>) {
    pretty!(
        "<green>No vulnerabilities found<r> <d>(checked {} package{}",
        stats.checked,
        plural(stats.checked)
    );
    if stats.below_level > 0 {
        if let Some(level) = audit_level {
            pretty!(
                ", {} below --audit-level={}",
                stats.below_level,
                audit_level_name(level)
            );
        }
    }
    if stats.ignored > 0 {
        pretty!(", {} ignored", stats.ignored);
    }
    if stats.skipped > 0 {
        pretty!(", {} skipped", stats.skipped);
    }
    pretty!(")<r> ");
    Output::print_start_end_stdout(bun_core::start_time(), bun_core::time::nano_timestamp());
    prettyln!("");
    Output::flush();
}

fn print_command_name(fix: bool) {
    bun_core::pretty!(
        "<r><b>bun audit{} <r><d>v{}<r>\n\n",
        if fix { " fix" } else { "" },
        Global::package_json_version_with_sha
    );
    Output::flush();
}

fn default_registry_href(pm: &PackageManager) -> &[u8] {
    strings::without_trailing_slash(pm.options.scope.url.href())
}

fn report_non_json_response(registry: &[u8]) {
    Output::err_generic(
        "{f} returned a non-JSON audit response",
        (bun_core::fmt::redacted_npm_url(registry),),
    );
}

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
            Output::err_generic(
                "bun audit fix does not take arguments, it always fixes the whole lockfile",
                (),
            );
            bun_core::note!("run 'bun audit --help' for more information");
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
        if !json_output && pm.options.should_print_command_name() {
            print_command_name(false);
        }

        // Note: a self-referential split borrow; encapsulated upstream as
        // `PackageManager::load_lockfile_from_cwd`.
        {
            let log_level = pm.options.log_level;
            let load_lockfile = pm.load_lockfile_from_cwd::<true>();
            PackageManagerCommand::handle_load_lockfile_errors_for(
                &load_lockfile,
                log_level,
                "audit",
            );
        }

        let dependency_tree = build_dependency_tree(pm)?;

        let collected = collect_packages_for_audit(pm, true)?;
        let responses = send_audit_requests(pm, &collected, true, json_output)?;
        let mut stats = responses.stats;
        let response_text = responses.response_text;

        if json_output {
            let _ = Output::writer().write_all(&response_text);
            let _ = Output::writer().write_all(b"\n");

            if response_text.is_empty() {
                return Ok(0);
            }

            let vulnerabilities =
                collect_vulnerabilities(&response_text, audit_level, ignore_list, &mut stats)?;
            return match vulnerabilities {
                Some(vulnerabilities) => Ok(u32::from(!vulnerabilities.is_empty())),
                None => {
                    report_non_json_response(default_registry_href(pm));
                    Ok(1)
                }
            };
        }

        if response_text.is_empty() {
            print_no_vulnerabilities(&stats, audit_level);
            return Ok(0);
        }

        print_enhanced_audit_report(
            &response_text,
            pm,
            &collected,
            &dependency_tree,
            audit_level,
            ignore_list,
            stats,
        )
    }

    fn audit_fix(
        ctx: Command::Context,
        pm: &mut PackageManager,
        json_output: bool,
        audit_level: Option<AuditLevel>,
        ignore_list: &[&[u8]],
        original_cwd: &[u8],
    ) -> crate::Result<core::convert::Infallible> {
        if !json_output && pm.options.should_print_command_name() {
            print_command_name(true);
        }

        {
            let log_level = pm.options.log_level;
            let load_lockfile = pm.load_lockfile_from_cwd::<true>();
            PackageManagerCommand::handle_load_lockfile_errors_for(
                &load_lockfile,
                log_level,
                "audit",
            );
        }

        audit_fix::exit_unless_lockfile_matches_package_json(pm)?;
        audit_fix::exit_unless_lockfile_writable(pm);

        let first = audit_for_fix(pm, audit_level, ignore_list, true)?;

        if first.advisories.is_empty() && !json_output {
            if pm.options.log_level != LogLevel::Silent {
                print_no_vulnerabilities(&first.stats, audit_level);
            }
            Global::exit(0);
        }

        let dry_run = pm.options.dry_run;
        let mut plan = audit_fix::plan_fixes(pm, &first.advisories)?;
        plan.unaudited = first.unaudited;
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

        let reaudit = audit_for_fix(pm, audit_level, ignore_list, false)?;
        if json_output {
            plan.unaudited = reaudit.unaudited;
        }
        Global::exit(plan.finish_installed(&pm.lockfile, &reaudit.advisories, json_output));
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
    authorization: Option<Vec<u8>>,
    is_default: bool,
}

impl AuditRegistry {
    fn from_scope(scope: &bun_install::npm::registry::Scope, is_default: bool) -> AuditRegistry {
        AuditRegistry {
            href: Box::<[u8]>::from(strings::without_trailing_slash(scope.url.href())),
            url_hash: scope.url_hash,
            authorization: scope.authorization(),
            is_default,
        }
    }
}

struct AuditRequest {
    registry: AuditRegistry,
    packages: Vec<PackageVersions>,
    body: Box<[u8]>,
}

struct CollectPackagesResult {
    requests: Vec<AuditRequest>,
}

impl CollectPackagesResult {
    fn installed_versions(&self, name: &[u8]) -> &[Box<[u8]>] {
        match self
            .requests
            .iter()
            .flat_map(|request| request.packages.iter())
            .find(|package| *package.name == *name)
        {
            Some(package) => package.versions.as_slice(),
            None => &[],
        }
    }
}

struct AuditResponses {
    response_text: Box<[u8]>,
    unaudited: Vec<audit_fix::UnauditedRegistry>,
    stats: AuditStats,
}

struct FixAudit {
    advisories: Vec<Advisory>,
    unaudited: Vec<audit_fix::UnauditedRegistry>,
    stats: AuditStats,
}

struct PackageVersions {
    name: Box<[u8]>,
    versions: Vec<Box<[u8]>>,
}

enum SkipReason {
    Status(u32),
    Send(&'static str),
    NotJson,
}

impl core::fmt::Display for SkipReason {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            SkipReason::Status(status) => write!(f, "{status}"),
            SkipReason::Send(name) => f.write_str(name),
            SkipReason::NotJson => f.write_str("non-JSON response"),
        }
    }
}

fn unaudited(request: &AuditRequest, reason: &SkipReason) -> audit_fix::UnauditedRegistry {
    let mut reason_text: Vec<u8> = Vec::new();
    write!(&mut reason_text, "{reason}").expect("unreachable");
    let registry = URL::parse(&request.registry.href).href_without_auth();
    audit_fix::UnauditedRegistry {
        registry: Box::from(strings::without_trailing_slash(&registry)),
        packages: request
            .packages
            .iter()
            .map(|package| package.name.clone())
            .collect(),
        reason: reason_text.into_boxed_slice(),
    }
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
    let pkg_name_hashes = packages.items_name_hash();
    let pkg_resolutions = packages.items_resolution();
    let buf = pm.lockfile.buffers.string_bytes.as_slice();

    let mut by_name: HashMap<PackageNameHash, (usize, usize)> =
        HashMap::with_capacity(pkg_names.len());
    let mut ver_scratch: Vec<u8> = Vec::new();

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

        let (group_idx, list_idx) = match by_name.get(&pkg_name_hashes[idx]) {
            Some(&found) => found,
            None => {
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
                packages_list.push(PackageVersions {
                    name: Box::<[u8]>::from(name_slice),
                    versions: Vec::new(),
                });
                let found = (group_idx, packages_list.len() - 1);
                by_name.put(pkg_name_hashes[idx], found)?;
                found
            }
        };
        let found_package = &mut groups[group_idx].1[list_idx];

        ver_scratch.clear();
        // `res.tag == ResolutionTag::Npm` checked above.
        let npm = *res.npm();
        write!(&mut ver_scratch, "{}", npm.version.fmt(buf)).expect("unreachable");

        let version_exists = found_package
            .versions
            .iter()
            .any(|existing| existing.as_ref() == ver_scratch.as_slice());

        if !version_exists {
            found_package
                .versions
                .push(Box::<[u8]>::from(ver_scratch.as_slice()));
        }
    }

    let requests = groups
        .into_iter()
        .enumerate()
        .filter(|(i, (_, list))| *i == 0 || !list.is_empty())
        .map(|(_, (registry, list))| AuditRequest {
            registry,
            body: build_body(&list),
            packages: list,
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
    warn: bool,
    echo_non_json: bool,
) -> Result<AuditResponses, bun_alloc::AllocError> {
    let mut bodies: Vec<Box<[u8]>> = Vec::with_capacity(collected.requests.len());
    let mut unaudited_registries: Vec<audit_fix::UnauditedRegistry> = Vec::new();
    let mut stats = AuditStats::default();

    for request in &collected.requests {
        match send_audit_request(pm, &request.registry, &request.body, echo_non_json)? {
            Ok(body) => {
                stats.checked += request.packages.len();
                bodies.push(body);
            }
            Err(reason) => {
                stats.skipped += request.packages.len();
                unaudited_registries.push(unaudited(request, &reason));
            }
        }
    }

    if warn && pm.options.log_level != LogLevel::Silent {
        audit_fix::print_unaudited(&unaudited_registries);
    }

    Ok(AuditResponses {
        response_text: merge_bulk_bodies(&bodies),
        unaudited: unaudited_registries,
        stats,
    })
}

fn audit_for_fix(
    pm: &mut PackageManager,
    audit_level: Option<AuditLevel>,
    ignore_list: &[&[u8]],
    warn: bool,
) -> Result<FixAudit, bun_alloc::AllocError> {
    let collected = collect_packages_for_audit(pm, false)?;
    let responses = send_audit_requests(pm, &collected, warn, false)?;
    let mut stats = responses.stats;

    let vulnerabilities = if responses.response_text.is_empty() {
        Vec::new()
    } else {
        match collect_vulnerabilities(
            &responses.response_text,
            audit_level,
            ignore_list,
            &mut stats,
        )? {
            Some(vulnerabilities) => vulnerabilities,
            None => {
                report_non_json_response(default_registry_href(pm));
                Global::exit(1);
            }
        }
    };

    Ok(FixAudit {
        advisories: vulnerabilities.into_iter().map(to_advisory).collect(),
        unaudited: responses.unaudited,
        stats,
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
    echo_non_json: bool,
) -> Result<Result<Box<[u8]>, SkipReason>, bun_alloc::AllocError> {
    libdeflate::load();
    let mut compressor = libdeflate::OwnedCompressor::new(6).ok_or(bun_alloc::AllocError)?;

    let mut compressed_body = Vec::new();
    let _ = compressor.compress_to_vec(body, &mut compressed_body, libdeflate::Encoding::Gzip)?;
    drop(compressor);
    let final_compressed_body = compressed_body;

    let mut headers = HeaderBuilder::default();
    headers.count(b"accept", b"application/json");
    headers.count(b"content-type", b"application/json");
    headers.count(b"content-encoding", b"gzip");
    if let Some(authorization) = &registry.authorization {
        headers.count(b"authorization", authorization);
    }
    headers.allocate()?;
    headers.append(b"accept", b"application/json");
    headers.append(b"content-type", b"application/json");
    headers.append(b"content-encoding", b"gzip");
    if let Some(authorization) = &registry.authorization {
        headers.append(b"authorization", authorization);
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
        http::FetchRedirect::Follow,
    );
    let reason = match req.send_sync(&mut response_buf) {
        Ok(res) if res.status_code() >= 400 => SkipReason::Status(res.status_code()),
        Ok(_) => {
            let response = response_buf.list.as_slice();
            let trimmed = response.trim_ascii();
            if trimmed.is_empty() || trimmed[0] == b'{' {
                return Ok(Ok(Box::<[u8]>::from(response)));
            }
            SkipReason::NotJson
        }
        Err(err) => SkipReason::Send(err.name()),
    };

    if !registry.is_default {
        return Ok(Err(reason));
    }
    match reason {
        SkipReason::NotJson => {
            if echo_non_json {
                let _ = Output::writer().write_all(response_buf.list.as_slice());
                let _ = Output::writer().write_all(b"\n");
                Output::flush();
            }
            report_non_json_response(&registry.href);
        }
        reason => {
            bun_core::pretty_errorln!(
                "<r><red>error<r><d>:<r> <red><b>POST<r><red> {}<d> - {}<r>",
                bun_core::fmt::redacted_npm_url(&url_str),
                reason
            );
        }
    }
    Global::exit(1);
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

            // Walks dependent → dependency, so the path reads root-most first and ends at the vulnerable package.
            loop {
                if seen_in_trace.contains_key(&*trace) {
                    break;
                }

                path.path.push(trace.clone());
                seen_in_trace.put(&trace, ())?;

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
    stats: &mut AuditStats,
) -> bool {
    if let Some(level) = audit_level {
        if !level.should_include_severity(&vulnerability.severity) {
            stats.below_level += 1;
            return false;
        }
    }

    let ignored = ignore_list.iter().any(|ignored_cve| {
        strings::eql(&vulnerability.id, ignored_cve)
            || strings::index_of(&vulnerability.url, ignored_cve).is_some()
    });
    if ignored {
        stats.ignored += 1;
    }
    !ignored
}

fn ignore_token(vulnerability: &VulnerabilityInfo) -> Box<[u8]> {
    match strings::index_of(&vulnerability.url, b"GHSA-") {
        Some(i) => Box::from(&vulnerability.url[i..]),
        None => vulnerability.id.clone(),
    }
}

fn to_advisory(vulnerability: VulnerabilityInfo) -> Advisory {
    let ignore_token = ignore_token(&vulnerability);
    Advisory {
        package_name: vulnerability.package_name,
        vulnerable_versions: vulnerability.vulnerable_versions,
        ignore_token,
    }
}

fn collect_vulnerabilities(
    response_text: &[u8],
    audit_level: Option<AuditLevel>,
    ignore_list: &[&[u8]],
    stats: &mut AuditStats,
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
            if keep_vulnerability(&vulnerability, audit_level, ignore_list, stats) {
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

fn print_severity(severity: &[u8]) {
    match severity {
        b"critical" => pretty!("  <red>critical<d>:<r>"),
        b"high" => pretty!("  <red>high<d>:<r>"),
        b"low" => pretty!("  <cyan>low<d>:<r>"),
        _ => pretty!("  <yellow>moderate<d>:<r>"),
    }
}

fn print_package_heading(name: &[u8], installed: &[Box<[u8]>]) {
    pretty!("<red>{}<r>", BStr::new(name));
    for (i, version) in installed.iter().enumerate() {
        pretty!("{}{}", if i == 0 { "@" } else { ", " }, BStr::new(version));
    }
    prettyln!("");
}

fn print_dependency_path(path: &DependencyPath, separator: &str) {
    let Some((vulnerable_pkg, dependents)) = path.path.split_last() else {
        return;
    };
    if dependents.is_empty() {
        prettyln!("  <d>(direct dependency)<r>");
        return;
    }
    let mut via: Vec<u8> = Vec::new();
    for (i, item) in dependents.iter().enumerate() {
        if i > 0 {
            via.push(b' ');
            via.extend_from_slice(separator.as_bytes());
            via.push(b' ');
        }
        via.extend_from_slice(item);
    }
    prettyln!(
        "  <d>{} {}<r> <red>{}<r>",
        BStr::new(&via),
        separator,
        BStr::new(vulnerable_pkg)
    );
}

fn print_enhanced_audit_report(
    response_text: &[u8],
    pm: &mut PackageManager,
    collected: &CollectPackagesResult,
    dependency_tree: &StringHashMap<Vec<Box<[u8]>>>,
    audit_level: Option<AuditLevel>,
    ignore_list: &[&[u8]],
    mut stats: AuditStats,
) -> Result<u32, bun_alloc::AllocError> {
    let Some(mut vulnerabilities) =
        collect_vulnerabilities(response_text, audit_level, ignore_list, &mut stats)?
    else {
        report_non_json_response(default_registry_href(pm));
        return Ok(1);
    };

    if vulnerabilities.is_empty() {
        print_no_vulnerabilities(&stats, audit_level);
        return Ok(0);
    }

    let mut vuln_counts = VulnCounts::default();
    for vulnerability in &vulnerabilities {
        match &*vulnerability.severity {
            b"low" => vuln_counts.low += 1,
            b"high" => vuln_counts.high += 1,
            b"critical" => vuln_counts.critical += 1,
            _ => vuln_counts.moderate += 1,
        }
    }
    let total = vulnerabilities.len() as u32;

    index_sort::sort_vec_by(&mut vulnerabilities, |a, b| {
        strings::order(&a.package_name, &b.package_name)
    });

    let separator = if Output::enable_ansi_colors_stdout() {
        "›"
    } else {
        ">"
    };

    let mut rest: &[VulnerabilityInfo] = &vulnerabilities;
    while let Some(first) = rest.first() {
        let package_name: &[u8] = &first.package_name;
        let run_len = rest
            .iter()
            .take_while(|vulnerability| *vulnerability.package_name == *package_name)
            .count();
        let (group, tail) = rest.split_at(run_len);
        rest = tail;

        print_package_heading(package_name, collected.installed_versions(package_name));

        for path in &find_dependency_paths(package_name, dependency_tree, pm)? {
            print_dependency_path(path, separator);
        }

        for vuln in group {
            if vuln.title.is_empty() {
                continue;
            }
            print_severity(&vuln.severity);
            pretty!(" {}", BStr::new(&vuln.title));
            if !vuln.vulnerable_versions.is_empty() {
                pretty!(" <d>({})<r>", BStr::new(&vuln.vulnerable_versions));
            }
            prettyln!(" - <d>{}<r>", BStr::new(&vuln.url));
        }

        prettyln!("");
    }

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
    prettyln!(
        "  <cyan>bun audit fix<r>           <d>upgrade the vulnerable packages within their ranges<r>"
    );
    prettyln!("  <cyan>bun audit fix --latest<r>  <d>also cross major versions<r>");
    Output::flush();

    Ok(1)
}
