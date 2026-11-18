use bun_io::Write as _;

use crate::integrity::Integrity;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Format {
    CycloneDx,
    Spdx,
}

// The `name` and `version` in the package.json of a package of the project. An empty one is not there.
pub struct Manifest {
    pub name: Vec<u8>,
    pub version: Vec<u8>,
}

// What the caller makes for one document. The rest is read from the lockfile.
pub struct Input<'a> {
    pub serial_number: &'a [u8; 36],
    // `YYYY-MM-DDTHH:MM:SS.mmmZ`, or the same without the fraction.
    pub timestamp: &'a [u8],
    // One for each of `Plan::project_paths`, in that order. `None` for a workspace that is not in this checkout.
    pub manifests: &'a [Option<Manifest>],
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Scope {
    Required,
    Optional,
    Excluded,
}

// The packages of one document: what `root` reaches through the dependency groups that `features` keeps.
pub struct Plan {
    options: crate::lockfile_real::reachable::Options,
    follow_workspace_edges: bool,
    listed: bun_collections::DynamicBitSet,
    // By package id.
    scopes: Vec<Scope>,
    // The listed packages of the project, each with its path from the root of the project. The root package has the empty path.
    project: Vec<(crate::PackageID, Vec<u8>)>,
}

impl Plan {
    pub fn new(
        lockfile: &crate::lockfile_real::Lockfile,
        root: crate::PackageID,
        features: crate::Features,
    ) -> Plan {
        use crate::lockfile::package::PackageColumns as _;
        use crate::resolution::Tag;

        // On every platform, and with what a package has in its own tarball, as `bun audit` has it.
        let options = crate::lockfile_real::reachable::Options {
            root,
            dev: features.dev_dependencies,
            optional: features.optional_dependencies,
            peer: features.peer_dependencies,
            optional_peer: features.peer_dependencies,
            bundled: true,
            platform: None,
        };
        // Only the root package has the rows that make a workspace a part of the project. A workspace that depends on the root package does not depend on the other workspaces.
        let follow_workspace_edges = root == 0;
        let (listed, scopes) = tiers(lockfile, options, follow_workspace_edges);

        let string_bytes = lockfile.buffers.string_bytes.as_slice();
        let resolutions = lockfile.packages.items_resolution();
        let mut project = Vec::new();
        let mut ids = listed.iterator::<true, true>();
        while let Some(id) = ids.next() {
            let path: &[u8] = match resolutions[id].tag {
                Tag::Root => b"",
                Tag::Workspace => resolutions[id].workspace().slice(string_bytes),
                _ => continue,
            };
            project.push((id as crate::PackageID, path.to_vec()));
        }
        Plan {
            options,
            follow_workspace_edges,
            listed,
            scopes,
            project,
        }
    }

    pub fn project_paths(&self) -> impl Iterator<Item = &[u8]> {
        self.project.iter().map(|(_, path)| path.as_slice())
    }
}

// An empty `version`, `purl` or `locator` means the package has none.
struct Component {
    name: Vec<u8>,
    version: Vec<u8>,
    bom_ref: Vec<u8>,
    spdx_id: Vec<u8>,
    purl: Vec<u8>,
    // The URL of a tarball that is not from a registry.
    locator: Vec<u8>,
    integrity: Integrity,
    scope: Scope,
    // Whether every path to the package goes into the tarball of another one. The lockfile has the version that the ranges resolve to, and the tarball can have another one.
    bundled: bool,
    // Indices into `Document::components`, sorted, each once.
    edges: Vec<u32>,
}

struct Document<'a> {
    serial_number: &'a [u8; 36],
    timestamp: &'a [u8],
    // The described package comes first. The rest are sorted by name, then version.
    components: Vec<Component>,
}

pub fn print(
    lockfile: &crate::lockfile_real::Lockfile,
    format: Format,
    plan: &Plan,
    input: &Input<'_>,
    out: &mut Vec<u8>,
) -> Result<(), crate::Error> {
    let root = plan.options.root;
    let manifest_of = |id: crate::PackageID| {
        let nth = plan.project.iter().position(|&(listed, _)| listed == id)?;
        input.manifests.get(nth)?.as_ref()
    };

    let mut components = vec![component(
        lockfile,
        root,
        Scope::Required,
        manifest_of(root),
    )?];
    // Where each listed package is in `components`, by package id. The described package is the first.
    let mut index_of = vec![0u32; plan.scopes.len()];
    let mut listed = plan.listed.iterator::<true, true>();
    while let Some(id) = listed.next() {
        if id != root as usize {
            index_of[id] = components.len() as u32;
            components.push(component(
                lockfile,
                id as crate::PackageID,
                plan.scopes[id],
                manifest_of(id as crate::PackageID),
            )?);
        }
    }
    // Whether the walk goes into the tarball of a package.
    let mut any_bundled = false;
    crate::lockfile_real::reachable::followed_edges(
        lockfile,
        lockfile.buffers.resolutions.as_slice(),
        plan.follow_workspace_edges,
        plan.options,
        &plan.listed,
        |parent, target, behavior| {
            let edge = index_of[target as usize];
            components[index_of[parent as usize] as usize]
                .edges
                .push(edge);
            any_bundled |= behavior.is_bundled();
        },
    );
    // What a bundled package depends on is in the same tarball, and the lockfile marks only the bundled package.
    if any_bundled {
        let standalone = crate::lockfile_real::reachable::packages_from(
            lockfile,
            lockfile.buffers.resolutions.as_slice(),
            &[root],
            plan.follow_workspace_edges,
            crate::lockfile_real::reachable::Options {
                bundled: false,
                ..plan.options
            },
        );
        let mut listed = plan.listed.iterator::<true, true>();
        while let Some(id) = listed.next() {
            components[index_of[id] as usize].bundled = !standalone.is_set(id);
        }
    }
    sort_components(&mut components);
    dedupe_identifiers(&mut components)?;

    let doc = Document {
        serial_number: input.serial_number,
        timestamp: input.timestamp,
        components,
    };
    match format {
        Format::CycloneDx => write_cyclonedx(&doc, out),
        Format::Spdx => write_spdx(&doc, out),
    }
}

// Returns `listed` and, by package id, the scope of each package in it: the first of `required`, `runtime` and `listed` that holds it.
fn tiers(
    lockfile: &crate::lockfile_real::Lockfile,
    everything: crate::lockfile_real::reachable::Options,
    follow_workspace_edges: bool,
) -> (bun_collections::DynamicBitSet, Vec<Scope>) {
    use crate::lockfile_real::reachable;

    let resolutions = lockfile.buffers.resolutions.as_slice();
    let walk = |options: reachable::Options| {
        reachable::packages_from(
            lockfile,
            resolutions,
            &[everything.root],
            follow_workspace_edges,
            options,
        )
    };
    let without_dev = reachable::Options {
        dev: false,
        ..everything
    };
    let listed = walk(everything);
    // A tier whose options equal those of the tier above holds the same packages, so it is not walked.
    let runtime = everything.dev.then(|| walk(without_dev));
    let required = (without_dev.optional || without_dev.optional_peer).then(|| {
        walk(reachable::Options {
            optional: false,
            optional_peer: false,
            ..without_dev
        })
    });
    let runtime = runtime.as_ref().unwrap_or(&listed);
    let required = required.as_ref().unwrap_or(runtime);
    let scopes: Vec<Scope> = (0..listed.bit_length())
        .map(|id| {
            if required.is_set(id) {
                Scope::Required
            } else if runtime.is_set(id) {
                Scope::Optional
            } else {
                Scope::Excluded
            }
        })
        .collect();
    (listed, scopes)
}

// What the document says about package `id`. `manifest` is its package.json when it is a package of the project. Its edges come from the walk.
fn component(
    lockfile: &crate::lockfile_real::Lockfile,
    id: crate::PackageID,
    scope: Scope,
    manifest: Option<&Manifest>,
) -> Result<Component, crate::Error> {
    use crate::lockfile::package::PackageColumns as _;
    use crate::resolution::Tag;

    let string_bytes = lockfile.buffers.string_bytes.as_slice();
    let packages = &lockfile.packages;
    let resolution = &packages.items_resolution()[id as usize];
    let mut name = packages.items_name()[id as usize]
        .slice(string_bytes)
        .to_vec();

    // What bun.lock has after `name@`, but for a folder, which has `file:` there.
    let mut resolved: Vec<u8> = Vec::new();
    resolution
        .fmt(string_bytes, bun_core::fmt::PathSep::Posix)
        .write_to(&mut resolved)?;

    let mut version: Vec<u8> = Vec::new();
    let mut purl: Vec<u8> = Vec::new();
    let mut locator: Vec<u8> = Vec::new();
    let bom_ref = match resolution.tag {
        // The lockfile has the version of a workspace as of the last install, and none for the root package.
        Tag::Root | Tag::Workspace => {
            if let Some(manifest) = manifest {
                if !manifest.name.is_empty() {
                    name.clone_from(&manifest.name);
                }
                version.clone_from(&manifest.version);
            } else if let Some(locked) =
                (lockfile.workspace_versions).get(&packages.items_name_hash()[id as usize])
            {
                write!(version, "{}", locked.fmt(string_bytes))?;
            }
            if !version.is_empty() && bun_core::strings::is_npm_package_name(&name) {
                purl = npm_purl(&name, &version);
            }
            bom_ref_of(&name, &version)
        }
        Tag::Npm => {
            version = resolved;
            purl = npm_purl(&name, &version);
            bom_ref_of(&name, &version)
        }
        // The repository and the commit are the version: the lockfile has no other one.
        Tag::Git | Tag::Github => {
            version = without_secrets(&resolved)?;
            bom_ref_of(&name, &version)
        }
        // The URL is in one field, so that no identifier has what `without_secrets` cannot find in it.
        Tag::RemoteTarball => {
            locator = uri_reference(&without_secrets(&resolved)?)?;
            name.clone()
        }
        // A path is not a version. The identifier has it as bun.lock does.
        Tag::Folder => [name.as_slice(), b"@file:", &resolved].concat(),
        Tag::Symlink | Tag::LocalTarball => [name.as_slice(), b"@", &resolved].concat(),
        _ => name.clone(),
    };

    Ok(Component {
        name,
        version,
        bom_ref,
        // `dedupe_identifiers` makes it from the `bom-ref` it settles on.
        spdx_id: Vec::new(),
        purl,
        locator,
        // A package of the project has no tarball, so it is listed without a hash even when its package-lock.json entry has an `integrity`.
        integrity: match resolution.tag {
            Tag::Root | Tag::Workspace => Integrity::default(),
            _ => packages.items_meta()[id as usize].integrity,
        },
        scope,
        bundled: false,
        edges: Vec::new(),
    })
}

fn bom_ref_of(name: &[u8], version: &[u8]) -> Vec<u8> {
    if version.is_empty() {
        return name.to_vec();
    }
    [name, b"@", version].concat()
}

// `pkg:npm/<name>@<version>`. A scope is the namespace: its `/` stays, and its `@` is encoded like the rest.
fn npm_purl(name: &[u8], version: &[u8]) -> Vec<u8> {
    use bun_core::strings;

    let mut purl = b"pkg:npm".to_vec();
    for segment in strings::split(name, b"/") {
        purl.push(b'/');
        strings::percent_encode_uri_component(segment, &mut purl);
    }
    purl.push(b'@');
    strings::percent_encode_uri_component(version, &mut purl);
    purl
}

// A URL of the lockfile without its userinfo and query string, and with `***` for a token that `bun pm ls` also hides in what is left. The `git@` of an ssh URL stays: it is the login of every git host, and no credential.
fn without_secrets(url: &[u8]) -> Result<Vec<u8>, crate::Error> {
    use bun_core::strings;

    if !strings::contains(url, b"://") {
        return Ok(url.to_vec());
    }
    let mut stripped: Vec<u8> = Vec::with_capacity(url.len());
    crate::resolution::append_without_url_credentials(&mut stripped, url);
    let mut masked: Vec<u8> = Vec::with_capacity(stripped.len());
    write!(masked, "{}", bun_core::fmt::redacted_npm_url(&stripped))?;
    if let Some(colon) = strings::index_of_char_usize(url, b':')
        && url[..colon].ends_with(b"ssh")
        && url[colon + 1..].starts_with(b"//git@")
    {
        let authority = colon + b"://".len();
        masked.splice(authority..authority, *b"git@");
    }
    Ok(masked)
}

// `url` as an RFC 3986 URI reference, which both formats need: `%XX` for a byte that is neither reserved nor unreserved, and for a `%` that starts no escape.
fn uri_reference(url: &[u8]) -> Result<Vec<u8>, crate::Error> {
    let mut out: Vec<u8> = Vec::with_capacity(url.len());
    for (at, &byte) in url.iter().enumerate() {
        let kept = match byte {
            b'%' => (url.get(at + 1..at + 3))
                .is_some_and(|escape| escape.iter().all(u8::is_ascii_hexdigit)),
            b'-' | b'.' | b'_' | b'~' | b':' | b'/' | b'?' | b'#' | b'[' | b']' | b'@' | b'!'
            | b'$' | b'&' | b'\'' | b'(' | b')' | b'*' | b'+' | b',' | b';' | b'=' => true,
            _ => byte.is_ascii_alphanumeric(),
        };
        if kept {
            out.push(byte);
        } else {
            write!(out, "%{byte:02X}")?;
        }
    }
    Ok(out)
}

// Sorts `components[1..]` by name, then version. Every edge follows its target, and no list of edges keeps a target twice.
fn sort_components(components: &mut [Component]) {
    use bun_collections::index_sort;
    use bun_core::strings;

    let mut order = index_sort::identity(components.len());
    let Some((_, packages)) = order.split_first_mut() else {
        return;
    };
    index_sort::sort_indices(packages, &mut |a, b| {
        let (a, b) = (&components[a as usize], &components[b as usize]);
        strings::order(&a.name, &b.name)
            .then_with(|| strings::order(&a.version, &b.version))
            .then_with(|| strings::order(&a.bom_ref, &b.bom_ref))
            .then_with(|| strings::order(&a.locator, &b.locator))
    });
    let mut moved_to = vec![0u32; order.len()];
    for (to, &from) in (0u32..).zip(&order) {
        moved_to[from as usize] = to;
    }
    index_sort::apply_permutation_in_place(components, &mut order);
    for component in components.iter_mut() {
        for target in &mut component.edges {
            *target = moved_to[*target as usize];
        }
        index_sort::sort_slice_unstable(&mut component.edges);
        component.edges.dedup();
    }
}

// Two packages can have one `name@version`, and an SPDXID only keeps the `[A-Za-z0-9.-]` of it.
fn dedupe_identifiers(components: &mut [Component]) -> Result<(), crate::Error> {
    let mut bom_refs = bun_collections::StringSet::new();
    let mut spdx_ids = bun_collections::StringSet::new();
    for (nth, component) in components.iter_mut().enumerate() {
        let bom_ref = &mut component.bom_ref;
        while bom_ref.is_empty() || bom_refs.contains(bom_ref) {
            write!(bom_ref, "~{nth}")?;
        }
        bom_refs.insert(bom_ref)?;

        let mut spdx_id: Vec<u8> = bom_ref
            .iter()
            .map(|&byte| {
                if byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-') {
                    byte
                } else {
                    b'-'
                }
            })
            .collect();
        while spdx_ids.contains(&spdx_id) {
            write!(spdx_id, ".{nth}")?;
        }
        spdx_ids.insert(&spdx_id)?;
        component.spdx_id = spdx_id;
    }
    Ok(())
}

fn json_str(text: &[u8]) -> bun_core::fmt::JSONFormatterUTF8<'_> {
    bun_core::fmt::format_json_string_utf8(text, Default::default())
}

// `json_str` without the quotes, for text inside a string that the format string writes.
fn json_escaped(text: &[u8]) -> bun_core::fmt::JSONFormatterUTF8<'_> {
    bun_core::fmt::format_json_string_utf8(
        text,
        bun_core::fmt::JSONFormatterUTF8Options { quote: false },
    )
}

fn write_cyclonedx(doc: &Document<'_>, out: &mut Vec<u8>) -> Result<(), crate::Error> {
    let root = &doc.components[0];
    let packages = &doc.components[1..];

    out.extend_from_slice(b"{\n");
    out.extend_from_slice(b"  \"$schema\": \"http://cyclonedx.org/schema/bom-1.5.schema.json\",\n");
    out.extend_from_slice(b"  \"bomFormat\": \"CycloneDX\",\n");
    out.extend_from_slice(b"  \"specVersion\": \"1.5\",\n");
    writeln!(
        out,
        "  \"serialNumber\": \"urn:uuid:{}\",",
        json_escaped(doc.serial_number),
    )?;
    out.extend_from_slice(b"  \"version\": 1,\n");

    out.extend_from_slice(b"  \"metadata\": {\n");
    writeln!(out, "    \"timestamp\": {},", json_str(doc.timestamp))?;
    out.extend_from_slice(b"    \"lifecycles\": [{ \"phase\": \"pre-build\" }],\n");
    out.extend_from_slice(b"    \"tools\": {\n");
    out.extend_from_slice(b"      \"components\": [\n");
    writeln!(
        out,
        "        {{ \"type\": \"application\", \"name\": \"bun\", \"version\": {} }}",
        json_str(bun_core::Global::package_json_version.as_bytes()),
    )?;
    out.extend_from_slice(b"      ]\n");
    out.extend_from_slice(b"    },\n");
    out.extend_from_slice(b"    \"component\": ");
    write_cyclonedx_component(root, out)?;
    out.extend_from_slice(b"\n  },\n");

    out.extend_from_slice(b"  \"components\": [");
    for (i, component) in packages.iter().enumerate() {
        if i != 0 {
            out.push(b',');
        }
        out.extend_from_slice(b"\n    ");
        write_cyclonedx_component(component, out)?;
    }
    if !packages.is_empty() {
        out.extend_from_slice(b"\n  ");
    }
    out.extend_from_slice(b"],\n");

    out.extend_from_slice(b"  \"dependencies\": [\n");
    write_cyclonedx_dependency(&doc.components, root, out)?;
    for component in packages {
        out.extend_from_slice(b",\n");
        write_cyclonedx_dependency(&doc.components, component, out)?;
    }
    out.extend_from_slice(b"\n  ]\n");

    out.extend_from_slice(b"}\n");
    Ok(())
}

fn write_cyclonedx_component(component: &Component, out: &mut Vec<u8>) -> Result<(), crate::Error> {
    out.extend_from_slice(b"{\n");
    out.extend_from_slice(b"      \"type\": \"library\",\n");
    writeln!(out, "      \"bom-ref\": {},", json_str(&component.bom_ref))?;
    writeln!(out, "      \"name\": {},", json_str(&component.name))?;
    if !component.version.is_empty() {
        writeln!(out, "      \"version\": {},", json_str(&component.version))?;
    }
    let scope = match component.scope {
        Scope::Required => "required",
        Scope::Optional => "optional",
        Scope::Excluded => "excluded",
    };
    write!(out, "      \"scope\": \"{scope}\"")?;
    if !component.purl.is_empty() {
        write!(out, ",\n      \"purl\": {}", json_str(&component.purl))?;
    }
    if !component.locator.is_empty() {
        write!(
            out,
            ",\n      \"externalReferences\": [{{ \"type\": \"distribution\", \"url\": {} }}]",
            json_str(&component.locator),
        )?;
    }
    // The integrity's `sha512` is CycloneDX's `SHA-512`.
    if let Some(name) = component.integrity.tag.name()
        && let Some(bits) = name.strip_prefix("sha")
    {
        write!(
            out,
            ",\n      \"hashes\": [{{ \"alg\": \"SHA-{bits}\", \"content\": \"{}\" }}]",
            bun_core::fmt::hex_lower(component.integrity.slice()),
        )?;
    }
    // The name that `npm sbom` has for it.
    if component.bundled {
        out.extend_from_slice(
            b",\n      \"properties\": [{ \"name\": \"cdx:npm:package:bundled\", \"value\": \"true\" }]",
        );
    }
    out.extend_from_slice(b"\n    }");
    Ok(())
}

fn write_cyclonedx_dependency(
    components: &[Component],
    component: &Component,
    out: &mut Vec<u8>,
) -> Result<(), crate::Error> {
    write!(
        out,
        "    {{ \"ref\": {}, \"dependsOn\": [",
        json_str(&component.bom_ref),
    )?;
    for (i, &target) in component.edges.iter().enumerate() {
        if i != 0 {
            out.extend_from_slice(b", ");
        }
        write!(out, "{}", json_str(&components[target as usize].bom_ref))?;
    }
    out.extend_from_slice(b"] }");
    Ok(())
}

fn write_spdx(doc: &Document<'_>, out: &mut Vec<u8>) -> Result<(), crate::Error> {
    let root = &doc.components[0];
    let packages = &doc.components[1..];

    out.extend_from_slice(b"{\n");
    out.extend_from_slice(b"  \"spdxVersion\": \"SPDX-2.3\",\n");
    out.extend_from_slice(b"  \"dataLicense\": \"CC0-1.0\",\n");
    out.extend_from_slice(b"  \"SPDXID\": \"SPDXRef-DOCUMENT\",\n");
    writeln!(out, "  \"name\": {},", json_str(&root.bom_ref))?;
    writeln!(
        out,
        "  \"documentNamespace\": \"https://spdx.org/spdxdocs/{}-{}\",",
        json_escaped(&root.spdx_id),
        json_escaped(doc.serial_number),
    )?;
    out.extend_from_slice(b"  \"creationInfo\": {\n");
    // SPDX 2.3 allows no fraction of a second in `created`.
    let seconds = match bun_core::strings::index_of_any(doc.timestamp, b".Z") {
        Some(end) => &doc.timestamp[..end],
        None => doc.timestamp,
    };
    writeln!(out, "    \"created\": \"{}Z\",", json_escaped(seconds))?;
    writeln!(
        out,
        "    \"creators\": [\"Tool: bun-{}\"]",
        json_escaped(bun_core::Global::package_json_version.as_bytes()),
    )?;
    out.extend_from_slice(b"  },\n");
    writeln!(
        out,
        "  \"documentDescribes\": [\"SPDXRef-Package-{}\"],",
        json_escaped(&root.spdx_id),
    )?;

    out.extend_from_slice(b"  \"packages\": [\n");
    write_spdx_package(root, true, out)?;
    for component in packages {
        out.extend_from_slice(b",\n");
        write_spdx_package(component, false, out)?;
    }
    out.extend_from_slice(b"\n  ],\n");

    // `DEPENDS_ON` is the one form that the scanners read in the direction it has. SPDX has no word for the dependency group.
    out.extend_from_slice(b"  \"relationships\": [\n");
    write!(
        out,
        "    {{ \"spdxElementId\": \"SPDXRef-DOCUMENT\", \"relatedSpdxElement\": \"SPDXRef-Package-{}\", \"relationshipType\": \"DESCRIBES\" }}",
        json_escaped(&root.spdx_id),
    )?;
    for dependent in &doc.components {
        for &dependency in &dependent.edges {
            write!(
                out,
                ",\n    {{ \"spdxElementId\": \"SPDXRef-Package-{}\", \"relatedSpdxElement\": \"SPDXRef-Package-{}\", \"relationshipType\": \"DEPENDS_ON\" }}",
                json_escaped(&dependent.spdx_id),
                json_escaped(&doc.components[dependency as usize].spdx_id),
            )?;
        }
    }
    out.extend_from_slice(b"\n  ]\n");

    out.extend_from_slice(b"}\n");
    Ok(())
}

fn write_spdx_package(
    component: &Component,
    is_root: bool,
    out: &mut Vec<u8>,
) -> Result<(), crate::Error> {
    out.extend_from_slice(b"    {\n");
    writeln!(out, "      \"name\": {},", json_str(&component.name))?;
    writeln!(
        out,
        "      \"SPDXID\": \"SPDXRef-Package-{}\",",
        json_escaped(&component.spdx_id),
    )?;
    if !component.version.is_empty() {
        writeln!(
            out,
            "      \"versionInfo\": {},",
            json_str(&component.version),
        )?;
    }
    if is_root {
        out.extend_from_slice(b"      \"primaryPackagePurpose\": \"LIBRARY\",\n");
    }
    if component.locator.is_empty() {
        out.extend_from_slice(b"      \"downloadLocation\": \"NOASSERTION\",\n");
    } else {
        writeln!(
            out,
            "      \"downloadLocation\": {},",
            json_str(&component.locator),
        )?;
    }
    out.extend_from_slice(b"      \"filesAnalyzed\": false,\n");
    out.extend_from_slice(b"      \"licenseConcluded\": \"NOASSERTION\",\n");
    out.extend_from_slice(b"      \"licenseDeclared\": \"NOASSERTION\",\n");
    out.extend_from_slice(b"      \"copyrightText\": \"NOASSERTION\"");
    if !component.purl.is_empty() {
        write!(
            out,
            ",\n      \"externalRefs\": [{{ \"referenceCategory\": \"PACKAGE-MANAGER\", \"referenceType\": \"purl\", \"referenceLocator\": {} }}]",
            json_str(&component.purl),
        )?;
    }
    // The integrity's `sha512` is SPDX's `SHA512`.
    if let Some(name) = component.integrity.tag.name() {
        out.extend_from_slice(b",\n      \"checksums\": [{ \"algorithm\": \"");
        out.extend(name.as_bytes().iter().map(u8::to_ascii_uppercase));
        write!(
            out,
            "\", \"checksumValue\": \"{}\" }}]",
            bun_core::fmt::hex_lower(component.integrity.slice()),
        )?;
    }
    out.extend_from_slice(b"\n    }");
    Ok(())
}
