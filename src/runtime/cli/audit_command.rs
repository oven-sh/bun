use bstr::BStr;
use std::io::Write as _;

use bun_ast::{ExprData, e as E};
use bun_collections::{DynamicBitSet, HashMap, StringHashMap, index_sort};
use bun_core::fmt::escape_control_chars;
use bun_core::{Global, Output, pretty, prettyln};
use bun_core::{MutableString, strings};
use bun_http::{self as http, HeaderBuilder};
use bun_install::audit_fix::{self, Advisory};
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::lockfile::reachable;
use bun_install::package_manager_real::command_line_arguments::AuditLevel;
use bun_install::package_manager_real::{ROOT_PACKAGE_JSON_PATH, install_with_manager};
use bun_install::resolution::Tag as ResolutionTag;
use bun_install::{
    CommandLineArguments, Dependency, LogLevel, PackageManager, PackageNameHash, Subcommand,
};
use bun_libdeflate_sys::libdeflate;
use bun_parsers::json as bun_json;
use bun_url::URL;

use crate::cli::Command;
use crate::cli::install_command::InstallCommand;
use crate::cli::package_manager_command::PackageManagerCommand;

enum Severity {
    /// Below every `--audit-level`: npm, pnpm and yarn rank `info` under `low`.
    Info,
    Ranked(AuditLevel),
    /// The registry's word, empty when it sent none. Never below an `--audit-level`.
    Unranked(Box<[u8]>),
}

struct VulnerabilityInfo {
    severity: Severity,
    title: Box<[u8]>,
    url: Box<[u8]>,
    vulnerable_versions: Box<[u8]>,
    id: Box<[u8]>,
    package_name: Box<[u8]>,
}

/// Root-most first, ending at the vulnerable package.
type DependencyPath = Vec<Box<[u8]>>;

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
                level.name()
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

fn default_registry_href(pm: &PackageManager) -> &[u8] {
    strings::without_trailing_slash(pm.options.scope.url.href())
}

fn report_bad_response(registry: &[u8], reason: &SkipReason) {
    Output::err_generic(
        match reason {
            SkipReason::NotAdvisories => {
                "invalid audit response from {f}: not a list of advisories"
            }
            SkipReason::Empty => "empty audit response from {f}",
            _ => "{f} returned a non-JSON audit response",
        },
        (bun_core::fmt::redacted_npm_url(registry),),
    );
}

pub(crate) struct AuditCommand;

impl AuditCommand {
    pub(crate) fn exec(ctx: Command::Context) -> crate::Result<core::convert::Infallible> {
        let cli = CommandLineArguments::parse(Subcommand::Audit)?;
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

        let (manager, original_cwd) = match PackageManager::init(ctx, &cli, Subcommand::Audit) {
            Ok(v) => v,
            Err(err) => {
                if err == bun_install::Error::MissingPackageJSON {
                    let mut cwd_buf = bun_paths::path_buffer_pool::get();
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
        if !json_output && manager.options.should_print_command_name() {
            bun_core::pretty!(
                "<r><b>bun audit{} <r><d>v{}<r>\n\n",
                if fix { " fix" } else { "" },
                Global::package_json_version_with_sha
            );
            Output::flush();
        }

        {
            let log_level = manager.options.log_level;
            let load_lockfile = manager.load_lockfile_from_cwd::<true>();
            PackageManagerCommand::handle_load_lockfile_errors_for(
                &load_lockfile,
                log_level,
                "audit",
            );
        }

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

        let code = Self::audit(manager, json_output, audit_level, audit_ignore_list)?;
        Global::exit(code);
    }

    fn audit(
        pm: &mut PackageManager,
        json_output: bool,
        audit_level: Option<AuditLevel>,
        ignore_list: &[&[u8]],
    ) -> Result<u32, bun_alloc::AllocError> {
        let dependency_tree = build_dependency_tree(pm)?;

        let collected = collect_packages_for_audit(pm, true)?;
        let responses = send_audit_requests(pm, &collected, true, json_output)?;
        let mut stats = responses.stats;
        let response_text = responses.response_text;

        if json_output {
            let vulnerabilities =
                collect_vulnerabilities(&response_text, audit_level, ignore_list, &mut stats)?;
            if !matches!(vulnerabilities, Err(SkipReason::NotJson)) {
                let _ = Output::writer().write_all(&response_text);
                let _ = Output::writer().write_all(b"\n");
            }
            return Ok(match vulnerabilities {
                Ok(vulnerabilities) => u32::from(!vulnerabilities.is_empty()),
                Err(reason) => {
                    report_bad_response(default_registry_href(pm), &reason);
                    1
                }
            });
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

        // Audit the saved lockfile, which is what the next `bun audit` reads. The copy in memory
        // can contain a package that was not saved.
        pm.load_lockfile_from_cwd_or_exit("nothing to audit");
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
            authorization: scope.authorization(&scope.url.url()),
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
    Empty,
    NotJson,
    NotAdvisories,
}

impl core::fmt::Display for SkipReason {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            SkipReason::Status(status) => write!(f, "{status}"),
            SkipReason::Send(name) => f.write_str(name),
            SkipReason::Empty => f.write_str("empty response"),
            SkipReason::NotJson => f.write_str("non-JSON response"),
            SkipReason::NotAdvisories => f.write_str("not a list of advisories"),
        }
    }
}

fn unaudited(request: &AuditRequest, reason: &SkipReason) -> audit_fix::UnauditedRegistry {
    let registry = URL::parse(&request.registry.href).href_without_auth();
    audit_fix::UnauditedRegistry {
        registry: Box::from(strings::without_trailing_slash(&registry)),
        packages: request
            .packages
            .iter()
            .map(|package| package.name.clone())
            .collect(),
        reason: reason.to_string().into_bytes().into_boxed_slice(),
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
        if idx as u32 == root_id
            || res.tag != ResolutionTag::Npm
            || (wanted_packages.as_ref()).is_some_and(|wanted| !wanted.is_set(idx))
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
        write!(&mut ver_scratch, "{}", res.npm().version.fmt(buf)).expect("unreachable");

        let versions = &mut found_package.versions;
        if !versions.iter().any(|existing| **existing == *ver_scratch) {
            versions.push(Box::<[u8]>::from(ver_scratch.as_slice()));
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
    echo_json: bool,
) -> Result<AuditResponses, bun_alloc::AllocError> {
    let mut bodies: Vec<Box<[u8]>> = Vec::with_capacity(collected.requests.len());
    let mut unaudited_registries: Vec<audit_fix::UnauditedRegistry> = Vec::new();
    let mut stats = AuditStats::default();

    for request in &collected.requests {
        match send_audit_request(pm, &request.registry, &request.body, echo_json)? {
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

    let vulnerabilities = match collect_vulnerabilities(
        &responses.response_text,
        audit_level,
        ignore_list,
        &mut stats,
    )? {
        Ok(vulnerabilities) => vulnerabilities,
        Err(reason) => {
            report_bad_response(default_registry_href(pm), &reason);
            Global::exit(1);
        }
    };

    Ok(FixAudit {
        advisories: vulnerabilities.into_iter().map(to_advisory).collect(),
        unaudited: responses.unaudited,
        stats,
    })
}

fn is_empty_bulk_body(body: &[u8]) -> bool {
    (body.trim_ascii().strip_prefix(b"{"))
        .and_then(|rest| rest.strip_suffix(b"}"))
        .is_some_and(|inner| inner.trim_ascii().is_empty())
}

fn merge_bulk_bodies(bodies: &[Box<[u8]>]) -> Box<[u8]> {
    let mut non_empty = bodies.iter().filter(|body| !is_empty_bulk_body(body));
    let Some(first) = non_empty.next() else {
        return bodies.first().cloned().unwrap_or_default();
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
    echo_json: bool,
) -> Result<Result<Box<[u8]>, SkipReason>, bun_alloc::AllocError> {
    libdeflate::load();
    let mut compressor = libdeflate::OwnedCompressor::new(6).ok_or(bun_alloc::AllocError)?;

    let mut compressed_body = Vec::new();
    let _ = compressor.compress_to_vec(body, &mut compressed_body, libdeflate::Encoding::Gzip)?;
    drop(compressor);

    let mut pairs: Vec<(&[u8], &[u8])> = vec![
        (b"accept", b"application/json"),
        (b"content-type", b"application/json"),
        (b"content-encoding", b"gzip"),
    ];
    if let Some(authorization) = &registry.authorization {
        pairs.push((b"authorization", authorization));
    }
    let headers = HeaderBuilder::from_pairs(&pairs)?;

    let url_str = format!(
        "{}/-/npm/v1/security/advisories/bulk",
        BStr::new(&registry.href)
    )
    .into_bytes();

    let mut response_buf = MutableString::init(1024)?;
    let mut req = pm.registry_request(
        http::Method::POST,
        URL::parse(&url_str),
        headers.entries,
        headers.content.written_slice(),
        &compressed_body,
    );
    // A registry URL that is not http(s) is a configuration error, not a registry without an audit endpoint.
    let mut is_fatal = registry.is_default;
    // This POST is safe to retry, because it changes nothing on the registry.
    let reason = match pm.send_with_retries(&mut req, &mut response_buf) {
        Ok(res) if res.status_code() >= 400 => SkipReason::Status(res.status_code()),
        Ok(_) => {
            let response = response_buf.list.as_slice();
            // Before the bodies are merged, so that the registry that sent this one is named.
            match collect_vulnerabilities(response, None, &[], &mut AuditStats::default())? {
                Ok(_) => return Ok(Ok(Box::<[u8]>::from(response))),
                Err(reason) => reason,
            }
        }
        Err(err) => {
            is_fatal |= err == http::Error::UnsupportedProtocol;
            SkipReason::Send(err.name())
        }
    };

    if !is_fatal {
        return Ok(Err(reason));
    }
    match reason {
        SkipReason::Empty | SkipReason::NotJson | SkipReason::NotAdvisories => {
            if echo_json && matches!(reason, SkipReason::NotAdvisories) {
                let _ = Output::writer().write_all(response_buf.list.as_slice());
                let _ = Output::writer().write_all(b"\n");
                Output::flush();
            }
            report_bad_response(&registry.href, &reason);
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

fn parse_vulnerability(package_name: &[u8], vuln: &E::ObjectJSON) -> VulnerabilityInfo {
    let mut vulnerability = VulnerabilityInfo {
        severity: Severity::Unranked(Box::default()),
        title: Box::<[u8]>::from(b"Vulnerability found" as &[u8]),
        url: Box::default(),
        vulnerable_versions: Box::default(),
        id: Box::default(),
        package_name: Box::<[u8]>::from(package_name),
    };

    for prop in vuln.properties() {
        let field_name: &[u8] = prop.key.slice();
        match &prop.value {
            E::JsonValue::String(val_str) if field_name == b"severity" => {
                let word = val_str.slice();
                vulnerability.severity = match AuditLevel::from_string(word) {
                    Some(level) => Severity::Ranked(level),
                    None if word == b"info" => Severity::Info,
                    None => Severity::Unranked(Box::<[u8]>::from(word)),
                };
            }
            E::JsonValue::String(val_str) => {
                let field = match field_name {
                    // Keeps the default title: the report has a line for every counted advisory.
                    b"title" if val_str.slice().is_empty() => continue,
                    b"title" => &mut vulnerability.title,
                    b"url" => &mut vulnerability.url,
                    b"vulnerable_versions" => &mut vulnerability.vulnerable_versions,
                    b"id" => &mut vulnerability.id,
                    _ => continue,
                };
                *field = Box::<[u8]>::from(val_str.slice());
            }
            E::JsonValue::Number(num) if field_name == b"id" => {
                vulnerability.id = (num.value() as u64).to_string().into_bytes().into();
            }
            _ => {}
        }
    }

    vulnerability
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

    let dep_slice = pkg_deps[root_id as usize].get(dependencies);
    let workspaces: Vec<(&[u8], &[Dependency])> = (pkg_resolutions.iter())
        .zip(pkg_deps.iter())
        .zip(pkg_names.iter())
        .filter(|((resolution, _), _)| resolution.tag == ResolutionTag::Workspace)
        .map(|((_, deps), pkg_name)| (pkg_name.slice(buf), deps.get(dependencies)))
        .collect();
    let depends_on = |deps: &[Dependency], name: &[u8]| {
        (deps.iter()).any(|dependency| dependency.name.slice(buf) == name)
    };
    let workspace_prefix = |workspace_name: &[u8]| -> Box<[u8]> {
        format!("workspace:{}", BStr::new(workspace_name))
            .into_bytes()
            .into()
    };

    if depends_on(dep_slice, target_package) {
        paths.push(vec![Box::<[u8]>::from(target_package)]);
    }

    for &(workspace_name, workspace_deps) in &workspaces {
        if depends_on(workspace_deps, target_package) {
            paths.push(vec![
                workspace_prefix(workspace_name),
                Box::<[u8]>::from(target_package),
            ]);
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

        let workspace_name_for_dep: Option<&[u8]> = (workspaces.iter())
            .find(|(_, workspace_deps)| depends_on(workspace_deps, &current))
            .map(|&(workspace_name, _)| workspace_name);

        if depends_on(dep_slice, &current) || workspace_name_for_dep.is_some() {
            let mut path = DependencyPath::new();

            let mut trace: Box<[u8]> = current;
            let mut seen_in_trace: StringHashMap<()> = StringHashMap::default();

            // Walks dependent → dependency.
            loop {
                if seen_in_trace.contains_key(&*trace) {
                    break;
                }

                path.push(trace.clone());
                seen_in_trace.put(&trace, ())?;

                if let Some(parent) = parent_map.get(&*trace) {
                    trace.clone_from(parent);
                } else {
                    break;
                }
            }

            if let Some(workspace_name) = workspace_name_for_dep {
                path.insert(0, workspace_prefix(workspace_name));
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
        let below = match &vulnerability.severity {
            Severity::Info => true,
            Severity::Ranked(rank) => *rank < level,
            Severity::Unranked(_) => false,
        };
        if below {
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

fn to_advisory(vulnerability: VulnerabilityInfo) -> Advisory {
    Advisory {
        ignore_token: match strings::index_of(&vulnerability.url, b"GHSA-") {
            Some(i) => Box::from(&vulnerability.url[i..]),
            None => vulnerability.id,
        },
        package_name: vulnerability.package_name,
        vulnerable_versions: vulnerability.vulnerable_versions,
    }
}

fn collect_vulnerabilities(
    response_text: &[u8],
    audit_level: Option<AuditLevel>,
    ignore_list: &[&[u8]],
    stats: &mut AuditStats,
) -> Result<Result<Vec<VulnerabilityInfo>, SkipReason>, bun_alloc::AllocError> {
    // An empty body (also from a 204 or 304) does not mean "no advisories", even though the parser
    // would read it as `{}`.
    if response_text.trim_ascii().is_empty() {
        return Ok(Err(SkipReason::Empty));
    }

    let source = bun_ast::Source::init_path_string(b"audit-response.json", response_text);
    let mut log = bun_ast::Log::init();

    let parsed = match bun_json::ParsedJson::parse_json(&source, &mut log) {
        Ok(e) => e,
        Err(_) => return Ok(Err(SkipReason::NotJson)),
    };

    // The bulk endpoint responds with `{ [package name]: Advisory[] }`. Any other response doesn't
    // count as a clean audit.
    let ExprData::EObjectJSON(obj) = &parsed.root.data else {
        return Ok(Err(SkipReason::NotAdvisories));
    };

    let mut vulnerabilities: Vec<VulnerabilityInfo> = Vec::new();
    for prop in obj.get().properties() {
        let package_name: &[u8] = prop.key.slice();

        let Some(arr) = prop.value.as_array() else {
            return Ok(Err(SkipReason::NotAdvisories));
        };
        for vuln in arr.items() {
            let Some(vuln_obj) = vuln.as_object() else {
                return Ok(Err(SkipReason::NotAdvisories));
            };
            let vulnerability = parse_vulnerability(package_name, vuln_obj);
            if keep_vulnerability(&vulnerability, audit_level, ignore_list, stats) {
                vulnerabilities.push(vulnerability);
            }
        }
    }

    Ok(Ok(vulnerabilities))
}

const UNRANKED_LABEL: &str = "unknown severity";

fn print_severity(severity: &Severity) {
    match severity {
        Severity::Info => pretty!("  info<d>:<r>"),
        Severity::Ranked(level) => match level {
            AuditLevel::Critical | AuditLevel::High => {
                pretty!("  <red>{}<d>:<r>", level.name())
            }
            AuditLevel::Moderate => pretty!("  <yellow>{}<d>:<r>", level.name()),
            AuditLevel::Low => pretty!("  <cyan>{}<d>:<r>", level.name()),
        },
        Severity::Unranked(word) if word.is_empty() => {
            pretty!("  <red>{}<d>:<r>", UNRANKED_LABEL)
        }
        Severity::Unranked(word) => pretty!(
            "  <red>{}<r> <d>({}):<r>",
            UNRANKED_LABEL,
            escape_control_chars(word)
        ),
    }
}

fn print_package_heading(name: &[u8], installed: &[Box<[u8]>]) {
    pretty!("<red>{}<r>", escape_control_chars(name));
    for (i, version) in installed.iter().enumerate() {
        let separator = if i == 0 { "@" } else { ", " };
        pretty!("{}{}", separator, escape_control_chars(version));
    }
    prettyln!("");
}

fn print_dependency_path(path: &[Box<[u8]>], separator: &str) {
    let Some((vulnerable_pkg, dependents)) = path.split_last() else {
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
        escape_control_chars(&via),
        separator,
        escape_control_chars(vulnerable_pkg)
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
    let mut vulnerabilities =
        match collect_vulnerabilities(response_text, audit_level, ignore_list, &mut stats)? {
            Ok(vulnerabilities) => vulnerabilities,
            Err(reason) => {
                report_bad_response(default_registry_href(pm), &reason);
                return Ok(1);
            }
        };

    if vulnerabilities.is_empty() {
        print_no_vulnerabilities(&stats, audit_level);
        return Ok(0);
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

    for group in vulnerabilities.chunk_by(|a, b| a.package_name == b.package_name) {
        let package_name: &[u8] = &group[0].package_name;

        print_package_heading(package_name, collected.installed_versions(package_name));

        for path in &find_dependency_paths(package_name, dependency_tree, pm)? {
            print_dependency_path(path, separator);
        }

        for vuln in group {
            print_severity(&vuln.severity);
            pretty!(" {}", escape_control_chars(&vuln.title));
            if !vuln.vulnerable_versions.is_empty() {
                let versions = escape_control_chars(&vuln.vulnerable_versions);
                pretty!(" <d>({})<r>", versions);
            }
            prettyln!(" - <d>{}<r>", escape_control_chars(&vuln.url));
        }

        prettyln!("");
    }

    pretty!("<b>{} {}<r> (", total, audit_fix::vuln_word(total));

    let count = |wanted: &dyn Fn(&Severity) -> bool| {
        (vulnerabilities.iter())
            .filter(|vulnerability| wanted(&vulnerability.severity))
            .count()
    };
    let mut separator = "";
    for level in [
        AuditLevel::Critical,
        AuditLevel::High,
        AuditLevel::Moderate,
        AuditLevel::Low,
    ] {
        let count = count(&|severity| matches!(severity, Severity::Ranked(rank) if *rank == level));
        if count == 0 {
            continue;
        }
        pretty!("{}", separator);
        match level {
            AuditLevel::Critical => pretty!("<red><b>{} {}<r>", count, level.name()),
            AuditLevel::High => pretty!("<red>{} {}<r>", count, level.name()),
            AuditLevel::Moderate => pretty!("<yellow>{} {}<r>", count, level.name()),
            AuditLevel::Low => pretty!("<cyan>{} {}<r>", count, level.name()),
        }
        separator = ", ";
    }
    let info = count(&|severity| matches!(severity, Severity::Info));
    if info > 0 {
        pretty!("{}{} info", separator, info);
        separator = ", ";
    }
    let unranked = count(&|severity| matches!(severity, Severity::Unranked(_)));
    if unranked > 0 {
        pretty!("{}<red>{} {}<r>", separator, unranked, UNRANKED_LABEL);
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
