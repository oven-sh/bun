//! `bun pm sbom` - generate a Software Bill of Materials (SBOM) from the lockfile.
//!
//! Supports two output formats:
//!   - CycloneDX 1.7 (default): <https://cyclonedx.org/>
//!   - SPDX 2.3: <https://spdx.dev/>

use std::collections::HashSet;
use std::io::Write as _;
use std::time::{SystemTime, UNIX_EPOCH};

use bun_core::fmt::PathSep;
use bun_core::{Global, Output, strings};
use bun_install::integrity::{Integrity, Tag as IntegrityTag};
use bun_install::lockfile::{Lockfile, package::PackageColumns as _};
use bun_install::resolution::Tag as ResolutionTag;
use bun_install::{ExternalSlice, INVALID_PACKAGE_ID, PackageID, PackageManager};
use bun_jsc::uuid::UUID;
use bun_paths::{PathBuffer, platform, resolve_path};
use bun_sys::Fd;

use crate::cli::package_manager_command::PackageManagerCommand;
use crate::command;

pub enum PmSbomCommand {}

#[derive(Clone, Copy)]
enum Format {
    CycloneDX,
    Spdx,
}

impl Format {
    fn from_bytes(s: &[u8]) -> Option<Format> {
        if s == b"cyclonedx" {
            Some(Format::CycloneDX)
        } else if s == b"spdx" {
            Some(Format::Spdx)
        } else {
            None
        }
    }
}

impl PmSbomCommand {
    pub fn exec(
        _ctx: &command::Context,
        pm: &mut PackageManager,
        original_cwd: &[u8],
    ) -> Result<(), bun_core::Error> {
        let format = match pm.options.sbom_format {
            Some(f) => match Format::from_bytes(f) {
                Some(fmt) => fmt,
                None => {
                    Output::err_generic("invalid --format value: '{s}'", (bstr::BStr::new(f),));
                    Output::note("valid values are 'cyclonedx' or 'spdx'");
                    Global::exit(1);
                }
            },
            None => Format::CycloneDX,
        };

        let outfile: Option<&[u8]> = pm.options.sbom_outfile;

        if pm.options.positionals.len() > 1 {
            Output::err_generic(
                "unexpected argument: '{s}'",
                (bstr::BStr::new(pm.options.positionals[1]),),
            );
            Output::flush();
            Self::print_help();
            Global::exit(1);
        }

        {
            let log_level = pm.options.log_level;
            let load_lockfile = pm.load_lockfile_from_cwd::<true>();
            PackageManagerCommand::handle_load_lockfile_errors(&load_lockfile, log_level);
        }

        let generator = Generator::init(pm);

        let mut out: Vec<u8> = Vec::with_capacity(128 * 1024);
        match format {
            Format::CycloneDX => generator.write_cyclonedx(&mut out),
            Format::Spdx => generator.write_spdx(&mut out),
        }

        if let Some(path) = outfile {
            // `PackageManager::init()` chdirs to the workspace root when
            // invoked from inside a workspace member, so resolve relative
            // paths against the user's original invocation directory.
            let mut abs_buf = PathBuffer::uninit();
            let abs_path = resolve_path::join_abs_string_buf::<platform::Auto>(
                original_cwd,
                &mut abs_buf,
                &[path],
            );
            let path_z = bun_core::ZBox::from_bytes(abs_path);
            if let Err(e) = bun_sys::File::write_file(Fd::cwd(), path_z.as_zstr(), &out) {
                Output::err(e, "failed to write SBOM to '{}'", (bstr::BStr::new(path),));
                Global::exit(1);
            }
            if pm.options.log_level != bun_install::LogLevel::Silent {
                Output::pretty_errorln(format_args!(
                    "<green>Saved<r> {} ({} packages)",
                    bstr::BStr::new(path),
                    generator.components.len()
                ));
            }
        } else {
            let _ = Output::writer().write_all(&out);
        }
        Output::flush();

        Ok(())
    }

    pub fn print_help() {
        let help = "<b>Usage<r>: <b><green>bun pm sbom<r> <cyan>[flags]<r>\n\
            \n\
            \x20 Generate a Software Bill of Materials (SBOM) from the lockfile.\n\
            \n\
            <b>Flags:<r>\n\
            \x20 <cyan>    --format<r> <blue>\\<format\\><r>   Output format: <b>cyclonedx<r> (default) or <b>spdx<r>\n\
            \x20 <cyan>-o, --outfile<r> <blue>\\<path\\><r>    Write the SBOM to a file instead of stdout\n\
            \n\
            <b>Examples:<r>\n\
            \x20 <d>Write a CycloneDX 1.7 SBOM to stdout<r>\n\
            \x20 <b><green>bun pm sbom<r>\n\
            \n\
            \x20 <d>Write an SPDX 2.3 SBOM to a file<r>\n\
            \x20 <b><green>bun pm sbom<r> <cyan>--format<r> spdx <cyan>-o<r> sbom.spdx.json\n\
            \n";
        Output::pretty(help);
        Output::flush();
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Generator: collects package information from the lockfile once, then
// serializes to either CycloneDX or SPDX.
// ───────────────────────────────────────────────────────────────────────────

/// Ordered from strongest to weakest. A path from the root inherits the
/// weakest edge along it; a package's final scope is the strongest over all
/// paths that reach it.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
enum Scope {
    Required = 0,
    Optional = 1,
    Excluded = 2,
}

impl Scope {
    fn to_cyclonedx(self) -> &'static str {
        match self {
            Scope::Required => "required",
            Scope::Optional => "optional",
            Scope::Excluded => "excluded",
        }
    }
    #[inline]
    fn is_stronger_than(self, other: Scope) -> bool {
        (self as u8) < (other as u8)
    }
    #[inline]
    fn weaken_by(self, edge: Scope) -> Scope {
        if (edge as u8) > (self as u8) {
            edge
        } else {
            self
        }
    }
}

/// All string fields are owned; Components are never individually freed.
struct Component {
    package_id: PackageID,
    /// Unique reference used as `bom-ref` (CycloneDX). For npm packages this
    /// is `name@version`.
    ref_: Vec<u8>,
    /// SPDXID suffix (`SPDXRef-Package-<this>`). SPDXIDs allow only
    /// `[A-Za-z0-9.-]`, and two distinct refs (e.g. `foo_bar@1.0.0` and
    /// `foo-bar@1.0.0`) can sanitize to the same value, so this is
    /// deduplicated independently of `ref_`.
    spdx_id: Vec<u8>,
    name: Vec<u8>,
    /// Version string. Empty if unavailable.
    version: Vec<u8>,
    /// Package URL identifier (`pkg:npm/...`). Empty if not applicable.
    /// <https://github.com/package-url/purl-spec>
    purl: Vec<u8>,
    /// Download URL (tarball for npm, repo for git, etc). Empty if unavailable.
    download_url: Vec<u8>,
    /// Direct dependencies by PackageID.
    deps: Vec<PackageID>,

    scope: Scope,
    integrity: Integrity,
}

const INVALID_INDEX: u32 = u32::MAX;
const ROOT_MARKER: u32 = u32::MAX - 1;

struct Generator<'a> {
    lockfile: &'a Lockfile,

    root: Component,
    /// All packages in the lockfile other than the root package. Index into
    /// this list is unrelated to PackageID.
    components: Vec<Component>,
    /// Maps PackageID to index in `components`, or `ROOT_MARKER` for the root,
    /// or `INVALID_INDEX` for packages we skipped (uninitialized resolutions).
    id_to_component: Vec<u32>,

    /// ISO 8601 UTC timestamp for when this SBOM was generated.
    timestamp: String,
    serial_uuid: [u8; 36],
}

impl<'a> Generator<'a> {
    fn init(pm: &'a PackageManager) -> Generator<'a> {
        let lockfile: &Lockfile = &pm.lockfile;

        let pkg_len = lockfile.packages.len();
        let string_bytes = lockfile.buffers.string_bytes.as_slice();
        let deps_buf = lockfile.buffers.dependencies.as_slice();
        let resolutions_buf = lockfile.buffers.resolutions.as_slice();
        let packages = lockfile.packages.slice();
        let pkg_names = packages.items_name();
        let pkg_name_hashes = packages.items_name_hash();
        let pkg_resolutions = packages.items_resolution();
        let pkg_metas = packages.items_meta();
        let pkg_dependencies = packages.items_dependencies();
        let pkg_dep_resolutions = packages.items_resolutions();

        let mut id_to_component: Vec<u32> = vec![INVALID_INDEX; pkg_len];

        let timestamp = make_iso_timestamp();
        let mut serial_uuid = [0u8; 36];
        UUID::init().print(&mut serial_uuid);

        // Compute a scope for each package based on how it's reachable from
        // the root. A package's scope is the strongest (required > optional >
        // excluded) over all paths from the root, where a path's scope is the
        // weakest edge along it:
        //   - any dev edge on the path -> that path contributes `Excluded`
        //   - else any optional/optional-peer edge -> `Optional`
        //   - else -> `Required`
        // This matches what `bun install --production` would actually
        // install: transitive dependencies of a root devDependency are only
        // reachable via a dev edge, so they're all `Excluded` unless some
        // other prod path also reaches them.
        //
        // The SBOM always describes the whole lockfile, so the BFS seeds
        // from the lockfile root (PackageID 0) even when `bun pm sbom` is
        // invoked from inside a workspace member's directory. Using the
        // workspace-aware `pm.root_package_id` here would leave sibling
        // workspaces and their deps at `Excluded` despite emitting them
        // as components.
        let root_id: PackageID = 0;
        let mut pkg_scope: Vec<Scope> = vec![Scope::Excluded; pkg_len];
        if (root_id as usize) < pkg_len {
            pkg_scope[root_id as usize] = Scope::Required;
            let mut queue: Vec<PackageID> = vec![root_id];
            while let Some(parent) = queue.pop() {
                let parent_scope = pkg_scope[parent as usize];
                let deps = pkg_dependencies[parent as usize].get(deps_buf);
                let resolved = pkg_dep_resolutions[parent as usize].get(resolutions_buf);
                for (dep, &child) in deps.iter().zip(resolved.iter()) {
                    if child == INVALID_PACKAGE_ID || child as usize >= pkg_len || child == parent {
                        continue;
                    }
                    // `is_optional()` excludes optional peer deps (it checks
                    // `optional && !peer`), so check `is_optional_peer()` too.
                    let edge = if dep.behavior.is_dev() {
                        Scope::Excluded
                    } else if dep.behavior.is_optional() || dep.behavior.is_optional_peer() {
                        Scope::Optional
                    } else {
                        Scope::Required
                    };
                    let path_scope = parent_scope.weaken_by(edge);
                    if path_scope.is_stronger_than(pkg_scope[child as usize]) {
                        pkg_scope[child as usize] = path_scope;
                        queue.push(child);
                    }
                }
            }
        }

        // Build the root component from the root package in the lockfile.
        let root = {
            let mut root_name: Vec<u8> =
                if (root_id as usize) < pkg_len && pkg_names[root_id as usize].len() > 0 {
                    pkg_names[root_id as usize].slice(string_bytes).to_vec()
                } else {
                    pm.root_package_json_name_at_time_of_init.to_vec()
                };
            // Root version isn't stored in the lockfile for the root package
            // itself; read it from `workspace_versions` or package.json.
            let mut root_version: Vec<u8> = Vec::new();
            if (root_id as usize) < pkg_len {
                if let Some(ws_version) = lockfile
                    .workspace_versions
                    .get(&pkg_name_hashes[root_id as usize])
                {
                    root_version = format!("{}", ws_version.fmt(string_bytes)).into_bytes();
                }
            }
            if root_version.is_empty() {
                read_root_package_json(&mut root_name, &mut root_version);
            }
            if root_name.is_empty() {
                root_name = b"root".to_vec();
            }
            let root_ref: Vec<u8> = if !root_version.is_empty() {
                let mut r = Vec::with_capacity(root_name.len() + 1 + root_version.len());
                r.extend_from_slice(&root_name);
                r.push(b'@');
                r.extend_from_slice(&root_version);
                r
            } else {
                root_name.clone()
            };
            let spdx_id = sanitize_spdx_id(&root_ref);
            let purl = if strings::is_npm_package_name(&root_name) && !root_version.is_empty() {
                make_purl(&root_name, &root_version)
            } else {
                Vec::new()
            };
            if (root_id as usize) < pkg_len {
                id_to_component[root_id as usize] = ROOT_MARKER;
            }
            Component {
                package_id: root_id,
                ref_: root_ref,
                spdx_id,
                name: root_name,
                version: root_version,
                purl,
                download_url: Vec::new(),
                deps: Vec::new(),
                scope: Scope::Required,
                integrity: Integrity::default(),
            }
        };

        // Build a component for every other package.
        let mut components: Vec<Component> = Vec::with_capacity(pkg_len.saturating_sub(1));
        let mut seen_refs: HashSet<Vec<u8>> = HashSet::new();
        let mut seen_spdx_ids: HashSet<Vec<u8>> = HashSet::new();
        seen_refs.insert(root.ref_.clone());
        seen_spdx_ids.insert(root.spdx_id.clone());

        for idx in 0..pkg_len {
            let pkg_id = idx as PackageID;
            if pkg_id == root_id {
                continue;
            }
            let res = &pkg_resolutions[idx];
            if res.tag == ResolutionTag::Uninitialized {
                continue;
            }

            let name: &[u8] = pkg_names[idx].slice(string_bytes);

            let mut version: Vec<u8> = Vec::new();
            let mut purl: Vec<u8> = Vec::new();
            let mut download_url: Vec<u8> = Vec::new();
            let ref_: Vec<u8>;

            match res.tag {
                ResolutionTag::Root => {
                    ref_ = if !name.is_empty() {
                        name.to_vec()
                    } else {
                        b"root".to_vec()
                    };
                }
                ResolutionTag::Npm => {
                    let npm = res.npm();
                    version = format!("{}", npm.version.fmt(string_bytes)).into_bytes();
                    ref_ = fmt_ref(name, &version);
                    purl = make_purl(name, &version);
                    let url = npm.url.slice(string_bytes);
                    if !url.is_empty() {
                        download_url = url.to_vec();
                    }
                }
                ResolutionTag::Workspace => {
                    let ws_path = res.workspace().slice(string_bytes);
                    ref_ = format!(
                        "{}@workspace:{}",
                        bstr::BStr::new(name),
                        bstr::BStr::new(ws_path)
                    )
                    .into_bytes();
                    if let Some(ws_version) = lockfile.workspace_versions.get(&pkg_name_hashes[idx])
                    {
                        version = format!("{}", ws_version.fmt(string_bytes)).into_bytes();
                        // Workspace names aren't validated against npm naming
                        // rules, so only emit a `pkg:npm/...` purl when the
                        // name would be valid as one.
                        if strings::is_npm_package_name(name) {
                            purl = make_purl(name, &version);
                        }
                    }
                }
                ResolutionTag::Folder
                | ResolutionTag::Symlink
                | ResolutionTag::SingleFileModule
                | ResolutionTag::LocalTarball
                | ResolutionTag::RemoteTarball
                | ResolutionTag::Git
                | ResolutionTag::Github => {
                    version = format!("{}", res.fmt(string_bytes, PathSep::Posix)).into_bytes();
                    ref_ = fmt_ref(name, &version);
                    if res.tag == ResolutionTag::RemoteTarball {
                        let url = res.remote_tarball().slice(string_bytes);
                        if !url.is_empty() {
                            download_url = url.to_vec();
                        }
                    } else if res.tag == ResolutionTag::Git || res.tag == ResolutionTag::Github {
                        download_url = format!("{}", res.fmt_url(string_bytes)).into_bytes();
                    }
                }
                _ => {
                    ref_ = format!(
                        "{}@{}",
                        bstr::BStr::new(name),
                        res.fmt(string_bytes, PathSep::Posix)
                    )
                    .into_bytes();
                }
            }

            // bom-refs must be unique within the document. Lockfiles can
            // contain duplicate name@version entries in edge cases (e.g. npm
            // aliases resolving to the same underlying package from different
            // dependency paths), so append the package index until unique.
            let mut ref_ = ref_;
            while seen_refs.contains(&ref_) {
                let unique = format!("{}~{}", bstr::BStr::new(&ref_), idx).into_bytes();
                ref_ = unique;
            }
            seen_refs.insert(ref_.clone());

            // SPDXIDs must also be unique, but are derived from `ref_` by
            // sanitizing non-alphanumeric characters to `-`, so two distinct
            // refs (e.g. `foo_bar@1.0.0` and `foo-bar@1.0.0`) can collide.
            // Deduplicate on the sanitized form separately.
            let mut spdx_id = sanitize_spdx_id(&ref_);
            while seen_spdx_ids.contains(&spdx_id) {
                let unique = format!("{}.{}", bstr::BStr::new(&spdx_id), idx).into_bytes();
                spdx_id = unique;
            }
            seen_spdx_ids.insert(spdx_id.clone());

            id_to_component[pkg_id as usize] = components.len() as u32;
            components.push(Component {
                package_id: pkg_id,
                ref_,
                spdx_id,
                name: name.to_vec(),
                version,
                purl,
                download_url,
                deps: Vec::new(),
                scope: if res.tag == ResolutionTag::Root {
                    Scope::Required
                } else {
                    pkg_scope[idx]
                },
                integrity: pkg_metas[idx].integrity,
            });
        }

        let mut this = Generator {
            lockfile,
            root,
            components,
            id_to_component,
            timestamp,
            serial_uuid,
        };

        // Collect direct dependencies for each component (and the root) for
        // the dependency graph section.
        collect_deps(
            &mut this.root,
            pkg_dep_resolutions,
            resolutions_buf,
            pkg_len,
        );
        for comp in this.components.iter_mut() {
            collect_deps(comp, pkg_dep_resolutions, resolutions_buf, pkg_len);
        }

        this
    }

    fn component_for(&self, pkg_id: PackageID) -> Option<&Component> {
        let idx = *self.id_to_component.get(pkg_id as usize)?;
        if idx == INVALID_INDEX {
            None
        } else if idx == ROOT_MARKER {
            Some(&self.root)
        } else {
            Some(&self.components[idx as usize])
        }
    }

    // ==== CycloneDX 1.7 ====================================================

    fn write_cyclonedx(&self, w: &mut Vec<u8>) {
        w.extend_from_slice(b"{\n");
        w.extend_from_slice(
            b"  \"$schema\": \"https://cyclonedx.org/schema/bom-1.7.schema.json\",\n",
        );
        w.extend_from_slice(b"  \"bomFormat\": \"CycloneDX\",\n");
        w.extend_from_slice(b"  \"specVersion\": \"1.7\",\n");
        let _ = write!(
            w,
            "  \"serialNumber\": \"urn:uuid:{}\",\n",
            bstr::BStr::new(&self.serial_uuid)
        );
        w.extend_from_slice(b"  \"version\": 1,\n");

        // metadata
        w.extend_from_slice(b"  \"metadata\": {\n");
        let _ = write!(w, "    \"timestamp\": \"{}\",\n", self.timestamp);
        w.extend_from_slice(b"    \"lifecycles\": [{ \"phase\": \"build\" }],\n");
        w.extend_from_slice(b"    \"tools\": {\n");
        w.extend_from_slice(b"      \"components\": [\n");
        let _ = write!(
            w,
            "        {{ \"type\": \"application\", \"name\": \"bun\", \"version\": \"{}\" }}\n",
            Global::package_json_version
        );
        w.extend_from_slice(b"      ]\n");
        w.extend_from_slice(b"    },\n");
        w.extend_from_slice(b"    \"component\": ");
        self.write_cyclonedx_component(w, &self.root, "application", 4);
        w.extend_from_slice(b"\n  },\n");

        // components
        w.extend_from_slice(b"  \"components\": [");
        for (i, comp) in self.components.iter().enumerate() {
            if i != 0 {
                w.push(b',');
            }
            w.extend_from_slice(b"\n    ");
            self.write_cyclonedx_component(w, comp, "library", 4);
        }
        if !self.components.is_empty() {
            w.push(b'\n');
        }
        w.extend_from_slice(b"  ],\n");

        // dependencies
        w.extend_from_slice(b"  \"dependencies\": [\n");
        self.write_cyclonedx_dependency(w, &self.root);
        for comp in self.components.iter() {
            w.extend_from_slice(b",\n");
            self.write_cyclonedx_dependency(w, comp);
        }
        w.extend_from_slice(b"\n  ]\n");

        w.extend_from_slice(b"}\n");
    }

    fn write_cyclonedx_component(
        &self,
        w: &mut Vec<u8>,
        comp: &Component,
        kind: &str,
        base_indent: usize,
    ) {
        let pad = Indent(base_indent);
        let pad1 = Indent(base_indent + 2);
        w.extend_from_slice(b"{\n");
        let _ = write!(w, "{pad1}\"type\": \"{kind}\",\n");
        let _ = write!(w, "{pad1}\"bom-ref\": {},\n", json_str(&comp.ref_));
        let _ = write!(w, "{pad1}\"name\": {},\n", json_str(&comp.name));
        if !comp.version.is_empty() {
            let _ = write!(w, "{pad1}\"version\": {},\n", json_str(&comp.version));
        }
        let _ = write!(w, "{pad1}\"scope\": \"{}\"", comp.scope.to_cyclonedx());
        if !comp.purl.is_empty() {
            let _ = write!(w, ",\n{pad1}\"purl\": {}", json_str(&comp.purl));
        }
        if !comp.download_url.is_empty() {
            let _ = write!(
                w,
                ",\n{pad1}\"externalReferences\": [{{ \"type\": \"distribution\", \"url\": {} }}]",
                json_str(&comp.download_url)
            );
        }
        if let Some(alg) = cyclonedx_hash_alg(comp.integrity.tag) {
            let mut hex_buf = [0u8; MAX_DIGEST_HEX_LEN];
            let hex = hex_digest(&comp.integrity, &mut hex_buf);
            let _ = write!(
                w,
                ",\n{pad1}\"hashes\": [{{ \"alg\": \"{alg}\", \"content\": \"{}\" }}]",
                bstr::BStr::new(hex)
            );
        }
        let _ = write!(w, "\n{pad}}}");
    }

    fn write_cyclonedx_dependency(&self, w: &mut Vec<u8>, comp: &Component) {
        let _ = write!(
            w,
            "    {{ \"ref\": {}, \"dependsOn\": [",
            json_str(&comp.ref_)
        );
        let mut first = true;
        for &dep_id in comp.deps.iter() {
            let Some(dep) = self.component_for(dep_id) else {
                continue;
            };
            if !first {
                w.extend_from_slice(b", ");
            }
            let _ = write!(w, "{}", json_str(&dep.ref_));
            first = false;
        }
        w.extend_from_slice(b"] }");
    }

    // ==== SPDX 2.3 =========================================================

    fn write_spdx(&self, w: &mut Vec<u8>) {
        w.extend_from_slice(b"{\n");
        w.extend_from_slice(b"  \"spdxVersion\": \"SPDX-2.3\",\n");
        w.extend_from_slice(b"  \"dataLicense\": \"CC0-1.0\",\n");
        w.extend_from_slice(b"  \"SPDXID\": \"SPDXRef-DOCUMENT\",\n");
        let _ = write!(w, "  \"name\": {},\n", json_str(&self.root.ref_));
        let _ = write!(
            w,
            "  \"documentNamespace\": \"https://spdx.org/spdxdocs/{}-{}\",\n",
            bstr::BStr::new(&self.root.spdx_id),
            bstr::BStr::new(&self.serial_uuid)
        );
        w.extend_from_slice(b"  \"creationInfo\": {\n");
        let _ = write!(w, "    \"created\": \"{}\",\n", self.timestamp);
        let _ = write!(
            w,
            "    \"creators\": [\"Tool: bun-{}\"]\n",
            Global::package_json_version
        );
        w.extend_from_slice(b"  },\n");
        let _ = write!(
            w,
            "  \"documentDescribes\": [\"SPDXRef-Package-{}\"],\n",
            bstr::BStr::new(&self.root.spdx_id)
        );

        // packages
        w.extend_from_slice(b"  \"packages\": [\n");
        self.write_spdx_package(w, &self.root, true);
        for comp in self.components.iter() {
            w.extend_from_slice(b",\n");
            self.write_spdx_package(w, comp, false);
        }
        w.extend_from_slice(b"\n  ],\n");

        // relationships
        w.extend_from_slice(b"  \"relationships\": [\n");
        let _ = write!(
            w,
            "    {{ \"spdxElementId\": \"SPDXRef-DOCUMENT\", \"relatedSpdxElement\": \"SPDXRef-Package-{}\", \"relationshipType\": \"DESCRIBES\" }}",
            bstr::BStr::new(&self.root.spdx_id)
        );
        self.write_spdx_relationships(w, &self.root);
        for comp in self.components.iter() {
            self.write_spdx_relationships(w, comp);
        }
        w.extend_from_slice(b"\n  ]\n");

        w.extend_from_slice(b"}\n");
    }

    fn write_spdx_package(&self, w: &mut Vec<u8>, comp: &Component, is_root: bool) {
        w.extend_from_slice(b"    {\n");
        let _ = write!(w, "      \"name\": {},\n", json_str(&comp.name));
        let _ = write!(
            w,
            "      \"SPDXID\": \"SPDXRef-Package-{}\",\n",
            bstr::BStr::new(&comp.spdx_id)
        );
        if !comp.version.is_empty() {
            let _ = write!(w, "      \"versionInfo\": {},\n", json_str(&comp.version));
        }
        if is_root {
            w.extend_from_slice(b"      \"primaryPackagePurpose\": \"APPLICATION\",\n");
        }
        if !comp.download_url.is_empty() {
            let _ = write!(
                w,
                "      \"downloadLocation\": {},\n",
                json_str(&comp.download_url)
            );
        } else {
            w.extend_from_slice(b"      \"downloadLocation\": \"NOASSERTION\",\n");
        }
        w.extend_from_slice(b"      \"filesAnalyzed\": false,\n");
        w.extend_from_slice(b"      \"licenseConcluded\": \"NOASSERTION\",\n");
        w.extend_from_slice(b"      \"licenseDeclared\": \"NOASSERTION\",\n");
        w.extend_from_slice(b"      \"copyrightText\": \"NOASSERTION\"");
        if !comp.purl.is_empty() {
            let _ = write!(
                w,
                ",\n      \"externalRefs\": [{{ \"referenceCategory\": \"PACKAGE-MANAGER\", \"referenceType\": \"purl\", \"referenceLocator\": {} }}]",
                json_str(&comp.purl)
            );
        }
        if let Some(alg) = spdx_hash_alg(comp.integrity.tag) {
            let mut hex_buf = [0u8; MAX_DIGEST_HEX_LEN];
            let hex = hex_digest(&comp.integrity, &mut hex_buf);
            let _ = write!(
                w,
                ",\n      \"checksums\": [{{ \"algorithm\": \"{alg}\", \"checksumValue\": \"{}\" }}]",
                bstr::BStr::new(hex)
            );
        }
        w.extend_from_slice(b"\n    }");
    }

    fn write_spdx_relationships(&self, w: &mut Vec<u8>, comp: &Component) {
        let packages = self.lockfile.packages.slice();
        let deps_buf = self.lockfile.buffers.dependencies.as_slice();
        let resolutions_buf = self.lockfile.buffers.resolutions.as_slice();
        let pkg_dependencies = packages.items_dependencies();
        let pkg_dep_resolutions = packages.items_resolutions();

        for &dep_id in comp.deps.iter() {
            let Some(dep_comp) = self.component_for(dep_id) else {
                continue;
            };
            // A parent can list the same resolved package under more than one
            // dependency group (e.g. both `dependencies` and
            // `peerDependencies`). Scan every matching edge and pick the
            // strongest relationship (required > optional > dev), matching the
            // precedence used for CycloneDX scope.
            let rel_type = {
                let deps = pkg_dependencies[comp.package_id as usize].get(deps_buf);
                let resolved = pkg_dep_resolutions[comp.package_id as usize].get(resolutions_buf);
                let mut has_dev = false;
                let mut has_optional = false;
                let mut is_required = false;
                for (dep, &r) in deps.iter().zip(resolved.iter()) {
                    if r != dep_id {
                        continue;
                    }
                    if dep.behavior.is_dev() {
                        has_dev = true;
                    } else if dep.behavior.is_optional() || dep.behavior.is_optional_peer() {
                        has_optional = true;
                    } else {
                        is_required = true;
                        break;
                    }
                }
                if is_required {
                    RelType::DependsOn
                } else if has_optional {
                    RelType::OptionalOf
                } else if has_dev {
                    RelType::DevOf
                } else {
                    RelType::DependsOn
                }
            };
            match rel_type {
                RelType::DependsOn => {
                    let _ = write!(
                        w,
                        ",\n    {{ \"spdxElementId\": \"SPDXRef-Package-{}\", \"relatedSpdxElement\": \"SPDXRef-Package-{}\", \"relationshipType\": \"DEPENDS_ON\" }}",
                        bstr::BStr::new(&comp.spdx_id),
                        bstr::BStr::new(&dep_comp.spdx_id)
                    );
                }
                // For `*_OF` relationships, the subject is the dependency and
                // the object is the dependent.
                RelType::OptionalOf => {
                    let _ = write!(
                        w,
                        ",\n    {{ \"spdxElementId\": \"SPDXRef-Package-{}\", \"relatedSpdxElement\": \"SPDXRef-Package-{}\", \"relationshipType\": \"OPTIONAL_DEPENDENCY_OF\" }}",
                        bstr::BStr::new(&dep_comp.spdx_id),
                        bstr::BStr::new(&comp.spdx_id)
                    );
                }
                RelType::DevOf => {
                    let _ = write!(
                        w,
                        ",\n    {{ \"spdxElementId\": \"SPDXRef-Package-{}\", \"relatedSpdxElement\": \"SPDXRef-Package-{}\", \"relationshipType\": \"DEV_DEPENDENCY_OF\" }}",
                        bstr::BStr::new(&dep_comp.spdx_id),
                        bstr::BStr::new(&comp.spdx_id)
                    );
                }
            }
        }
    }
}

enum RelType {
    DependsOn,
    OptionalOf,
    DevOf,
}

// ───── helpers ────────────────────────────────────────────────────────────

fn collect_deps(
    comp: &mut Component,
    pkg_dep_resolutions: &[ExternalSlice<PackageID>],
    resolutions_buf: &[PackageID],
    pkg_len: usize,
) {
    if comp.package_id as usize >= pkg_len {
        return;
    }
    let resolved = pkg_dep_resolutions[comp.package_id as usize].get(resolutions_buf);
    for &resolved_id in resolved.iter() {
        // Skip invalid/out-of-range, and self-edges (e.g. `"pkg": "file:."`)
        // to match the BFS scope loop and avoid emitting a reflexive
        // `A dependsOn A` / `A DEPENDS_ON A` edge in the output.
        if resolved_id == INVALID_PACKAGE_ID
            || resolved_id as usize >= pkg_len
            || resolved_id == comp.package_id
        {
            continue;
        }
        // Deduplicate — a package can list the same dep under both
        // `dependencies` and `peerDependencies`, for example.
        if !comp.deps.contains(&resolved_id) {
            comp.deps.push(resolved_id);
        }
    }
}

/// Read the root package's name/version from `package.json` in the current
/// working directory (which `PackageManager::init` has set to the workspace
/// root). Only fills in fields that are currently empty.
fn read_root_package_json(root_name: &mut Vec<u8>, root_version: &mut Vec<u8>) {
    let Ok(contents) = bun_sys::File::read_from(Fd::cwd(), b"package.json") else {
        return;
    };
    let source = bun_ast::Source::init_path_string(b"package.json", &contents[..]);
    let mut log = bun_ast::Log::init();
    let bump = bun_alloc::Arena::new();
    let Ok(json) = bun_parsers::json::parse::<false>(&source, &mut log, &bump) else {
        return;
    };
    if root_version.is_empty() {
        if let Some(e) = json.get(b"version") {
            if let Some(v) = e.as_utf8_string_literal() {
                if !v.is_empty() {
                    *root_version = v.to_vec();
                }
            }
        }
    }
    if root_name.is_empty() {
        if let Some(e) = json.get(b"name") {
            if let Some(n) = e.as_utf8_string_literal() {
                if !n.is_empty() {
                    *root_name = n.to_vec();
                }
            }
        }
    }
}

/// SPDXID values may only contain letters, numbers, `.`, and `-`. Build the
/// `SPDXRef-Package-…` suffix by replacing anything else with `-`.
fn sanitize_spdx_id(ref_: &[u8]) -> Vec<u8> {
    ref_.iter()
        .map(|&c| match c {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' => c,
            _ => b'-',
        })
        .collect()
}

fn fmt_ref(name: &[u8], version: &[u8]) -> Vec<u8> {
    let mut r = Vec::with_capacity(name.len() + 1 + version.len());
    r.extend_from_slice(name);
    r.push(b'@');
    r.extend_from_slice(version);
    r
}

/// purl-spec: `pkg:npm/namespace/name@version`. For scoped packages the `@`
/// in the scope must be percent-encoded. The version must also be
/// percent-encoded (semver build metadata `+` -> `%2B`).
fn make_purl(name: &[u8], version: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(8 + name.len() + version.len() + 4);
    out.extend_from_slice(b"pkg:npm/");
    if name.first() == Some(&b'@') {
        if let Some(slash) = strings::index_of_char(name, b'/') {
            let slash = slash as usize;
            out.extend_from_slice(b"%40");
            out.extend_from_slice(&name[1..slash]);
            out.push(b'/');
            out.extend_from_slice(&name[slash + 1..]);
            out.push(b'@');
            purl_encode_into(&mut out, version);
            return out;
        }
    }
    out.extend_from_slice(name);
    out.push(b'@');
    purl_encode_into(&mut out, version);
    out
}

/// Percent-encodes bytes outside the RFC 3986 unreserved set
/// (`A-Za-z0-9-._~`) for use in purl components. Matches what packageurl-js
/// does via `encodeURIComponent()`.
fn purl_encode_into(out: &mut Vec<u8>, s: &[u8]) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    for &c in s {
        match c {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => out.push(c),
            _ => {
                out.push(b'%');
                out.push(HEX[(c >> 4) as usize]);
                out.push(HEX[(c & 0x0f) as usize]);
            }
        }
    }
}

fn make_iso_timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Days since 1970-01-01 → civil date. Howard Hinnant's algorithm.
    let days = (secs / 86400) as i64;
    let sod = (secs % 86400) as u32;
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = (y + (m <= 2) as i64) as i32;
    let (hh, mm, ss) = (sod / 3600, (sod % 3600) / 60, sod % 60);
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

fn cyclonedx_hash_alg(tag: IntegrityTag) -> Option<&'static str> {
    match tag {
        IntegrityTag::SHA1 => Some("SHA-1"),
        IntegrityTag::SHA256 => Some("SHA-256"),
        IntegrityTag::SHA384 => Some("SHA-384"),
        IntegrityTag::SHA512 => Some("SHA-512"),
        _ => None,
    }
}

fn spdx_hash_alg(tag: IntegrityTag) -> Option<&'static str> {
    match tag {
        IntegrityTag::SHA1 => Some("SHA1"),
        IntegrityTag::SHA256 => Some("SHA256"),
        IntegrityTag::SHA384 => Some("SHA384"),
        IntegrityTag::SHA512 => Some("SHA512"),
        _ => None,
    }
}

/// Largest supported digest is SHA-512 (64 bytes) → 128 hex chars.
const MAX_DIGEST_HEX_LEN: usize = 128;

fn hex_digest<'a>(integrity: &Integrity, out: &'a mut [u8]) -> &'a [u8] {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = integrity.slice();
    for (i, &b) in digest.iter().enumerate() {
        out[i * 2] = HEX[(b >> 4) as usize];
        out[i * 2 + 1] = HEX[(b & 0x0f) as usize];
    }
    &out[0..digest.len() * 2]
}

struct Indent(usize);
impl core::fmt::Display for Indent {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        for _ in 0..self.0 {
            f.write_str(" ")?;
        }
        Ok(())
    }
}

#[inline]
fn json_str(s: &[u8]) -> bun_core::fmt::JSONFormatterUTF8<'_> {
    bun_core::fmt::format_json_string_utf8(s, Default::default())
}

// ported from: src/cli/pm_sbom_command.zig
