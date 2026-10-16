//! `PATH` for a `package.json` script, by the package that owns the script.

use bun_alloc::AllocError;
use bun_core::strings;
use bun_paths::env_path::{bin_dir_parent, is_inside};
use bun_paths::{DELIMITER, EnvPath, SEP, path_literal};

/// The package whose script runs. Another package can link a `node` or a `sh` into a `node_modules/.bin` that a dependency shares.
#[derive(Clone, Copy)]
pub enum Owner<'a> {
    /// The project or one of its workspaces: `node_modules/.bin` comes before the inherited `PATH`.
    Project,
    /// A dependency in this directory: only its own `node_modules/.bin` comes before the inherited `PATH`.
    Dependency(&'a [u8]),
}

impl Owner<'static> {
    /// The owner of the script that started this process.
    pub fn inherited() -> Self {
        match bun_core::env_var::BUN_INTERNAL_SCRIPT_OWNER::get() {
            Some(dir) if !dir.is_empty() => Owner::Dependency(dir),
            _ => Owner::Project,
        }
    }
}

/// The isolated linker gives each package a directory of its own there, with its dependencies.
fn is_in_store_entry(dir: &[u8]) -> bool {
    strings::contains(dir, path_literal!("/node_modules/.bun/").as_bytes())
}

fn append_bin_dir(path: &mut EnvPath, dir: &[u8]) -> Result<(), AllocError> {
    // No command in it could be run by its path.
    if dir.len() + "/node_modules/.bin".len() >= bun_paths::MAX_PATH_BYTES {
        return Ok(());
    }
    let mut builder = path.path_component_builder();
    builder.append(dir);
    builder.append(b"node_modules/.bin");
    builder.apply()
}

/// The `node_modules/.bin` of `from` and of each directory above it, for as long as `is_wanted`.
/// Returns the first directory that was not wanted.
fn append_bin_dirs_while<'a>(
    path: &mut EnvPath,
    from: Option<&'a [u8]>,
    is_wanted: impl Fn(&[u8]) -> bool,
) -> Result<Option<&'a [u8]>, AllocError> {
    let mut next = from;
    while let Some(dir) = next {
        if !is_wanted(dir) {
            break;
        }
        append_bin_dir(path, dir)?;
        next = bun_paths::dirname(dir);
    }
    Ok(next)
}

/// `PATH` for a lifecycle script that `bun install` runs in `cwd`. `project` is where the install runs.
pub fn lifecycle_path(
    owner: Owner<'_>,
    cwd: &[u8],
    inherited: &[u8],
    project: &[u8],
) -> Result<EnvPath, AllocError> {
    let mut path =
        EnvPath::init_capacity(inherited.len() + 1 + b"node_modules/.bin".len() + cwd.len() + 1)?;
    match owner {
        Owner::Project => {
            append_bin_dirs_while(&mut path, Some(cwd), |_| true)?;
            path.append(inherited)?;
        }
        Owner::Dependency(dependency) => {
            append_dependency_path(&mut path, dependency, cwd, inherited, Some(project))?;
        }
    }
    Ok(path)
}

/// `.bin` of the dependency, the inherited `PATH`, then every other `.bin` that `bun` put or would put in front.
pub fn append_dependency_path(
    path: &mut EnvPath,
    dependency: &[u8],
    cwd: &[u8],
    inherited: &[u8],
    project: Option<&[u8]>,
) -> Result<(), AllocError> {
    let shared = append_bin_dirs_while(path, Some(cwd), |dir| {
        is_inside(dir, dependency) || is_in_store_entry(dir)
    })?;

    let is_above_cwd = |dir: &[u8]| is_inside(cwd, dir);
    let is_of_project = |dir: &[u8]| project.is_some_and(|project| is_inside(dir, project));
    // `Some` for an entry that goes behind the inherited `PATH`: (it is written with `shared`, it is the project's).
    let moved = |entry: &[u8]| {
        bin_dir_parent(entry)
            .filter(|_| bun_paths::is_absolute(entry))
            .map(|dir| (is_above_cwd(dir), is_of_project(dir)))
            .filter(|(above_cwd, of_project)| *above_cwd || *of_project)
    };

    for entry in strings::split(inherited, &[DELIMITER]) {
        if moved(entry).is_none() {
            path.append(entry)?;
        }
    }
    append_bin_dirs_while(path, shared, |_| true)?;
    for entry in strings::split(inherited, &[DELIMITER]) {
        if let Some((false, _)) = moved(entry) {
            path.append(entry)?;
        }
    }
    Ok(())
}

/// What `bun run`, `bunx` and `bun run --filter` put in front of `inherited`, with `front` first.
pub struct ScriptPath {
    /// `PATH` for the script.
    pub path: Vec<u8>,
    /// `PATH` as this process inherited it.
    pub inherited: Vec<u8>,
    bin_dirs: BinDirs,
}

enum BinDirs {
    /// This many bytes at the start of `path`.
    Front(usize),
    Owned(Vec<u8>),
}

impl ScriptPath {
    /// The directories that `bun <name>` looks in: `front` and every `node_modules/.bin` from `cwd` up.
    pub fn bin_dirs(&self) -> &[u8] {
        match &self.bin_dirs {
            BinDirs::Front(len) => &self.path[..*len],
            BinDirs::Owned(dirs) => dirs,
        }
    }

    /// `front` ends with a delimiter or is empty. `package_json_dir` is empty unless `cwd` is below it.
    pub fn new(
        owner: Owner<'_>,
        mut front: Vec<u8>,
        package_json_dir: &[u8],
        cwd: &[u8],
        inherited: Vec<u8>,
    ) -> Result<Self, AllocError> {
        if !package_json_dir.is_empty() {
            front.extend_from_slice(package_json_dir);
            front.push(DELIMITER);
        }
        match owner {
            Owner::Project => {
                let mut path = front;
                let mut remain = cwd;
                while let Some(i) = strings::last_index_of_char(remain, SEP) {
                    path.extend_from_slice(strings::without_trailing_slash(remain));
                    path.extend_from_slice(path_literal!("/node_modules/.bin").as_bytes());
                    path.push(DELIMITER);
                    remain = &remain[..i];
                }
                path.extend_from_slice(strings::without_trailing_slash(remain));
                path.extend_from_slice(path_literal!("/node_modules/.bin").as_bytes());
                path.push(DELIMITER);
                let front_len = path.len() - 1;
                path.extend_from_slice(&inherited);
                Ok(Self {
                    path,
                    inherited,
                    bin_dirs: BinDirs::Front(front_len),
                })
            }
            Owner::Dependency(dependency) => {
                let cwd = strings::without_trailing_slash(cwd);
                // Every directory above `cwd` adds a `node_modules/.bin`, each shorter than the one of `cwd`.
                let depth = strings::count_char(cwd, SEP) + 1;
                let bin_dirs_len = front.len() + depth * (cwd.len() + "/node_modules/.bin:".len());
                let mut path = EnvPath::init_capacity(bin_dirs_len + inherited.len())?;
                path.append(front.as_slice())?;
                append_dependency_path(&mut path, dependency, cwd, &inherited, None)?;

                let mut bin_dirs = EnvPath::init_capacity(bin_dirs_len)?;
                bin_dirs.append(front.as_slice())?;
                append_bin_dirs_while(&mut bin_dirs, Some(cwd), |_| true)?;
                Ok(Self {
                    path: path.into_bytes(),
                    inherited,
                    bin_dirs: BinDirs::Owned(bin_dirs.into_bytes()),
                })
            }
        }
    }
}
