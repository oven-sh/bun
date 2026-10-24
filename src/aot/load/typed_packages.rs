#[cfg(test)]
mod manifest_tests;
#[cfg(test)]
mod tests;

use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::config;
use bun_sema::json::Json;
use bun_sema::messages;
use bun_sema::resolve::{CodeHost, EnclosingPackage, Host, ScriptKind, ancestors, inside};
use bun_sema::session::{Arena, Session};
use bun_sema::util::SharedSort;
use bun_sema_driver::host::{Disk, to_native};
use std::collections::BTreeSet;

const SUPPORTED_FORMAT: f64 = 2.0;
const SOUND_DIRECTORY: &[u8] = b".full-types";
const SOUND_MANIFEST: &[u8] = b"full-types.json";
const PACKAGE_MANIFEST: &[u8] = b"package.json";
const NODE_MODULES: &[u8] = b"node_modules";
const INSTALLED_PREFIX: (&[u8], &[u8]) = (b"@oven", b"full-types-");
/// `@oven/full-types-scope__name` is for `@scope/name`.
const SCOPE_SEPARATOR: &[u8] = b"__";
const LAY_SUFFIX: &[u8] = b"/lay";
const ADDED_FILE: &[u8] = b"new";
const FORMER_DIRECTORY: &[u8] = b".sound";
const COMPILER_OPTIONS: &[u8] = b"compilerOptions";
const MEMBERS_ABOUT_FULL_TYPES: [&[u8]; 4] = [b"exports", b"full-types", b"publishConfig", b"bun"];
const ADDS_FILE: &str = "they add {0}, and full types can only replace installed files";
const NEEDS_PACKAGE: &str = "they need the full types of \"{0}\", which are not used";

pub(crate) struct TypedPackages<'a> {
    disk: &'a Disk,
    project_root: Vec<u8>,
    packages: Vec<TypedPackage>,
    unread_folders: Vec<UnreadFolder>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct UnreadFolder {
    pub directory: Vec<u8>,
    pub reason: Vec<u8>,
}

/// Where full types lie. Those in the project count before those that the package ships, installed ones after them.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum TypedPackagePlace {
    Project,
    Installed,
}

pub(crate) enum CompilerOptionsFault {
    /// The member that looks like them, where nothing reads it.
    NotRead(Vec<u8>),
    /// The first error.
    Invalid(Vec<u8>),
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

impl<'a> TypedPackages<'a> {
    pub(crate) fn new(disk: &'a Disk, project_root: &[u8]) -> TypedPackages<'a> {
        let (packages, unread_folders) = find_typed_packages(disk, project_root);
        TypedPackages {
            disk,
            project_root: project_root.to_vec(),
            packages,
            unread_folders,
        }
    }

    /// With the folders named `.full-types` above the project and around `entry_points`: only the project's own is read.
    pub(crate) fn unread_folders<'p>(
        &self,
        entry_points: impl Iterator<Item = &'p [u8]>,
    ) -> BTreeSet<UnreadFolder> {
        let mut around: BTreeSet<Vec<u8>> =
            ancestors(&self.project_root).map(<[u8]>::to_vec).collect();
        for entry_point in entry_points {
            around.extend(ancestors(dirname::<Posix>(entry_point)).map(<[u8]>::to_vec));
        }
        around.remove(&self.project_root);
        let elsewhere = around
            .iter()
            .map(|directory| inside(directory, SOUND_DIRECTORY))
            .filter(|directory| holds_full_types(self.disk, directory))
            .map(|directory| UnreadFolder {
                directory,
                reason: format_sentence(
                    "full types go in the .full-types of the directory that the build runs from, {0}",
                    &[to_native(&self.project_root)],
                ),
            });
        let folders = self.unread_folders.iter().cloned().chain(elsewhere);
        folders
            .map(|folder| UnreadFolder {
                directory: self.display_path(&folder.directory),
                ..folder
            })
            .collect()
    }

    /// The packages that the project has full types for and that are neither among `loaded` nor needed by the full types of one that is.
    pub(crate) fn find_packages_never_loaded(&self, loaded: &BTreeSet<&[u8]>) -> Vec<&[u8]> {
        let mut needed = BTreeSet::new();
        let mut pending: Vec<Vec<u8>> = loaded.iter().map(|name| name.to_vec()).collect();
        while let Some(name) = pending.pop() {
            let typed = self.find_package(&name);
            let Some(Ok(manifest)) = typed.map(|typed| self.read_manifest(typed)) else {
                continue;
            };
            let needs = manifest.needs.into_iter();
            pending.extend(needs.filter(|name| needed.insert(name.clone())));
        }
        let names = self
            .packages
            .iter()
            .filter(|typed| typed.place == TypedPackagePlace::Project);
        names
            .map(|typed| typed.name.as_slice())
            .filter(|&name| !loaded.contains(name) && !needed.contains(name))
            .collect()
    }

    /// The file that states the options of `typed_path`, and what is wrong with them.
    pub(crate) fn find_fault_in_compiler_options(
        &self,
        typed_path: &[u8],
    ) -> Option<(Vec<u8>, CompilerOptionsFault)> {
        let directory = dirname::<Posix>(typed_path);
        let manifest_path = config::find_manifest_of_full_types(self.disk, directory)?;
        let text = self.disk.read(&manifest_path)?;
        let json = self.disk.parse_runtime_package_json(&Arena::new(), &text)?;
        let fault = match json.get(COMPILER_OPTIONS) {
            Some(_) => CompilerOptionsFault::Invalid(self.find_option_error(&manifest_path)?),
            None => CompilerOptionsFault::NotRead(find_misplaced_options(&json, true)?),
        };
        Some((self.display_path(&manifest_path), fault))
    }

    fn find_option_error(&self, manifest_path: &[u8]) -> Option<Vec<u8>> {
        let project = config::load_for_full_types(self.disk, &Session::new(), manifest_path);
        let error = project.errors.first()?;
        let mut sentence = format!("TS{}: ", error.code).into_bytes();
        messages::format(&mut sentence, messages::message(error.code)?.1, &error.args);
        Some(sentence)
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
        self.check_use(typed, package, defined).err()
    }

    pub(crate) fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        self.package_of(path).map(|_| typed_script_kind(path))
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
    ) -> Result<(), Vec<u8>> {
        let manifest = self.check_pins(typed, package.directory, package.version, defined)?;
        let mut visited = BTreeSet::from([package.directory.to_vec()]);
        let mut pending = vec![(package.directory.to_vec(), manifest.needs)];
        while let Some((directory, needs)) = pending.pop() {
            for name in needs {
                let Some(needed) = self.find_installed_copy(&directory, &name) else {
                    return Err(format_sentence(NEEDS_PACKAGE, &[&name]));
                };
                if !visited.insert(needed.directory.clone()) {
                    continue;
                }
                let pins = self.find_package(&needed.name).map(|typed| {
                    self.check_pins(typed, &needed.directory, &needed.version, defined)
                });
                let Some(Ok(manifest)) = pins else {
                    return Err(format_sentence(NEEDS_PACKAGE, &[&name]));
                };
                pending.push((needed.directory, manifest.needs));
            }
        }
        Ok(())
    }

    fn check_pins(
        &self,
        typed: &TypedPackage,
        installed_directory: &[u8],
        installed_version: &[u8],
        defined: &dyn Fn(&[u8]) -> Option<Vec<u8>>,
    ) -> Result<SoundManifest, Vec<u8>> {
        let manifest = self.read_manifest(typed)?;
        if manifest.version != installed_version {
            return Err(format_sentence(
                "they are for version {0}, but {1} is installed. \
                 Replace them with the full types for {1}, or remove them",
                &[&manifest.version, installed_version],
            ));
        }
        for (name, value) in &manifest.when {
            if defined(name).as_ref() != Some(value) {
                return Err(format_sentence(
                    "they need {0} to be defined as \"{1}\". Pass --define '{0}=\"{1}\"'",
                    &[name, value],
                ));
            }
        }
        let is_missing = |path: &[u8]| !self.disk.is_file(&typed_file_path(typed, path));
        if let Some(path) = manifest.lay.iter().find(|path| is_missing(path)) {
            return Err(format_sentence("lay/{0} is missing", &[path]));
        }
        let is_added = |path: &[u8]| !self.disk.is_file(&inside(installed_directory, path));
        if let Some(path) = manifest.lay.iter().find(|path| is_added(path)) {
            return Err(format_sentence(ADDS_FILE, &[path]));
        }
        Ok(manifest)
    }

    fn read_manifest(&self, typed: &TypedPackage) -> Result<SoundManifest, Vec<u8>> {
        let text = self.disk.read(&inside(&typed.directory, SOUND_MANIFEST));
        let json = text.and_then(|text| self.disk.parse_runtime_tsconfig(&Arena::new(), &text));
        let json = json.ok_or_else(|| b"full-types.json is not valid JSON".to_vec())?;
        parse_manifest(&json, &typed.name)
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

// Of the outermost members, only those about full types are looked into.
fn find_misplaced_options(json: &Json, is_outermost: bool) -> Option<Vec<u8>> {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return None;
    }
    json.as_object()?.iter().find_map(|(name, value)| {
        if is_spelled(name, COMPILER_OPTIONS) {
            return Some(name.clone());
        }
        if is_outermost && !MEMBERS_ABOUT_FULL_TYPES.contains(&name.as_slice()) {
            return None;
        }
        let member = find_misplaced_options(value, false)?;
        Some([name.as_slice(), b" > ", member.as_slice()].concat())
    })
}

fn is_spelled(name: &[u8], word: &[u8]) -> bool {
    let letters = name.iter().filter(|byte| byte.is_ascii_alphanumeric());
    let written = letters.map(u8::to_ascii_lowercase);
    written.eq(word.iter().map(u8::to_ascii_lowercase))
}

fn format_sentence(template: &str, arguments: &[&[u8]]) -> Vec<u8> {
    let mut sentence = Vec::new();
    messages::format(&mut sentence, template, arguments);
    sentence
}

/// One full types for each name: the project's, else the one in the nearest `node_modules`.
fn find_typed_packages(disk: &Disk, project_root: &[u8]) -> (Vec<TypedPackage>, Vec<UnreadFolder>) {
    let mut candidates = find_project_packages(disk, &inside(project_root, SOUND_DIRECTORY));
    let mut unread = find_misnamed_directories(disk, project_root);
    let scope_path = inside(NODE_MODULES, INSTALLED_PREFIX.0);
    for ancestor in ancestors(project_root) {
        let scope_directory = inside(ancestor, &scope_path);
        for folder in disk.entries(&scope_directory).1 {
            let directory = inside(&scope_directory, &folder);
            match folder.strip_prefix(INSTALLED_PREFIX.1) {
                Some(name) => candidates.push(TypedPackage {
                    name: typed_package_name(name),
                    directory,
                    place: TypedPackagePlace::Installed,
                }),
                None if is_laid_out_as_full_types(disk, &directory) => unread.push(UnreadFolder {
                    directory,
                    reason: b"a package that holds full types is named @oven/full-types-<name>"
                        .to_vec(),
                }),
                None => {}
            }
        }
    }
    let mut names = BTreeSet::new();
    let mut found = Vec::new();
    for typed in candidates {
        if !disk.is_file(&inside(&typed.directory, SOUND_MANIFEST)) {
            unread.push(UnreadFolder {
                directory: typed.directory,
                reason: b"it has no full-types.json. Add the file, or remove the folder".to_vec(),
            });
        } else if is_valid_package_name(&typed.name) && names.insert(typed.name.clone()) {
            found.push(typed);
        }
    }
    found.shared_sort_unstable_by(|a, b| a.name.cmp(&b.name));
    (found, unread)
}

fn find_project_packages(disk: &Disk, sound_directory: &[u8]) -> Vec<TypedPackage> {
    let place = TypedPackagePlace::Project;
    let mut found = Vec::new();
    for name in disk.entries(sound_directory).1 {
        let directory = inside(sound_directory, &name);
        if !name.starts_with(b"@") || disk.is_file(&inside(&directory, SOUND_MANIFEST)) {
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

fn is_laid_out_as_full_types(disk: &Disk, directory: &[u8]) -> bool {
    disk.is_file(&inside(directory, SOUND_MANIFEST))
        || disk.is_dir(&[directory, LAY_SUFFIX].concat())
}

fn holds_full_types(disk: &Disk, directory: &[u8]) -> bool {
    disk.entries(directory).1.iter().any(|name| {
        let member = inside(directory, name);
        let is_scope = name.starts_with(b"@");
        is_laid_out_as_full_types(disk, &member) || (is_scope && holds_full_types(disk, &member))
    })
}

fn is_misspelled_directory(name: &[u8]) -> bool {
    name == FORMER_DIRECTORY || is_spelled(name, b"fulltypes") || is_spelled(name, b"fulltype")
}

fn find_misnamed_directories(disk: &Disk, project_root: &[u8]) -> Vec<UnreadFolder> {
    let is_read = |name: &[u8]| match disk.is_case_sensitive() {
        true => name == SOUND_DIRECTORY,
        false => name.eq_ignore_ascii_case(SOUND_DIRECTORY),
    };
    let names = disk.entries(project_root).1.into_iter();
    names
        .filter(|name| is_misspelled_directory(name) && !is_read(name))
        .map(|name| inside(project_root, &name))
        .filter(|directory| holds_full_types(disk, directory))
        .map(|directory| UnreadFolder {
            directory,
            reason: b"the folder has to be named .full-types".to_vec(),
        })
        .collect()
}

fn typed_package_name(folder: &[u8]) -> Vec<u8> {
    match strings::split_once(folder, SCOPE_SEPARATOR) {
        Some((scope, name)) => [b"@", scope, b"/", name].concat(),
        None => folder.to_vec(),
    }
}

fn parse_manifest(json: &Json, package_name: &[u8]) -> Result<SoundManifest, Vec<u8>> {
    let invalid = |name: &[u8]| {
        format_sentence(
            "\"{0}\" in full-types.json is missing or not valid",
            &[name],
        )
    };
    let Some(Json::Number(format)) = json.get(b"format") else {
        return Err(invalid(b"format"));
    };
    if *format != SUPPORTED_FORMAT {
        return Err(
            b"this version of Bun doesn't support the \"format\" in full-types.json".to_vec(),
        );
    }
    let text_of = |key: &[u8]| json.get(key)?.as_str();
    let written_name = text_of(b"name").ok_or_else(|| invalid(b"name"))?;
    if written_name != package_name {
        return Err(format_sentence(
            "the \"name\" in full-types.json is \"{0}\", but the folder is for \"{1}\"",
            &[written_name, package_name],
        ));
    }
    let version = text_of(b"version")
        .ok_or_else(|| invalid(b"version"))?
        .to_vec();
    let when = parse_string_map(json, b"when").ok_or_else(|| invalid(b"when"))?;
    let lay = parse_string_map(json, b"lay").ok_or_else(|| invalid(b"lay"))?;
    let needs = parse_needs(json)
        .ok_or_else(|| b"\"needs\" in full-types.json must be a list of package names".to_vec())?;
    if let Some((path, _)) = lay.iter().find(|(path, _)| !is_valid_path(path)) {
        return Err(format_sentence(
            "\"{0}\" in full-types.json is not a path inside the package",
            &[path],
        ));
    }
    if lay.is_empty() {
        return Err(b"\"lay\" in full-types.json is empty".to_vec());
    }
    if let Some((path, _)) = lay.iter().find(|(_, replaced)| replaced == ADDED_FILE) {
        return Err(format_sentence(ADDS_FILE, &[path]));
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
