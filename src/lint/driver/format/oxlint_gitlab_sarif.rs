//! `gitlab` and `sarif` with a configuration of oxlint: the bytes of oxlint, but for the words of the messages. Neither
//! ends with a line break.

use super::Meta;
use super::info::{Info, Source};
use super::oxlint::{is_error, number, plugin};
use super::oxlint_fixes::FIXES;
use crate::paths;
use crate::print_config::{object, text, write_indented};
use crate::results::FileResult;
use bun_core::strings;
use bun_lint::linter::{LintMessage, oxlint_category};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;

/// Of oxlint, whose output this is.
const VERSION: &[u8] = b"1.87.0";

fn for_each(results: &[FileResult], meta: &Meta, mut print: impl FnMut(&LintMessage, Info)) {
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        let source = Source::new(result, meta);
        for message in &result.messages {
            print(message, source.info(message));
        }
    }
}

/// SipHash-1-3 with the key 0, 0: `DefaultHasher::new()` of the Rust that oxlint is built with. What that of another Rust
/// computes is not promised to be the same.
fn hash(bytes: &[u8]) -> u64 {
    fn round(v: &mut [u64; 4]) {
        v[0] = v[0].wrapping_add(v[1]);
        v[1] = v[1].rotate_left(13) ^ v[0];
        v[0] = v[0].rotate_left(32);
        v[2] = v[2].wrapping_add(v[3]);
        v[3] = v[3].rotate_left(16) ^ v[2];
        v[0] = v[0].wrapping_add(v[3]);
        v[3] = v[3].rotate_left(21) ^ v[0];
        v[2] = v[2].wrapping_add(v[1]);
        v[1] = v[1].rotate_left(17) ^ v[2];
        v[2] = v[2].rotate_left(32);
    }
    let mut v: [u64; 4] = [
        0x736f6d6570736575,
        0x646f72616e646f6d,
        0x6c7967656e657261,
        0x7465646279746573,
    ];
    let little_endian = |bytes: &[u8]| {
        let bytes = bytes.iter().rev();
        bytes.fold(0u64, |word, byte| (word << 8) | u64::from(*byte))
    };
    let (words, rest) = bytes.as_chunks::<8>();
    let last = little_endian(rest) | ((bytes.len() as u64) << 56);
    for word in words
        .iter()
        .map(|word| u64::from_le_bytes(*word))
        .chain([last])
    {
        v[3] ^= word;
        round(&mut v);
        v[0] ^= word;
    }
    v[2] ^= 0xFF;
    round(&mut v);
    round(&mut v);
    round(&mut v);
    v[0] ^ v[1] ^ v[2] ^ v[3]
}

/// GitLab's Code Quality report.
pub(super) fn write_gitlab(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    // From the root of the repository to the working directory.
    let prefix = paths::ancestors(meta.cwd)
        .find(|it| bun_sys::exists(&paths::join(it, b".git")))
        .and_then(|it| paths::inside(it, meta.cwd))
        .filter(|it| !it.is_empty());
    let mut all = Vec::new();
    for_each(results, meta, |_, info| {
        let severity: &[u8] = if info.is_error { b"critical" } else { b"major" };
        // What `Hash` gives a hasher: a `usize` as it is in memory, a `String` with 0xFF after it.
        let fingerprint = hash(
            &[
                &(info.start.line as u64).to_le_bytes()[..],
                &(info.end.line as u64).to_le_bytes(),
                info.filename,
                b"\xFF",
                info.message,
                b"\xFF",
                severity,
                b"\xFF",
            ]
            .concat(),
        );
        // `PathBuf::join`
        let path = match prefix {
            Some(prefix) if !paths::is_absolute(info.filename) => {
                paths::join(prefix, info.filename)
            }
            _ => info.filename.to_vec(),
        };
        all.push(object(vec![
            (b"description", text(info.message)),
            (b"check_name", text(&info.code.unwrap_or_default())),
            (b"fingerprint", text(format!("{fingerprint:x}").as_bytes())),
            (b"severity", text(severity)),
            (
                b"location",
                object(vec![
                    (b"path", text(&path)),
                    (
                        b"lines",
                        object(vec![
                            (b"begin", number(info.start.line)),
                            (b"end", number(info.end.line)),
                        ]),
                    ),
                ]),
            ),
        ]));
    });
    write_indented(out, &Json::Array(all), 0);
}

/// What `oxlint --rules -f json` has as the `fix` of a rule. `scope`: its plugin as oxlint calls it there.
fn fix_of(scope: &[u8], name: &[u8]) -> &'static str {
    let has = |lists: &[(&str, &str)]| {
        (lists.iter().filter(|it| it.0.as_bytes() == scope))
            .any(|it| strings::split(it.1.as_bytes(), b" ").any(|it| it == name))
    };
    FIXES.iter().find(|it| has(it.1)).map_or("none", |it| it.0)
}

/// What `rules` has about the rule that is reported as `code`. oxlint looks for a rule that is `plugin(name)` with the name
/// that the plugin has in `--rules`: it finds none of `jsx-a11y(..)`, `react-perf(..)`, `next(..)`, `react-hooks(..)`.
fn rule_descriptor(code: &[u8]) -> Option<Json> {
    let (scope, rest) = strings::split_once_char(code, b'(')?;
    let name = rest.strip_suffix(b")")?;
    let of = Plugin::of_oxlint_prefix(scope)?;
    if plugin(of.prefix().as_bytes()) != scope {
        return None;
    }
    let category = oxlint_category(of, std::str::from_utf8(name).ok()?)?;
    let url = [
        b"https://oxc.rs/docs/guide/usage/linter/rules/",
        scope,
        b"/",
        name,
        b".html",
    ]
    .concat();
    Some(object(vec![
        (b"id", text(code)),
        (b"name", text(name)),
        (b"helpUri", text(&url)),
        (
            b"properties",
            object(vec![
                (b"category", text(category.as_bytes())),
                (b"plugin", text(scope)),
                (b"fix", text(fix_of(scope, name).as_bytes())),
            ]),
        ),
    ]))
}

/// The descriptor of what is not a rule.
fn own_descriptor(id: &[u8], name: &[u8], short: &[u8], full: &[u8]) -> Json {
    object(vec![
        (b"id", text(id)),
        (b"name", text(name)),
        (b"shortDescription", object(vec![(b"text", text(short))])),
        (b"fullDescription", object(vec![(b"text", text(full))])),
    ])
}

/// SARIF 2.1.0. The columns are bytes, whatever `columnKind` says.
pub(super) fn write_sarif(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let mut rules = Vec::new();
    // Each `ruleId` so far, and where in `rules` it is described, if it is.
    let mut rule_ids: Vec<(Vec<u8>, Option<usize>)> = Vec::new();
    let mut uris: Vec<Vec<u8>> = Vec::new();
    let (mut all, mut notifications) = (Vec::new(), Vec::new());
    let (mut is_successful, mut has_regions) = (true, false);
    for_each(results, meta, |problem, info| {
        // Also of a problem without a place, where `info` has neither.
        let level = text(if is_error(problem) {
            b"error"
        } else {
            b"warning"
        });
        let message = object(vec![(b"text", text(&problem.message))]);
        let has_file = !info.filename.is_empty();
        let is_of_rule = info.code.is_some();
        if !is_of_rule && !has_file {
            is_successful &= !is_error(problem);
            notifications.push(object(vec![
                (
                    b"descriptor",
                    object(vec![(b"id", text(b"OXL0999")), (b"index", number(0))]),
                ),
                (b"level", level),
                (b"message", message),
            ]));
            return;
        }
        // A syntax error, a comment that disables nothing.
        let id = info.code.unwrap_or_else(|| b"OXL0001".to_vec());
        let known = rule_ids.iter().find(|it| it.0 == id).map(|it| it.1);
        let rule = known.unwrap_or_else(|| {
            let descriptor = match is_of_rule {
                true => rule_descriptor(&id),
                false => Some(own_descriptor(
                    &id,
                    b"oxlint-diagnostic",
                    b"Oxlint diagnostic",
                    b"An oxlint diagnostic that is associated with an artifact but not with a lint rule.",
                )),
            };
            let at = descriptor.map(|it| {
                rules.push(it);
                rules.len() - 1
            });
            rule_ids.push((id.clone(), at));
            at
        });
        let mut result = vec![(&b"ruleId"[..], text(&id))];
        if let Some(rule) = rule {
            result.push((b"ruleIndex", number(rule)));
        }
        result.extend([(&b"level"[..], level), (b"message", message)]);
        if has_file {
            // The problems of a file follow each other.
            if uris.last().is_none_or(|it| it.as_slice() != info.filename) {
                uris.push(info.filename.to_vec());
            }
            let mut physical = vec![(
                &b"artifactLocation"[..],
                object(vec![
                    (b"uri", text(info.filename)),
                    (b"index", number(uris.len() - 1)),
                ]),
            )];
            // Not of a problem without a place.
            if info.start.line > 0 {
                has_regions = true;
                physical.push((
                    b"region",
                    object(vec![
                        (b"startLine", number(info.start.line)),
                        (b"startColumn", number(info.start.column)),
                        (b"endLine", number(info.end.line)),
                        (b"endColumn", number(info.end.column)),
                    ]),
                ));
            }
            let location = object(vec![(b"physicalLocation", object(physical))]);
            result.push((b"locations", Json::Array(vec![location])));
        }
        all.push(object(result));
    });
    let mut driver = vec![
        (&b"name"[..], text(b"oxlint")),
        (b"version", text(VERSION)),
        (b"semanticVersion", text(VERSION)),
        (
            b"informationUri",
            text(b"https://oxc.rs/docs/guide/usage/linter.html"),
        ),
        (b"rules", Json::Array(rules)),
    ];
    if !notifications.is_empty() {
        driver.push((
            b"notifications",
            Json::Array(vec![own_descriptor(
                b"OXL0999",
                b"oxlint-configuration",
                b"Oxlint configuration or execution diagnostic",
                b"An oxlint diagnostic that is not associated with a specific artifact.",
            )]),
        ));
    }
    let mut run = vec![(&b"tool"[..], object(vec![(b"driver", object(driver))]))];
    let has_artifacts = !uris.is_empty();
    if has_artifacts {
        let artifacts = uris.iter().map(|uri| {
            let location = object(vec![(b"uri", text(uri))]);
            object(vec![(b"location", location)])
        });
        run.push((b"artifacts", Json::Array(artifacts.collect())));
    }
    run.push((b"results", Json::Array(all)));
    if !notifications.is_empty() {
        run.push((
            b"invocations",
            Json::Array(vec![object(vec![
                (b"executionSuccessful", Json::Bool(is_successful)),
                (
                    b"toolConfigurationNotifications",
                    Json::Array(notifications),
                ),
            ])]),
        ));
    }
    if has_regions {
        run.push((b"columnKind", text(b"unicodeCodePoints")));
    }
    let log = object(vec![
        (b"version", text(b"2.1.0")),
        (b"$schema", text(b"https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json")),
        (b"runs", Json::Array(vec![object(run)])),
    ]);
    write_indented(out, &log, 0);
}
