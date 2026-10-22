use crate::diagnostic_codes::Code;
use crate::diagnostics::{Diagnostic, Diagnostics, ProgramView, Span};
use crate::load::typed_packages::TypedPackages;
use bun_sema::check::aot::{Effect, FileOrigin};
use bun_sema::erasure::ErasureMismatchKind;
use bun_sema::messages;
use bun_sema::program::{FileId, Files, RejectedTypedVersion};
use bun_sema::resolve::EnclosingPackage;
use bun_sema_driver::host::to_native;
use bun_sema_driver::{self as driver, BuildDiagnostic, RoleDecision};
use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Copy, Clone)]
pub(crate) struct PackageView<'a, 's> {
    pub view: ProgramView<'a, 's>,
    pub packages: &'a TypedPackages<'a>,
}

pub(crate) struct PackageErrors<'s> {
    pub remaining: Vec<BuildDiagnostic>,
    pub demoted_directories: BTreeSet<&'s [u8]>,
}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum GroupKey<'s> {
    DemotedPackage { name: &'s [u8], directory: &'s [u8] },
    DemotedFile { path: &'s [u8] },
    TypedVersion { name: &'s [u8], directory: Vec<u8> },
}

struct Group {
    count: u32,
    first: driver::Diagnostic,
}

#[derive(Copy, Clone, Default)]
struct PackageFileCounts {
    demoted: u32,
    compiled: u32,
}

pub(crate) fn report_rejected_versions(
    diagnostics: &mut Diagnostics,
    packages: PackageView<'_, '_>,
    defined: &dyn Fn(&[u8]) -> Option<Vec<u8>>,
) {
    let files = packages.view.files();
    let mismatched_directories = report_manifest_mismatches(diagnostics, packages, defined);
    for &file in files.compiled_files() {
        let Some(compiled) = files.compiled(file) else {
            continue;
        };
        let Some(rejected) = compiled.rejected_typed_version else {
            continue;
        };
        let directory = compiled.package.map(|package| package.directory);
        if directory.is_some_and(|directory| mismatched_directories.contains(directory)) {
            continue;
        }
        let warning = rejected_version_diagnostic(packages, file, compiled.package, rejected);
        diagnostics.add(Some(packages.view), warning);
    }
}

pub(crate) fn report_package_errors<'s>(
    diagnostics: &mut Diagnostics,
    packages: PackageView<'_, 's>,
    checked: Vec<BuildDiagnostic>,
    roles: &RoleDecision,
) -> PackageErrors<'s> {
    let files = packages.view.files();
    let mut groups: BTreeMap<GroupKey<'s>, Group> = BTreeMap::new();
    let mut remaining = Vec::with_capacity(checked.len());
    for reported in checked {
        if withdraws_trust_in_runtime_file(packages, &reported) {
            continue;
        }
        let Some(key) = group_key(packages, &reported) else {
            remaining.push(reported);
            continue;
        };
        match groups.entry(key) {
            Entry::Occupied(mut group) => group.get_mut().count += 1,
            Entry::Vacant(group) => {
                group.insert(Group {
                    count: 1,
                    first: reported.diagnostic,
                });
            }
        }
    }
    let counts = count_package_files(files, roles, &groups);
    let demoted_directories = groups
        .keys()
        .filter_map(demoted_package_directory)
        .chain(demoted_files(roles).filter_map(|file| package_directory(files, file)))
        .collect();
    for (key, group) in groups {
        diagnostics.add_with_checker_note(group_diagnostic(&key, &group, &counts), group.first);
    }
    PackageErrors {
        remaining,
        demoted_directories,
    }
}

pub(crate) fn report_used_versions(
    diagnostics: &mut Diagnostics,
    packages: PackageView<'_, '_>,
    demoted_directories: &BTreeSet<&[u8]>,
) {
    let files = packages.view.files();
    let mut typed_files = Vec::new();
    let mut rejected_directories = BTreeSet::new();
    for &file in files.compiled_files() {
        let Some(compiled) = files.compiled(file) else {
            continue;
        };
        let Some(package) = compiled.package else {
            continue;
        };
        if let Some(typed) = compiled.typed_source_path {
            typed_files.push((package, packages.packages.display_directory(typed)));
        }
        if compiled.rejected_typed_version.is_some() {
            rejected_directories.insert(package.directory);
        }
    }
    let is_partly_untyped = |directory: &[u8]| {
        demoted_directories.contains(directory) || rejected_directories.contains(directory)
    };
    let used_versions: BTreeSet<(&[u8], &[u8], Vec<u8>)> = typed_files
        .into_iter()
        .filter(|(package, _)| !is_partly_untyped(package.directory))
        .map(|(package, directory)| (package.name, package.version, directory))
        .collect();
    for (name, version, directory) in used_versions {
        let used = Diagnostic::new(
            Code::TypedPackageUsed,
            None,
            &[
                &printable(name),
                &printable(version),
                &printable(&directory),
            ],
        );
        diagnostics.add(None, used);
    }
}

fn printable(text: &[u8]) -> Vec<u8> {
    text.iter()
        .map(|&byte| match byte {
            0..=0x1f | 0x7f => b'?',
            _ => byte,
        })
        .collect()
}

fn format_sentence(template: &str, arguments: &[&[u8]]) -> Vec<u8> {
    let mut sentence = Vec::new();
    messages::format(&mut sentence, template, arguments);
    sentence
}

fn report_manifest_mismatches<'s>(
    diagnostics: &mut Diagnostics,
    packages: PackageView<'_, 's>,
    defined: &dyn Fn(&[u8]) -> Option<Vec<u8>>,
) -> BTreeSet<&'s [u8]> {
    let files = packages.view.files();
    let compiled_files = files.compiled_files().iter();
    let installed_packages: BTreeMap<&'s [u8], EnclosingPackage<'s>> = compiled_files
        .filter_map(|&file| files.compiled(file)?.package)
        .map(|package| (package.directory, package))
        .collect();
    let mut mismatched_directories = BTreeSet::new();
    for (directory, package) in installed_packages {
        let Some(sentence) = packages.packages.find_manifest_mismatch(package, defined) else {
            continue;
        };
        let error = Diagnostic::new(
            Code::TypedPackageNotUsed,
            None,
            &[
                &printable(package.name),
                &printable(&packages.packages.display_directory_of_package(package.name)),
                &printable(&sentence),
            ],
        );
        diagnostics.add(None, error);
        mismatched_directories.insert(directory);
    }
    mismatched_directories
}

fn rejected_version_diagnostic(
    packages: PackageView<'_, '_>,
    file: FileId,
    package: Option<EnclosingPackage<'_>>,
    rejected: RejectedTypedVersion<'_>,
) -> Diagnostic {
    let path = packages.view.files().module(file).file_name();
    let installed = match package {
        Some(package) => package.relative_path(path),
        None => to_native(path),
    };
    let typed = packages.packages.display_relative_path(rejected.path);
    let (start, end) = rejected.installed_range;
    let code = match packages.packages.is_project_version(rejected.path) {
        true => Code::TypedPackageNotUsed,
        false => Code::ShippedTypedVersionNotUsed,
    };
    Diagnostic::new(
        code,
        Some(Span { file, start, end }),
        &[
            &printable(package_name(package, path)),
            &printable(&packages.packages.display_directory(rejected.path)),
            &printable(&erasure_mismatch_sentence(rejected.kind, typed, installed)),
        ],
    )
}

fn erasure_mismatch_sentence(
    kind: ErasureMismatchKind,
    typed: &[u8],
    installed: &[u8],
) -> Vec<u8> {
    match kind {
        ErasureMismatchKind::EmitsCode => format_sentence(
            "in {0}, TypeScript syntax that emits code can't be erased",
            &[typed],
        ),
        ErasureMismatchKind::NodeKind
        | ErasureMismatchKind::Name
        | ErasureMismatchKind::Literal
        | ErasureMismatchKind::Operator
        | ErasureMismatchKind::Flags
        | ErasureMismatchKind::ChildCount => format_sentence(
            "{0} without its types doesn't match {1}. Was the package patched?",
            &[typed, installed],
        ),
    }
}

fn package_name<'p>(package: Option<EnclosingPackage<'p>>, path: &'p [u8]) -> &'p [u8] {
    match package {
        Some(package) => package.name,
        None => to_native(path),
    }
}

fn withdraws_trust_in_runtime_file(
    packages: PackageView<'_, '_>,
    reported: &BuildDiagnostic,
) -> bool {
    let is_runtime_file = |file| packages.view.origin(file) == FileOrigin::Runtime;
    let file = reported.diagnostic.file;
    reported.effect == Effect::WithdrawsTrust && file.is_some_and(is_runtime_file)
}

fn group_key<'s>(
    packages: PackageView<'_, 's>,
    reported: &BuildDiagnostic,
) -> Option<GroupKey<'s>> {
    let file = reported.diagnostic.file?;
    let files = packages.view.files();
    let path = files.module(file).file_name();
    let compiled = files.compiled(file);
    let package = compiled.and_then(|compiled| compiled.package);
    match reported.effect {
        Effect::WithdrawsTrust => Some(match package {
            Some(package) => GroupKey::DemotedPackage {
                name: package.name,
                directory: package.directory,
            },
            None => GroupKey::DemotedFile {
                path: to_native(path),
            },
        }),
        Effect::StopsBuild => {
            if packages.view.origin(file) != FileOrigin::ProjectTypedVersion {
                return None;
            }
            let typed = compiled?.typed_source_path?;
            Some(GroupKey::TypedVersion {
                name: package_name(package, path),
                directory: packages.packages.display_directory(typed),
            })
        }
        Effect::Warns | Effect::Dropped | Effect::InternalError => None,
    }
}

fn demoted_package_directory<'s>(key: &GroupKey<'s>) -> Option<&'s [u8]> {
    match *key {
        GroupKey::DemotedPackage { directory, .. } => Some(directory),
        GroupKey::DemotedFile { .. } | GroupKey::TypedVersion { .. } => None,
    }
}

fn package_directory<'s>(files: &Files<'s>, file: FileId) -> Option<&'s [u8]> {
    Some(files.compiled(file)?.package?.directory)
}

fn demoted_files(roles: &RoleDecision) -> impl Iterator<Item = FileId> + '_ {
    roles.demoted.iter().map(|demotion| demotion.file)
}

fn count_package_files<'s>(
    files: &Files<'s>,
    roles: &RoleDecision,
    groups: &BTreeMap<GroupKey<'s>, Group>,
) -> BTreeMap<&'s [u8], PackageFileCounts> {
    let mut counts: BTreeMap<&'s [u8], PackageFileCounts> = groups
        .keys()
        .filter_map(demoted_package_directory)
        .map(|directory| (directory, PackageFileCounts::default()))
        .collect();
    if counts.is_empty() {
        return counts;
    }
    for directory in demoted_files(roles).filter_map(|file| package_directory(files, file)) {
        if let Some(package) = counts.get_mut(directory) {
            package.demoted += 1;
        }
    }
    let compiled_files = files.compiled_files().iter();
    for directory in compiled_files.filter_map(|&file| package_directory(files, file)) {
        if let Some(package) = counts.get_mut(directory) {
            package.compiled += 1;
        }
    }
    counts
}

fn group_diagnostic(
    key: &GroupKey<'_>,
    group: &Group,
    counts: &BTreeMap<&[u8], PackageFileCounts>,
) -> Diagnostic {
    let position = position_text(&group.first);
    match key {
        GroupKey::DemotedPackage { name, directory } => {
            let file_counts = counts.get(*directory).copied().unwrap_or_default();
            Diagnostic::new(
                Code::PackageCompiledWithoutTypes,
                None,
                &[
                    &printable(name),
                    &error_count_text(group.count),
                    &position,
                    file_counts.demoted.to_string().as_bytes(),
                    file_counts.compiled.to_string().as_bytes(),
                ],
            )
        }
        GroupKey::DemotedFile { path } => Diagnostic::new(
            Code::FileCompiledWithoutTypes,
            None,
            &[path, &error_count_text(group.count), &position],
        ),
        GroupKey::TypedVersion { name, directory } => Diagnostic::new(
            Code::TypedVersionHasTypeErrors,
            None,
            &[
                &printable(name),
                &printable(directory),
                group.count.to_string().as_bytes(),
                &position,
            ],
        ),
    }
}

fn error_count_text(count: u32) -> Vec<u8> {
    match count {
        1 => b"1 type error".to_vec(),
        _ => format!("{count} type errors").into_bytes(),
    }
}

fn position_text(diagnostic: &driver::Diagnostic) -> Vec<u8> {
    let line_and_column = format!(":{}:{}", diagnostic.line, diagnostic.column);
    [to_native(&diagnostic.path), line_and_column.as_bytes()].concat()
}

#[cfg(test)]
mod tests;
