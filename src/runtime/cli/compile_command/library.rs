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

fn is_inside(directory: &[u8], path: &[u8]) -> bool {
    let below = path.strip_prefix(directory);
    below.is_some_and(|below| {
        below
            .first()
            .is_some_and(|&byte| bun_paths::is_sep_any(byte))
    })
}

fn check_outdir(project: &Project, outdir: &[u8]) -> Result<(), LibraryError> {
    if project.directory == outdir || is_inside(outdir, &project.directory) {
        return Err(LibraryError::OutdirHoldsProject {
            outdir: outdir.to_vec(),
        });
    }
    Ok(())
}

pub(super) fn find_default_library_entry_points(
    working_directory: &[u8],
    outdir: &[u8],
) -> Result<Vec<Box<[u8]>>, LibraryError> {
    let project = Project::find(working_directory);
    let outdir = absolute_path(working_directory, outdir);
    check_outdir(&project, &outdir)?;
    let arena = Arena::new();
    let package_json = project.parse_package_json(&arena)?;
    let found = entry_points::find_entry_points(&project.directory, package_json.as_ref(), &outdir);
    if found.is_empty() {
        return Err(LibraryError::NoEntryPoint {
            directory: project.directory,
        });
    }
    Ok(found)
}

fn find_external_packages(
    working_directory: &[u8],
    outdir: &[u8],
    entry_points: &[Box<[u8]>],
) -> Result<Vec<Box<[u8]>>, LibraryError> {
    let project = Project::find(working_directory);
    let outdir = absolute_path(working_directory, outdir);
    check_outdir(&project, &outdir)?;
    let is_overwritten =
        |entry_point: &[u8]| is_inside(&outdir, &absolute_path(working_directory, entry_point));
    if let Some(entry_point) = entry_points.iter().find(|it| is_overwritten(it)) {
        return Err(LibraryError::EntryPointInsideOutdir {
            entry_point: entry_point.to_vec(),
        });
    }
    let arena = Arena::new();
    let mut packages: Vec<Box<[u8]>> = Vec::new();
    if let Some(package_json) = project.parse_package_json(&arena)? {
        for field in EXTERNAL_PACKAGE_FIELDS {
            if let Some(dependencies) = package_json.get(field) {
                dependencies.for_each_property(|name, _, _| packages.push(name.into()));
            }
        }
    }
    Ok(packages)
}

#[cold]
pub(crate) fn configure_library(ctx: &mut ContextData) {
    let working_directory = ctx.args.absolute_working_dir.as_deref().unwrap_or_default();
    let packages = find_external_packages(
        working_directory,
        &ctx.bundler_options.outdir,
        &ctx.args.entry_points,
    );
    ctx.args
        .external
        .extend(packages.unwrap_or_else(|error| error.exit()));
}
