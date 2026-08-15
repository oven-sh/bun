//! `~/.aws/config` and `~/.aws/credentials`: `[section]` headers,
//! `key = value` lines, `#`/`;` comments, and indented continuation lines
//! (nested `s3 =` blocks) which are skipped.

use bun_core::strings;

pub struct Section {
    /// `default`, a profile name, or `sso-session NAME` / `services NAME`.
    pub kind: SectionKind,
    pub name: Box<[u8]>,
    pub entries: Vec<(Box<[u8]>, Box<[u8]>)>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SectionKind {
    Profile,
    SsoSession,
    Other,
}

#[derive(Default)]
pub struct IniFile {
    pub sections: Vec<Section>,
}

impl IniFile {
    /// `is_config`: in the config file profiles are spelled `[profile NAME]`
    /// (except `[default]`); in the credentials file they are bare `[NAME]`.
    pub fn parse(contents: &[u8], is_config: bool) -> IniFile {
        let mut file = IniFile::default();
        let mut current: Option<usize> = None;
        for raw_line in contents.split(|b| *b == b'\n') {
            let line = strings::trim(raw_line, b" \t\r");
            if line.is_empty() || line[0] == b'#' || line[0] == b';' {
                continue;
            }
            if line[0] == b'[' {
                current = None;
                let Some(end) = strings::index_of_char_usize(line, b']') else {
                    continue;
                };
                let header = strings::trim(&line[1..end], b" \t");
                let (kind, name) = Self::classify(header, is_config);
                if name.is_empty() {
                    continue;
                }
                // A later duplicate section merges into (and overrides) the earlier one.
                current = Some(
                    match file
                        .sections
                        .iter()
                        .position(|s| s.kind == kind && &*s.name == name)
                    {
                        Some(i) => i,
                        None => {
                            file.sections.push(Section {
                                kind,
                                name: Box::from(name),
                                entries: Vec::new(),
                            });
                            file.sections.len() - 1
                        }
                    },
                );
                continue;
            }
            // Indented lines are sub-section values (`s3 =\n  max_concurrent_requests = 20`).
            if raw_line.first().is_some_and(|c| *c == b' ' || *c == b'\t') {
                continue;
            }
            let Some(section) = current else { continue };
            let Some(eq) = strings::index_of_char_usize(line, b'=') else {
                continue;
            };
            let key = strings::trim(&line[..eq], b" \t");
            let mut value = strings::trim(&line[eq + 1..], b" \t");
            // Trailing ` # comment` / ` ; comment` (only when preceded by whitespace,
            // so `#` inside values like ARNs or URLs survives).
            for marker in [b" #", b" ;", b"\t#", b"\t;"] {
                if let Some(i) = strings::index_of(value, marker) {
                    value = strings::trim(&value[..i], b" \t");
                }
            }
            if key.is_empty() {
                continue;
            }
            let entries = &mut file.sections[section].entries;
            let key_lower: Box<[u8]> = key.iter().map(u8::to_ascii_lowercase).collect();
            if let Some(existing) = entries.iter_mut().find(|(k, _)| *k == key_lower) {
                existing.1 = Box::from(value);
            } else {
                entries.push((key_lower, Box::from(value)));
            }
        }
        file
    }

    fn classify(header: &[u8], is_config: bool) -> (SectionKind, &[u8]) {
        let split_kw = |kw: &[u8]| -> Option<&[u8]> {
            if header.len() > kw.len()
                && header[..kw.len()].eq_ignore_ascii_case(kw)
                && (header[kw.len()] == b' ' || header[kw.len()] == b'\t')
            {
                Some(strings::trim(&header[kw.len()..], b" \t"))
            } else {
                None
            }
        };
        if let Some(name) = split_kw(b"sso-session") {
            return (SectionKind::SsoSession, name);
        }
        if split_kw(b"services").is_some() || split_kw(b"plugins").is_some() {
            return (SectionKind::Other, header);
        }
        if is_config {
            if let Some(name) = split_kw(b"profile") {
                return (SectionKind::Profile, name);
            }
            if header == b"default" {
                return (SectionKind::Profile, header);
            }
            // The CLI also accepts bare `[name]` in config for legacy files.
            return (SectionKind::Profile, header);
        }
        (SectionKind::Profile, header)
    }

    pub fn section(&self, kind: SectionKind, name: &[u8]) -> Option<&Section> {
        self.sections
            .iter()
            .find(|s| s.kind == kind && &*s.name == name)
    }
}

impl Section {
    pub fn get(&self, key: &[u8]) -> Option<&[u8]> {
        self.entries
            .iter()
            .find(|(k, _)| &**k == key)
            .map(|(_, v)| &**v)
            .filter(|v| !v.is_empty())
    }
}

/// A profile's merged view: the credentials file wins over the config file
/// for keys present in both (matching the AWS CLI/SDKs).
pub struct Profile<'a> {
    credentials: Option<&'a Section>,
    config: Option<&'a Section>,
}

impl<'a> Profile<'a> {
    pub fn lookup(name: &[u8], credentials: &'a IniFile, config: &'a IniFile) -> Option<Self> {
        let p = Profile {
            credentials: credentials.section(SectionKind::Profile, name),
            config: config.section(SectionKind::Profile, name),
        };
        if p.credentials.is_none() && p.config.is_none() {
            None
        } else {
            Some(p)
        }
    }

    pub fn get(&self, key: &[u8]) -> Option<&'a [u8]> {
        self.credentials
            .and_then(|s| s.get(key))
            .or_else(|| self.config.and_then(|s| s.get(key)))
    }
}
