mod declarations;
mod entry_points;
mod package_files;
mod typed_files;

use bstr::BStr;
use bun_alloc::Arena;
use bun_ast::Expr;
use bun_core::{Global, Output};
use bun_options_types::context::ContextData;
use bun_paths::platform::Auto;
use bun_paths::resolve_path::join_abs_string;
use bun_paths::string_paths::without_trailing_slash_windows_path;

pub(crate) use self::declarations::{add_declaration_files, is_declaration_file};
pub(crate) use self::package_files::add_package_files;
pub(crate) use self::typed_files::{TypedOutputs, add_typed_files, is_typed_file};
use super::configuration::exit_without_entry_point;
use crate::cli::script_or_command::nearest_package_json;

const EXTERNAL_PACKAGE_FIELDS: [&[u8]; 3] = [
    b"dependencies",
    b"peerDependencies",
    b"optionalDependencies",
];

#[derive(Debug, PartialEq, Eq)]
pub(super) enum LibraryError {
    OutdirHoldsProject { outdir: Vec<u8> },
    OutdirLinksPackageJson { written: Vec<u8> },
    EntryPointInsideOutdir { entry_point: Vec<u8> },
    UnparsablePackageJson { path: Vec<u8> },
    NoEntryPoint { directory: Vec<u8> },
}

impl LibraryError {
    fn write_message(&self, out: &mut Vec<u8>) {
        let mut write = |parts: &[&[u8]]| out.extend_from_slice(&parts.concat());
        match self {
            Self::OutdirHoldsProject { outdir } => write(&[
                b"--library writes a package.json into --outdir, so --outdir can't be the project folder (",
                outdir,
                b"). Use a folder inside it, such as --outdir=dist",
            ]),
            Self::OutdirLinksPackageJson { written } => write(&[
                b"--library writes a package.json into --outdir, but ",
                written,
                b" is a link to the project's own package.json. Choose another --outdir",
            ]),
            Self::EntryPointInsideOutdir { entry_point } => write(&[
                b"the entry point ",
                entry_point,
                b" is inside --outdir, where it would be overwritten. Choose another --outdir",
            ]),
            Self::UnparsablePackageJson { path } => write(&[path, b" could not be parsed"]),
            Self::NoEntryPoint { directory } => write(&[
                b"No entry point. There is no \"exports\", \"module\" or \"main\" in package.json that is a source file, and no index.ts, index.tsx, index.mts or index.js in ",
                directory,
                b" or in its src folder",
            ]),
        }
    }

    #[cold]
    pub(super) fn exit(&self) -> ! {
        let mut message = Vec::new();
        self.write_message(&mut message);
        if let Self::NoEntryPoint { .. } = self {
            exit_without_entry_point(&message);
        }
        Output::err_generic("{}", (BStr::new(&message),));
        Global::exit(1);
    }
}

struct Project {
    directory: Vec<u8>,
    package_json: Option<PackageJsonFile>,
}

struct PackageJsonFile {
    path: Vec<u8>,
    contents: Vec<u8>,
}

impl Project {
    fn find(working_directory: &[u8]) -> Project {
        match nearest_package_json(working_directory) {
            Some((directory, path, contents)) => Project {
                directory: directory.to_vec(),
                package_json: Some(PackageJsonFile { path, contents }),
            },
            None => Project {
                directory: bun_core::strings::without_trailing_slash(working_directory).to_vec(),
                package_json: None,
            },
        }
    }

    // The result refers to `self` and to `arena`.
    fn parse_package_json(&self, arena: &Arena) -> Result<Option<Expr>, LibraryError> {
        let Some(file) = &self.package_json else {
            return Ok(None);
        };
        bun_ast::initialize_store();
        let source = bun_ast::Source::init_path_string(&file.path[..], &file.contents[..]);
        let mut log = bun_ast::Log::init();
        match bun_parsers::json::parse_package_json_utf8(&source, &mut log, arena) {
            Ok(root) => Ok(Some(root)),
            Err(_) => Err(LibraryError::UnparsablePackageJson {
                path: file.path.clone(),
            }),
        }
    }
}

fn absolute_path(working_directory: &[u8], path: &[u8]) -> Vec<u8> {
    join_abs_string::<Auto>(working_directory, &[path]).to_vec()
}

// `path` is `folder` or is inside it. Case is not ignored: the real path settles a name in another case.
fn is_or_holds(folder: &[u8], path: &[u8]) -> bool {
    // Only a root has a separator at its end.
    let folder = folder.strip_suffix(&[bun_paths::SEP]).unwrap_or(folder);
    match path.strip_prefix(folder) {
        Some([]) => true,
        Some([first, ..]) => bun_paths::is_sep_native(*first),
        None => false,
    }
}

fn real_path(directory: &[u8]) -> Option<Vec<u8>> {
    let opened = bun_sys::Dir::open(directory).ok()?;
    let mut buffer = bun_paths::path_buffer_pool::get();
    Some(opened.get_fd_path(&mut buffer).ok()?.to_vec())
}

struct Outdir {
    // `--outdir` on the working directory, with `.` and `..` resolved and no separator at its end.
    folder: Vec<u8>,
    // Other paths of `folder`: its real path, and its path below the project folder as that is spelled.
    aliases: Vec<Vec<u8>>,
    as_written: Vec<u8>,
}

impl Outdir {
    fn find(
        working_directory: &[u8],
        as_written: &[u8],
        project: &Project,
    ) -> Result<Outdir, LibraryError> {
        let folder = join_abs_string::<Auto>(working_directory, &[as_written]);
        let mut outdir = Outdir {
            folder: without_trailing_slash_windows_path(folder).to_vec(),
            aliases: Vec::new(),
            as_written: as_written.to_vec(),
        };
        if outdir.holds(&project.directory) {
            return Err(LibraryError::OutdirHoldsProject {
                outdir: outdir.folder,
            });
        }
        let Ok(opened) = bun_sys::Dir::open(&outdir.folder) else {
            return Ok(outdir);
        };
        let mut buffer = bun_paths::path_buffer_pool::get();
        if let Ok(real) = opened.get_fd_path(&mut buffer) {
            let real: &[u8] = real;
            // A working directory from `getcwd()` has no link in it. On Windows it is kept as it was spelled.
            let project_real = match cfg!(windows) {
                true => real_path(&project.directory),
                false => None,
            };
            let project_directory = project_real.as_deref().unwrap_or(&project.directory);
            if is_or_holds(real, project_directory) {
                return Err(LibraryError::OutdirHoldsProject {
                    outdir: real.to_vec(),
                });
            }
            if real != outdir.folder {
                outdir.aliases.push(real.to_vec());
            }
            if let Some(project_real) = &project_real
                && project_real[..] != project.directory[..]
                && let Some([separator, below @ ..]) = real.strip_prefix(&project_real[..])
                && bun_paths::is_sep_native(*separator)
            {
                outdir
                    .aliases
                    .push(absolute_path(&project.directory, below));
            }
        }
        if let Some(package_json) = &project.package_json
            && let Ok(written) = bun_sys::fstatat(opened.fd, bun_core::zstr!("package.json"))
            && let Ok(own) = bun_sys::stat(&bun_core::ZBox::from_bytes(&package_json.path))
            // A file system without inode numbers reports `st_ino == 0`.
            && written.st_ino != 0
            && written.st_ino == own.st_ino
            && written.st_dev == own.st_dev
        {
            let written = [&outdir.folder[..], &[bun_paths::SEP], b"package.json"].concat();
            return Err(LibraryError::OutdirLinksPackageJson { written });
        }
        Ok(outdir)
    }

    fn holds(&self, path: &[u8]) -> bool {
        let holds = |folder: &[u8]| is_or_holds(folder, path);
        holds(&self.folder) || self.aliases.iter().any(|alias| holds(alias))
    }
}

pub(crate) struct Library {
    project: Project,
    outdir: Outdir,
    external_packages: Vec<Box<[u8]>>,
}

impl Library {
    // Finds the entry points too, when `ctx` has none.
    #[cold]
    pub(crate) fn find(ctx: &mut ContextData) -> Library {
        let working_directory = ctx.args.absolute_working_dir.as_deref().unwrap_or_default();
        let found = Library::try_find(
            working_directory,
            &ctx.bundler_options.outdir,
            &mut ctx.args.entry_points,
        );
        found.unwrap_or_else(|error| error.exit())
    }

    fn try_find(
        working_directory: &[u8],
        outdir: &[u8],
        entry_points: &mut Vec<Box<[u8]>>,
    ) -> Result<Library, LibraryError> {
        let project = Project::find(working_directory);
        let outdir = Outdir::find(working_directory, outdir, &project)?;
        let arena = Arena::new();
        let package_json = if entry_points.is_empty() {
            let package_json = project.parse_package_json(&arena)?;
            *entry_points =
                entry_points::find_entry_points(&project.directory, package_json.as_ref(), &outdir);
            if entry_points.is_empty() {
                return Err(LibraryError::NoEntryPoint {
                    directory: project.directory,
                });
            }
            package_json
        } else {
            let is_overwritten =
                |entry_point: &[u8]| outdir.holds(&absolute_path(working_directory, entry_point));
            if let Some(entry_point) = entry_points.iter().find(|it| is_overwritten(it)) {
                return Err(LibraryError::EntryPointInsideOutdir {
                    entry_point: entry_point.to_vec(),
                });
            }
            project.parse_package_json(&arena)?
        };
        let mut external_packages: Vec<Box<[u8]>> = Vec::new();
        if let Some(package_json) = package_json {
            for field in EXTERNAL_PACKAGE_FIELDS {
                if let Some(dependencies) = package_json.get(field) {
                    dependencies
                        .for_each_property(|name, _, _| external_packages.push(name.into()));
                }
            }
        }
        Ok(Library {
            project,
            outdir,
            external_packages,
        })
    }

    // The build leaves the project's dependencies as imports and writes into the folder that was checked.
    pub(crate) fn configure(&mut self, ctx: &mut ContextData) {
        ctx.args.external.append(&mut self.external_packages);
        ctx.bundler_options.outdir = self.outdir.folder.as_slice().into();
    }

    // An output lands on an entry point only if `--outdir` holds the root directory, which the build resolved.
    #[cold]
    pub(crate) fn check_root_directory(
        &self,
        ctx: &ContextData,
        root_directory: &[u8],
        entry_points: &[Box<[u8]>],
    ) {
        if !self.outdir.holds(root_directory) {
            return;
        }
        let working_directory = ctx.args.absolute_working_dir.as_deref().unwrap_or_default();
        let is_inside = |entry_point: &[u8]| {
            let path = absolute_path(working_directory, entry_point);
            let real = real_path(&path).or_else(|| real_path(bun_paths::dirname(&path)?));
            real.is_some_and(|real| self.outdir.holds(&real))
        };
        if let Some(entry_point) = entry_points.iter().find(|it| is_inside(it)) {
            let entry_point = entry_point.to_vec();
            LibraryError::EntryPointInsideOutdir { entry_point }.exit();
        }
    }
}
