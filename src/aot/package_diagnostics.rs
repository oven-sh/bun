use crate::diagnostic_codes::Code;
use crate::diagnostics::{Diagnostic, Diagnostics, ProgramView};
use bun_sema::check::aot::{Effect, FileOrigin};
use bun_sema::program::{FileId, Files};
use bun_sema_driver::host::to_native;
use bun_sema_driver::{self as driver, BuildDiagnostic, RoleDecision};
use std::collections::BTreeMap;
use std::collections::btree_map::Entry;

pub(crate) struct PackageErrors {
    pub remaining: Vec<BuildDiagnostic>,
    pub has_withdrawn_trust: bool,
}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum GroupKey<'s> {
    DemotedPackage { name: &'s [u8], directory: &'s [u8] },
    DemotedFile { path: &'s [u8] },
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

pub(crate) fn report_package_errors(
    diagnostics: &mut Diagnostics,
    view: ProgramView<'_, '_>,
    checked: Vec<BuildDiagnostic>,
    roles: &RoleDecision,
) -> PackageErrors {
    let files = view.files();
    let mut groups: BTreeMap<GroupKey<'_>, Group> = BTreeMap::new();
    let mut remaining = Vec::with_capacity(checked.len());
    for reported in checked {
        if withdraws_trust_in_runtime_file(view, &reported) {
            continue;
        }
        let Some(key) = group_key(files, &reported) else {
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
    let has_withdrawn_trust = !groups.is_empty();
    for (key, group) in groups {
        diagnostics.add_with_checker_note(group_diagnostic(&key, &group, &counts), group.first);
    }
    PackageErrors {
        remaining,
        has_withdrawn_trust,
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

fn withdraws_trust_in_runtime_file(view: ProgramView<'_, '_>, reported: &BuildDiagnostic) -> bool {
    let is_runtime_file = |file| view.origin(file) == FileOrigin::Runtime;
    let file = reported.diagnostic.file;
    reported.effect == Effect::WithdrawsTrust && file.is_some_and(is_runtime_file)
}

fn group_key<'s>(files: &Files<'s>, reported: &BuildDiagnostic) -> Option<GroupKey<'s>> {
    if reported.effect != Effect::WithdrawsTrust {
        return None;
    }
    let file = reported.diagnostic.file?;
    let package = files.compiled(file).and_then(|compiled| compiled.package);
    Some(match package {
        Some(package) => GroupKey::DemotedPackage {
            name: package.name,
            directory: package.directory,
        },
        None => GroupKey::DemotedFile {
            path: to_native(files.module(file).file_name()),
        },
    })
}

fn demoted_package_directory<'s>(key: &GroupKey<'s>) -> Option<&'s [u8]> {
    match *key {
        GroupKey::DemotedPackage { directory, .. } => Some(directory),
        GroupKey::DemotedFile { .. } => None,
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
