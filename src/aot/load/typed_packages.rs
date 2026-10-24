#[cfg(test)]
mod manifest_tests;
#[cfg(test)]
mod tests;

use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::json::Json;
use bun_sema::messages;
use bun_sema::resolve::{CodeHost, EnclosingPackage, Host, ScriptKind, ancestors, inside};
use bun_sema::session::Arena;
use bun_sema::util::SharedSort;
use bun_sema_driver::host::{Disk, to_native};
use std::collections::BTreeSet;

const SUPPORTED_FORMAT: f64 = 2.0;
const SOUND_DIRECTORY: &[u8] = b".sound";
const SOUND_MANIFEST: &[u8] = b"sound.json";
const PACKAGE_MANIFEST: &[u8] = b"package.json";
const NODE_MODULES: &[u8] = b"node_modules";
/// What the name of a package that holds the typed version of another package starts with.
const INSTALLED_PREFIX: (&[u8], &[u8]) = (b"@oven", b"sound-");
/// `@oven/sound-scope__name` is for `@scope/name`.
const SCOPE_SEPARATOR: &[u8] = b"__";
const LAY_SUFFIX: &[u8] = b"/lay";
const ADDED_FILE: &[u8] = b"new";

pub(crate) struct TypedPackages<'a> {
    disk: &'a Disk,
    project_root: Vec<u8>,
    packages: Vec<TypedPackage>,
}

/// Where a typed version lies. One in the project counts before the one that the package ships, an installed one after it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum TypedPackagePlace {
    Project,
    Installed,
}

struct TypedPackage {
    name: Vec<u8>,
    directory: Vec<u8>,
    place: TypedPackagePlace,
}

struct SoundManifest {
    version: Vec<u8>,
    when: Vec<(Vec<u8>, Vec<u8>)>,
    lay: Vec<Vec<u8>>,
    needs: Vec<Vec<u8>>,
}

struct InstalledCopy {
    directory: Vec<u8>,
    name: Vec<u8>,
    version: Vec<u8>,
}

enum ManifestMismatch {
    InvalidJson,
    InvalidManifest,
    UnsupportedFormat,
    InvalidNeeds,
    InvalidPath { path: Vec<u8> },
    EmptyLay,
    AddsFile { path: Vec<u8> },
    VersionDiffers { typed: Vec<u8>, installed: Vec<u8> },
    DefineMissing { name: Vec<u8>, value: Vec<u8> },
    TypedFileMissing { path: Vec<u8> },
    NeedsPackage { name: Vec<u8> },
}

impl<'a> TypedPackages<'a> {
    pub(crate) fn new(disk: &'a Disk, project_root: &[u8]) -> TypedPackages<'a> {
        TypedPackages {
            disk,
            project_root: project_root.to_vec(),
            packages: find_typed_packages(disk, project_root),
        }
    }

    pub(crate) fn typed_version(
        &self,
        place: TypedPackagePlace,
        path: &[u8],
        package: Option<EnclosingPackage<'_>>,
    ) -> Option<Vec<u8>> {
        let package = package?;
        let typed = self.find_package(package.name)?;
        if typed.place != place {
            return None;
        }
        let relative = package.relative_path(path);
        if !is_valid_path(relative) {
            return None;
        }
        let typed_path = typed_file_path(typed, relative);
        self.disk.is_file(&typed_path).then_some(typed_path)
    }

    pub(crate) fn find_manifest_mismatch(
        &self,
        package: EnclosingPackage<'_>,
        defined: &dyn Fn(&[u8]) -> Option<Vec<u8>>,
    ) -> Option<Vec<u8>> {
        let typed = self.find_package(package.name)?;
        let mismatch = self.check_use(typed, package, defined).err()?;
        Some(mismatch.sentence())
    }

    pub(crate) fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        if self.packages.is_empty() {
            return None;
        }
        self.package_of(path).map(|_| typed_script_kind(path))
    }

    pub(crate) fn manifest_path(&self, typed_path: &[u8]) -> Option<Vec<u8>> {
        let package = self.package_of(typed_path)?;
        Some(inside(&package.directory, SOUND_MANIFEST))
    }

    pub(crate) fn is_project_version(&self, typed_path: &[u8]) -> bool {
        self.package_of(typed_path).is_some()
    }

    pub(crate) fn display_directory(&self, typed_path: &[u8]) -> Vec<u8> {
        match self.package_of(typed_path) {
            Some(package) => self.display_path(&package.directory),
            None => self.display_path(dirname::<Posix>(typed_path)),
        }
    }

    pub(crate) fn display_directory_of_package(&self, name: &[u8]) -> Vec<u8> {
        match self.find_package(name) {
            Some(package) => self.display_path(&package.directory),
            None => inside(SOUND_DIRECTORY, name),
        }
    }

    fn display_path(&self, directory: &[u8]) -> Vec<u8> {
        let in_project = directory
            .strip_prefix(self.project_root.as_slice())
            .and_then(|rest| rest.strip_prefix(b"/"));
        in_project.unwrap_or_else(|| to_native(directory)).to_vec()
    }

    pub(crate) fn display_relative_path<'p>(&self, typed_path: &'p [u8]) -> &'p [u8] {
        let directory = match self.package_of(typed_path) {
            Some(package) => package.directory.as_slice(),
            None => dirname::<Posix>(typed_path),
        };
        let relative = typed_path.strip_prefix(directory).unwrap_or(typed_path);
        relative.strip_prefix(b"/").unwrap_or(relative)
    }

    fn find_package(&self, name: &[u8]) -> Option<&TypedPackage> {
        let index = self
            .packages
            .binary_search_by(|typed| typed.name.as_slice().cmp(name))
            .ok()?;
        Some(&self.packages[index])
    }

    fn package_of(&self, typed_path: &[u8]) -> Option<&TypedPackage> {
        if self.packages.is_empty() {
            return None;
        }
        ancestors(dirname::<Posix>(typed_path)).find_map(|ancestor| {
            let directory = ancestor.strip_suffix(LAY_SUFFIX)?;
            let mut packages = self.packages.iter();
            packages.find(|typed| typed.directory == directory)
        })
    }

    fn check_use(
        &self,
        typed: &TypedPackage,
        package: EnclosingPackage<'_>,
        defined: &dyn Fn(&[u8]) -> Option<Vec<u8>>,
    ) -> Result<(), ManifestMismatch> {
        let manifest = self.check_pins(typed, package.version, defined)?;
        let mut visited = BTreeSet::from([package.directory.to_vec()]);
        let mut pending = vec![(package.directory.to_vec(), manifest.needs)];
        while let Some((directory, needs)) = pending.pop() {
            for name in needs {
                let Some(needed) = self.find_installed_copy(&directory, &name) else {
                    return Err(ManifestMismatch::NeedsPackage { name });
                };
                if !visited.insert(needed.directory.clone()) {
                    continue;
                }
                let pins = self
                    .find_package(&needed.name)
                    .map(|typed| self.check_pins(typed, &needed.version, defined));
                let Some(Ok(manifest)) = pins else {
                    return Err(ManifestMismatch::NeedsPackage { name });
                };
                pending.push((needed.directory, manifest.needs));
            }
        }
        Ok(())
    }

    fn check_pins(
        &self,
        typed: &TypedPackage,
        installed_version: &[u8],
        defined: &dyn Fn(&[u8]) -> Option<Vec<u8>>,
    ) -> Result<SoundManifest, ManifestMismatch> {
        let manifest = self.read_manifest(typed)?;
        if manifest.version != installed_version {
            return Err(ManifestMismatch::VersionDiffers {
                typed: manifest.version,
                installed: installed_version.to_vec(),
            });
        }
        for (name, value) in &manifest.when {
            if defined(name).as_ref() != Some(value) {
                return Err(ManifestMismatch::DefineMissing {
                    name: name.clone(),
                    value: value.clone(),
                });
            }
        }
        let is_missing = |path: &[u8]| !self.disk.is_file(&typed_file_path(typed, path));
        if let Some(path) = manifest.lay.iter().find(|path| is_missing(path)) {
            return Err(ManifestMismatch::TypedFileMissing { path: path.clone() });
        }
        Ok(manifest)
    }

    fn read_manifest(&self, typed: &TypedPackage) -> Result<SoundManifest, ManifestMismatch> {
        let text = self.disk.read(&inside(&typed.directory, SOUND_MANIFEST));
        let json = text.and_then(|text| self.disk.parse_runtime_tsconfig(&Arena::new(), &text));
        parse_manifest(&json.ok_or(ManifestMismatch::InvalidJson)?, &typed.name)
    }

    fn find_installed_copy(&self, directory: &[u8], name: &[u8]) -> Option<InstalledCopy> {
        let relative_path = [NODE_MODULES, b"/", name, b"/", PACKAGE_MANIFEST].concat();
        let manifest_path = ancestors(directory)
            .map(|ancestor| inside(ancestor, &relative_path))
            .find(|path| self.disk.is_file(path))?;
        let manifest_path = self.disk.realpath(&manifest_path);
        let text = self.disk.read(&manifest_path)?;
        let json = self.disk.parse_runtime_package_json(&Arena::new(), &text)?;
        Some(InstalledCopy {
            directory: dirname::<Posix>(&manifest_path).to_vec(),
            name: first_non_empty_string(&json, b"name")?.to_vec(),
            version: first_non_empty_string(&json, b"version")?.to_vec(),
        })
    }
}

impl ManifestMismatch {
    fn sentence(&self) -> Vec<u8> {
        match self {
            ManifestMismatch::InvalidJson => {
                format_sentence("its sound.json is not valid JSON", &[])
            }
            ManifestMismatch::InvalidManifest => {
                format_sentence("its sound.json is not valid", &[])
            }
            ManifestMismatch::UnsupportedFormat => format_sentence(
                "this version of Bun doesn't support the \"sound\" version in its sound.json",
                &[],
            ),
            ManifestMismatch::InvalidNeeds => format_sentence(
                "\"needs\" in its sound.json must be a list of package names",
                &[],
            ),
            ManifestMismatch::InvalidPath { path } => format_sentence(
                "\"{0}\" in its sound.json is not a path inside the package",
                &[path],
            ),
            ManifestMismatch::EmptyLay => {
                format_sentence("\"lay\" in its sound.json is empty", &[])
            }
            ManifestMismatch::AddsFile { path } => format_sentence(
                "it adds {0}, and a typed version can only replace installed files",
                &[path],
            ),
            ManifestMismatch::VersionDiffers { typed, installed } => format_sentence(
                "it is for version {0}, but {1} is installed. \
                 Replace it with the typed version for {1}, or remove it",
                &[typed, installed],
            ),
            ManifestMismatch::DefineMissing { name, value } => format_sentence(
                "it needs {0} to be defined as \"{1}\". Pass --define '{0}=\"{1}\"'",
                &[name, value],
            ),
            ManifestMismatch::TypedFileMissing { path } => {
                format_sentence("lay/{0} is missing", &[path])
            }
            ManifestMismatch::NeedsPackage { name } => format_sentence(
                "it needs the typed version of \"{0}\", which is not used",
                &[name],
            ),
        }
    }
}

fn format_sentence(template: &str, arguments: &[&[u8]]) -> Vec<u8> {
    let mut sentence = Vec::new();
    messages::format(&mut sentence, template, arguments);
    sentence
}

/// One typed version for each name: the project's, else the one in the nearest `node_modules`.
fn find_typed_packages(disk: &Disk, project_root: &[u8]) -> Vec<TypedPackage> {
    let has_manifest = |directory: &[u8]| disk.is_file(&inside(directory, SOUND_MANIFEST));
    let mut candidates = find_project_packages(disk, &inside(project_root, SOUND_DIRECTORY));
    let scope_path = inside(NODE_MODULES, INSTALLED_PREFIX.0);
    for ancestor in ancestors(project_root) {
        let scope_directory = inside(ancestor, &scope_path);
        candidates.extend(find_installed_packages(disk, &scope_directory));
    }
    let mut names = BTreeSet::new();
    let mut found = Vec::new();
    for typed in candidates {
        let is_typed_version = is_valid_package_name(&typed.name) && has_manifest(&typed.directory);
        if is_typed_version && names.insert(typed.name.clone()) {
            found.push(typed);
        }
    }
    found.shared_sort_unstable_by(|a, b| a.name.cmp(&b.name));
    found
}

fn find_project_packages(disk: &Disk, sound_directory: &[u8]) -> Vec<TypedPackage> {
    let has_manifest = |directory: &[u8]| disk.is_file(&inside(directory, SOUND_MANIFEST));
    let place = TypedPackagePlace::Project;
    let mut found = Vec::new();
    for name in disk.entries(sound_directory).1 {
        let directory = inside(sound_directory, &name);
        if has_manifest(&directory) {
            found.push(TypedPackage {
                name,
                directory,
                place,
            });
            continue;
        }
        for member in disk.entries(&directory).1 {
            found.push(TypedPackage {
                name: inside(&name, &member),
                directory: inside(&directory, &member),
                place,
            });
        }
    }
    found
}

fn find_installed_packages(disk: &Disk, scope_directory: &[u8]) -> Vec<TypedPackage> {
    let folders = disk.entries(scope_directory).1.into_iter();
    let packages = folders.filter_map(|folder| {
        Some(TypedPackage {
            name: typed_package_name(folder.strip_prefix(INSTALLED_PREFIX.1)?),
            directory: inside(scope_directory, &folder),
            place: TypedPackagePlace::Installed,
        })
    });
    packages.collect()
}

fn typed_package_name(folder: &[u8]) -> Vec<u8> {
    match strings::split_once(folder, SCOPE_SEPARATOR) {
        Some((scope, name)) => [b"@", scope, b"/", name].concat(),
        None => folder.to_vec(),
    }
}

fn parse_manifest(json: &Json, package_name: &[u8]) -> Result<SoundManifest, ManifestMismatch> {
    const INVALID: ManifestMismatch = ManifestMismatch::InvalidManifest;
    let Some(Json::Number(format)) = json.get(b"sound") else {
        return Err(INVALID);
    };
    if *format != SUPPORTED_FORMAT {
        return Err(ManifestMismatch::UnsupportedFormat);
    }
    let text_of = |key: &[u8]| json.get(key)?.as_str();
    if text_of(b"name") != Some(package_name) {
        return Err(INVALID);
    }
    let version = text_of(b"version").ok_or(INVALID)?.to_vec();
    let when = parse_string_map(json, b"when").ok_or(INVALID)?;
    let lay = parse_string_map(json, b"lay").ok_or(INVALID)?;
    let needs = parse_needs(json).ok_or(ManifestMismatch::InvalidNeeds)?;
    if let Some((path, _)) = lay.iter().find(|(path, _)| !is_valid_path(path)) {
        return Err(ManifestMismatch::InvalidPath { path: path.clone() });
    }
    if lay.is_empty() {
        return Err(ManifestMismatch::EmptyLay);
    }
    if let Some((path, _)) = lay.iter().find(|(_, replaced)| replaced == ADDED_FILE) {
        return Err(ManifestMismatch::AddsFile { path: path.clone() });
    }
    Ok(SoundManifest {
        version,
        when,
        lay: lay.into_iter().map(|(path, _)| path).collect(),
        needs,
    })
}

fn parse_string_map(json: &Json, key: &[u8]) -> Option<Vec<(Vec<u8>, Vec<u8>)>> {
    let Some(property) = json.get(key) else {
        return Some(Vec::new());
    };
    let entries = property.as_object()?.iter();
    entries
        .map(|(name, value)| Some((name.clone(), value.as_str()?.to_vec())))
        .collect()
}

fn parse_needs(json: &Json) -> Option<Vec<Vec<u8>>> {
    let Some(property) = json.get(b"needs") else {
        return Some(Vec::new());
    };
    let names = property.as_array()?.iter().map(|item| {
        let name = item.as_str()?;
        is_valid_package_name(name).then(|| name.to_vec())
    });
    names.collect()
}

fn first_non_empty_string<'j>(json: &'j Json, key: &[u8]) -> Option<&'j [u8]> {
    let entry = json.as_object()?.iter().find(|entry| entry.0 == key)?;
    entry.1.as_str().filter(|text| !text.is_empty())
}

fn is_valid_path(path: &[u8]) -> bool {
    !strings::contains_char(path, b'\\')
        && path != PACKAGE_MANIFEST
        && strings::split(path, b"/").all(|segment| !matches!(segment, b"" | b"." | b".."))
}

fn is_valid_package_name(name: &[u8]) -> bool {
    let max_separator_count = usize::from(name.starts_with(b"@"));
    is_valid_path(name) && strings::count_char(name, b'/') <= max_separator_count
}

fn typed_file_path(typed: &TypedPackage, relative: &[u8]) -> Vec<u8> {
    [typed.directory.as_slice(), LAY_SUFFIX, b"/", relative].concat()
}

fn typed_script_kind(path: &[u8]) -> ScriptKind {
    match ScriptKind::from_file_name(path) {
        Some(ScriptKind::Jsx | ScriptKind::Tsx) => ScriptKind::Tsx,
        Some(ScriptKind::Js | ScriptKind::Ts) | None => ScriptKind::Ts,
    }
}
