use std::io::Write as _;

use bun_core::Output;

use super::{FixOutcome, FixPlan, PackageJsonEdit};

pub(super) fn write(plan: &FixPlan, outcome: Option<&FixOutcome>, dry_run: bool) {
    let (fixed, remaining) = match outcome {
        Some(outcome) => (
            outcome.fixed_vulnerabilities,
            outcome.remaining_vulnerabilities,
        ),
        None => (plan.fixed_vulnerabilities, plan.remaining_vulnerabilities),
    };

    let mut out: Vec<u8> = Vec::new();
    let _ = write!(
        out,
        "{{\"dryRun\":{dry_run},\"fixed\":{fixed},\"remaining\":{remaining},\"fixes\":["
    );
    for (i, fix) in plan.fixes.iter().enumerate() {
        comma(&mut out, i);
        out.extend_from_slice(b"{\"name\":");
        s(&mut out, &fix.name);
        out.extend_from_slice(b",\"from\":");
        s(&mut out, &fix.from);
        out.extend_from_slice(b",\"to\":");
        s(&mut out, &fix.to);
        let _ = write!(
            out,
            ",\"downgrade\":{},\"newerThanMinimumReleaseAge\":{},\"packageJson\":[",
            fix.downgrade, fix.too_recent
        );
        for (j, edit) in fix.edits.iter().enumerate() {
            comma(&mut out, j);
            write_edit(&mut out, edit);
        }
        out.extend_from_slice(b"]}");
    }

    out.extend_from_slice(b"],\"blocked\":[");
    for (i, blocked) in plan.blocked.iter().enumerate() {
        comma(&mut out, i);
        out.extend_from_slice(b"{\"name\":");
        s(&mut out, &blocked.name);
        out.extend_from_slice(b",\"from\":");
        s(&mut out, &blocked.from);
        out.extend_from_slice(b",\"to\":");
        s(&mut out, &blocked.needs);
        let _ = write!(
            out,
            ",\"downgrade\":{},\"latestFixes\":{},\"blockers\":[",
            blocked.needs_is_downgrade,
            blocked.blockers.iter().any(|blocker| blocker.latest_fixes)
        );
        for (j, blocker) in blocked.blockers.iter().enumerate() {
            comma(&mut out, j);
            out.extend_from_slice(b"{\"dependent\":");
            s(&mut out, &blocker.dependent);
            out.extend_from_slice(b",\"range\":");
            s(&mut out, &blocker.range);
            let _ = write!(out, ",\"bundled\":{}}}", blocker.bundled);
        }
        out.extend_from_slice(b"]}");
    }

    out.extend_from_slice(b"],\"unfixable\":[");
    for (i, unfixable) in plan.unfixable.iter().enumerate() {
        comma(&mut out, i);
        name_advisories(
            &mut out,
            b"from",
            &unfixable.name,
            &unfixable.from,
            &unfixable.ignore_tokens,
        );
    }

    out.extend_from_slice(b"],\"manifestUnavailable\":[");
    for (i, unavailable) in plan.manifest_unavailable.iter().enumerate() {
        comma(&mut out, i);
        out.extend_from_slice(b"{\"name\":");
        s(&mut out, &unavailable.name);
        out.extend_from_slice(b",\"from\":");
        s(&mut out, &unavailable.from);
        out.extend_from_slice(b",\"error\":");
        s(&mut out, &unavailable.error);
        out.push(b'}');
    }

    out.extend_from_slice(b"],\"unmatched\":[");
    for (i, unmatched) in plan.unmatched.iter().enumerate() {
        comma(&mut out, i);
        out.extend_from_slice(b"{\"name\":");
        s(&mut out, &unmatched.name);
        out.extend_from_slice(b",\"range\":");
        s(&mut out, &unmatched.range);
        out.push(b'}');
    }

    out.extend_from_slice(b"],\"unaudited\":[");
    for (i, group) in plan.unaudited.iter().enumerate() {
        comma(&mut out, i);
        out.extend_from_slice(b"{\"registry\":");
        s(&mut out, &group.registry);
        out.extend_from_slice(b",\"packages\":[");
        for (j, package) in group.packages.iter().enumerate() {
            comma(&mut out, j);
            s(&mut out, package);
        }
        out.extend_from_slice(b"],\"reason\":");
        if group.reason.is_empty() {
            out.extend_from_slice(b"null");
        } else {
            s(&mut out, &group.reason);
        }
        out.push(b'}');
    }

    out.extend_from_slice(b"],\"vulnerableAfterInstall\":[");
    if let Some(outcome) = outcome {
        for (i, item) in outcome.still_vulnerable.iter().enumerate() {
            comma(&mut out, i);
            name_advisories(
                &mut out,
                b"version",
                &item.name,
                &item.version,
                &item.advisories,
            );
        }
    }
    out.extend_from_slice(b"]}\n");

    let _ = Output::writer().write_all(&out);
    Output::flush();
}

fn write_edit(out: &mut Vec<u8>, edit: &PackageJsonEdit) {
    out.extend_from_slice(b"{\"file\":");
    s(out, &edit.file);
    out.extend_from_slice(b",\"catalog\":");
    match edit.catalog.as_deref() {
        None => out.extend_from_slice(b"null"),
        Some(b"") => out.extend_from_slice(b"\"default\""),
        Some(catalog) => s(out, catalog),
    }
    out.extend_from_slice(b",\"key\":");
    s(out, &edit.key);
    out.extend_from_slice(b",\"from\":");
    s(out, &edit.old_literal);
    out.extend_from_slice(b",\"to\":");
    s(out, &edit.new_literal);
    out.push(b'}');
}

fn name_advisories(
    out: &mut Vec<u8>,
    second_key: &[u8],
    name: &[u8],
    second: &[u8],
    advisories: &[Box<[u8]>],
) {
    out.extend_from_slice(b"{\"name\":");
    s(out, name);
    out.extend_from_slice(b",\"");
    out.extend_from_slice(second_key);
    out.extend_from_slice(b"\":");
    s(out, second);
    out.extend_from_slice(b",\"advisories\":[");
    for (j, token) in advisories.iter().enumerate() {
        comma(out, j);
        s(out, token);
    }
    out.extend_from_slice(b"]}");
}

#[inline]
fn comma(out: &mut Vec<u8>, index: usize) {
    if index > 0 {
        out.push(b',');
    }
}

fn s(out: &mut Vec<u8>, bytes: &[u8]) {
    let _ = write!(
        out,
        "{}",
        bun_core::fmt::format_json_string_utf8(bytes, Default::default())
    );
}
