use bun_removable_features::{Feature, TrimFeature};

#[derive(Debug)]
pub enum TrimError {
    Request(TrimRequestError),
    Unsupported(UnsupportedReason),
    Internal(TrimInternalError),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum TrimRequestError {
    UnknownName(Box<[u8]>),
    UnknownNames(Vec<Box<[u8]>>),
    AllowedAndRemoved(TrimFeature),
    UnknownLocale(Box<[u8]>),
    MissingFromTemplate(Feature),
    TemplateWithoutProgramFeature(Feature),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum UnsupportedReason {
    NoTrimTable,
    FeatureListMismatch,
    AlreadyTrimmed,
    UnrecognizedExecutable,
}

#[derive(Debug)]
pub enum TrimInternalError {
    MalformedTable,
    RangeOutsideImage,
    MalformedIcuData,
    Format(bun_exe_format::Error),
}

impl TrimRequestError {
    pub fn for_unknown_names<'a>(
        names: impl IntoIterator<Item = &'a [u8]>,
    ) -> Option<TrimRequestError> {
        let mut distinct_names: Vec<&[u8]> = Vec::new();
        for name in names {
            if !distinct_names.contains(&name) {
                distinct_names.push(name);
            }
        }
        match distinct_names.as_slice() {
            [] => None,
            [name] => Some(TrimRequestError::UnknownName(Box::<[u8]>::from(*name))),
            names => Some(TrimRequestError::UnknownNames(
                names.iter().map(|name| Box::<[u8]>::from(*name)).collect(),
            )),
        }
    }
}

impl TrimInternalError {
    pub fn name(&self) -> &'static str {
        match self {
            TrimInternalError::MalformedTable => "MalformedTable",
            TrimInternalError::RangeOutsideImage => "RangeOutsideImage",
            TrimInternalError::MalformedIcuData => "MalformedIcuData",
            TrimInternalError::Format(error) => error.name(),
        }
    }
}

impl TrimError {
    pub fn write_message(&self, out: &mut Vec<u8>) {
        match self {
            TrimError::Request(TrimRequestError::UnknownName(name)) => {
                out.extend_from_slice(b"compile.trim: unknown name ");
                write_quoted(out, name);
                match find_closest_name(name) {
                    Some(closest) => {
                        out.extend_from_slice(b". Did you mean ");
                        write_quoted(out, closest.name().as_bytes());
                        out.push(b'?');
                    }
                    None => write_valid_names(out),
                }
            }
            TrimError::Request(TrimRequestError::UnknownNames(names)) => {
                out.extend_from_slice(b"compile.trim: unknown names ");
                write_quoted_list(out, names.iter().map(|name| &**name));
                write_valid_names(out);
            }
            TrimError::Request(TrimRequestError::AllowedAndRemoved(name)) => {
                out.extend_from_slice(b"compile.trim: ");
                write_quoted(out, name.name().as_bytes());
                out.extend_from_slice(b" is listed in both allow and remove");
            }
            TrimError::Request(TrimRequestError::UnknownLocale(tag)) => {
                out.extend_from_slice(
                    b"compile.trim: this build of Bun has no data for the locale ",
                );
                write_quoted(out, tag);
            }
            TrimError::Request(TrimRequestError::MissingFromTemplate(feature)) => {
                out.extend_from_slice(
                    b"the Bun executable that this build starts from doesn't have ",
                );
                out.extend_from_slice(feature.text().as_bytes());
                out.extend_from_slice(b", which this executable needs");
            }
            TrimError::Request(TrimRequestError::TemplateWithoutProgramFeature(feature)) => {
                out.extend_from_slice(
                    b"a template keeps everything that a program can use, so it can't leave out ",
                );
                out.extend_from_slice(feature.text().as_bytes());
            }
            TrimError::Unsupported(reason) => {
                out.extend_from_slice(b"this build of Bun doesn't support --trim (");
                out.extend_from_slice(<&'static str>::from(reason).as_bytes());
                out.push(b')');
            }
            TrimError::Internal(error) => {
                out.extend_from_slice(b"--trim failed (");
                out.extend_from_slice(error.name().as_bytes());
                out.extend_from_slice(b"). This is a bug in Bun, please report it");
            }
        }
    }
}

impl From<TrimRequestError> for TrimError {
    fn from(error: TrimRequestError) -> TrimError {
        TrimError::Request(error)
    }
}

impl From<UnsupportedReason> for TrimError {
    fn from(reason: UnsupportedReason) -> TrimError {
        TrimError::Unsupported(reason)
    }
}

impl From<TrimInternalError> for TrimError {
    fn from(error: TrimInternalError) -> TrimError {
        TrimError::Internal(error)
    }
}

impl From<bun_exe_format::Error> for TrimError {
    fn from(error: bun_exe_format::Error) -> TrimError {
        TrimError::Internal(TrimInternalError::Format(error))
    }
}

fn write_quoted_list<'a>(out: &mut Vec<u8>, names: impl ExactSizeIterator<Item = &'a [u8]>) {
    let count = names.len();
    for (index, name) in names.enumerate() {
        if index > 0 {
            let separator: &[u8] = if index + 1 == count { b" and " } else { b", " };
            out.extend_from_slice(separator);
        }
        write_quoted(out, name);
    }
}

fn write_quoted(out: &mut Vec<u8>, name: &[u8]) {
    out.push(b'"');
    out.extend_from_slice(name);
    out.push(b'"');
}

fn edit_distance(a: &[u8], b: &[u8]) -> usize {
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, &from) in a.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, &to) in b.iter().enumerate() {
            let substituted = diagonal + usize::from(!from.eq_ignore_ascii_case(&to));
            diagonal = row[j + 1];
            row[j + 1] = substituted.min(diagonal + 1).min(row[j] + 1);
        }
    }
    row[b.len()]
}

fn find_closest_name(name: &[u8]) -> Option<TrimFeature> {
    let (distance, closest) = TrimFeature::ALL
        .iter()
        .map(|&feature| (edit_distance(name, feature.name().as_bytes()), feature))
        .min_by_key(|&(distance, _)| distance)?;
    (distance <= (name.len() / 3).max(1)).then_some(closest)
}

fn write_valid_names(out: &mut Vec<u8>) {
    out.extend_from_slice(b". Valid names are ");
    for (index, feature) in TrimFeature::ALL.iter().enumerate() {
        if index > 0 {
            out.extend_from_slice(b", ");
        }
        write_quoted(out, feature.name().as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_exe_format::image::ImageError;

    fn message_bytes(error: impl Into<TrimError>) -> Vec<u8> {
        let mut out = Vec::new();
        error.into().write_message(&mut out);
        out
    }

    fn message(error: impl Into<TrimError>) -> String {
        String::from_utf8(message_bytes(error)).unwrap()
    }

    fn valid_names() -> String {
        let quoted: Vec<String> = TrimFeature::ALL
            .iter()
            .map(|feature| format!("\"{}\"", feature.name()))
            .collect();
        quoted.join(", ")
    }

    fn unknown_names(names: &[&[u8]]) -> Option<TrimRequestError> {
        TrimRequestError::for_unknown_names(names.iter().copied())
    }

    fn quoted_list(names: &[&[u8]]) -> String {
        let mut out = Vec::new();
        write_quoted_list(&mut out, names.iter().copied());
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn unknown_name_lists_valid_names() {
        let text = message(TrimRequestError::UnknownName(Box::from(
            &b"no-such-feature"[..],
        )));
        assert_eq!(
            text,
            format!(
                "compile.trim: unknown name \"no-such-feature\". Valid names are {}",
                valid_names()
            )
        );
        assert!(text.contains("Valid names are \"cli\", \"lint\", "));
        assert!(!text.contains(" and "));
        assert_eq!(text.matches('"').count(), 2 * (TrimFeature::ALL.len() + 1));
    }

    #[test]
    fn unknown_name_close_to_a_valid_name_suggests_it() {
        for (name, closest) in [
            ("sqlite3", "sqlite"),
            ("htmlrewriter", "html-rewriter"),
            ("Shell", "shell"),
        ] {
            assert_eq!(
                message(TrimRequestError::UnknownName(Box::from(name.as_bytes()))),
                format!("compile.trim: unknown name \"{name}\". Did you mean \"{closest}\"?")
            );
        }
    }

    #[test]
    fn closest_name_is_the_first_of_equally_close_names() {
        let first_of = |names: &[&str]| {
            TrimFeature::ALL
                .iter()
                .copied()
                .find(|feature| names.contains(&feature.name()))
        };
        assert_eq!(find_closest_name(b"http"), first_of(&["http2", "http3"]));
        assert_eq!(
            find_closest_name(b"json"),
            first_of(&["json5", "jsonc", "jsonl"])
        );
    }

    #[test]
    fn name_far_from_every_valid_name_has_no_closest_name() {
        let names: [&[u8]; 6] = [
            b"",
            b"a",
            b"xx",
            b"crypto",
            b"bun:sqlite",
            b"no-such-feature",
        ];
        for name in names {
            assert_eq!(
                find_closest_name(name),
                None,
                "{}",
                String::from_utf8_lossy(name)
            );
        }
    }

    #[test]
    fn edit_distance_counts_changes_and_ignores_ascii_case() {
        assert_eq!(edit_distance(b"", b""), 0);
        assert_eq!(edit_distance(b"", b"sql"), 3);
        assert_eq!(edit_distance(b"sql", b""), 3);
        assert_eq!(edit_distance(b"SQLite", b"sqlite"), 0);
        assert_eq!(edit_distance(b"sqlite3", b"sqlite"), 1);
        assert_eq!(edit_distance(b"sqlite", b"sqlite3"), 1);
        assert_eq!(edit_distance(b"yaml", b"toml"), 2);
        assert_eq!(edit_distance(b"kitten", b"sitting"), 3);
    }

    #[test]
    fn unknown_names_lists_names_and_valid_names() {
        let error = unknown_names(&[b"nothing", b"nobody", b"nowhere"]).unwrap();
        assert_eq!(
            message(error),
            format!(
                "compile.trim: unknown names \"nothing\", \"nobody\" and \"nowhere\". Valid names are {}",
                valid_names()
            )
        );
    }

    #[test]
    fn unknown_locale_quotes_tag() {
        assert_eq!(
            message(TrimRequestError::UnknownLocale(Box::from(&b"xx"[..]))),
            "compile.trim: this build of Bun has no data for the locale \"xx\""
        );
    }

    #[test]
    fn unsupported_prints_reason_name() {
        let reasons = [
            (UnsupportedReason::NoTrimTable, "NoTrimTable"),
            (
                UnsupportedReason::FeatureListMismatch,
                "FeatureListMismatch",
            ),
            (UnsupportedReason::AlreadyTrimmed, "AlreadyTrimmed"),
            (
                UnsupportedReason::UnrecognizedExecutable,
                "UnrecognizedExecutable",
            ),
        ];
        for (reason, name) in reasons {
            assert_eq!(
                message(reason),
                format!("this build of Bun doesn't support --trim ({name})")
            );
        }
    }

    #[test]
    fn internal_prints_error_name() {
        let errors = [
            (TrimInternalError::MalformedTable, "MalformedTable"),
            (TrimInternalError::RangeOutsideImage, "RangeOutsideImage"),
            (TrimInternalError::MalformedIcuData, "MalformedIcuData"),
        ];
        for (error, name) in errors {
            assert_eq!(
                message(error),
                format!("--trim failed ({name}). This is a bug in Bun, please report it")
            );
        }
    }

    #[test]
    fn format_error_prints_inner_name() {
        let cut_not_aligned = TrimInternalError::Format(ImageError::CutNotAligned.into());
        assert_eq!(cut_not_aligned.name(), "CutNotAligned");
        assert_eq!(
            message(cut_not_aligned),
            "--trim failed (CutNotAligned). This is a bug in Bun, please report it"
        );
        let io = bun_exe_format::Error::Io(std::io::Error::other("short read"));
        assert_eq!(
            message(io),
            "--trim failed (Io). This is a bug in Bun, please report it"
        );
    }

    #[test]
    fn for_unknown_names_keeps_first_occurrences() {
        assert_eq!(unknown_names(&[]), None);
        let single = Some(TrimRequestError::UnknownName(Box::from(&b"a"[..])));
        assert_eq!(unknown_names(&[b"a"]), single);
        assert_eq!(unknown_names(&[b"a", b"a"]), single);
        assert_eq!(
            unknown_names(&[b"nothing", b"nobody", b"nowhere", b"nothing"]),
            Some(TrimRequestError::UnknownNames(vec![
                Box::from(&b"nothing"[..]),
                Box::from(&b"nobody"[..]),
                Box::from(&b"nowhere"[..]),
            ]))
        );
    }

    #[test]
    fn non_utf8_name_is_written_unchanged() {
        let text = message_bytes(TrimRequestError::UnknownName(Box::from(&b"\xff\xfe"[..])));
        assert!(text.starts_with(b"compile.trim: unknown name \"\xff\xfe\". Valid names are "));
    }

    #[test]
    fn write_quoted_list_puts_and_before_the_last_name() {
        assert_eq!(quoted_list(&[]), "");
        assert_eq!(quoted_list(&[b"ffi"]), "\"ffi\"");
        assert_eq!(quoted_list(&[b"ffi", b"sqlite"]), "\"ffi\" and \"sqlite\"");
        assert_eq!(
            quoted_list(&[b"ffi", b"sqlite", b"sql"]),
            "\"ffi\", \"sqlite\" and \"sql\""
        );
    }

    #[test]
    fn write_message_appends_without_prefix_or_newline() {
        let errors: Vec<TrimError> = vec![
            TrimRequestError::UnknownName(Box::from(&b"a"[..])).into(),
            TrimRequestError::UnknownName(Box::from(&b"sqlite3"[..])).into(),
            unknown_names(&[b"a", b"b"]).unwrap().into(),
            TrimRequestError::UnknownLocale(Box::from(&b"xx"[..])).into(),
            UnsupportedReason::NoTrimTable.into(),
            TrimInternalError::MalformedTable.into(),
        ];
        for error in errors {
            let mut out = b"start ".to_vec();
            error.write_message(&mut out);
            assert!(out.starts_with(b"start "));
            let text = &out[b"start ".len()..];
            assert!(!text.starts_with(b"error:"));
            assert!(!text.ends_with(b"\n"));
        }
    }
}
