use crate::config::PathPattern;
use crate::hir::{File, FileKind};
use crate::messages::Category;
use crate::program::{FileId, Files};
use bun_core::strings;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Rule {
    UntypedFile,
    UntypedPackage,
    LostLayout,
    UntypedBase,
    OpenLayout,
    Interpreted,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Severity {
    Allow,
    Warn,
    Deny,
}

pub struct RuleInfo {
    pub rule: Rule,
    pub name: &'static str,
    pub codes: &'static [u32],
    pub default: Severity,
    pub help: &'static str,
}

pub static RULES: [RuleInfo; Rule::COUNT] = [
    RuleInfo {
        rule: Rule::UntypedFile,
        name: "untyped-file",
        codes: &[100009, 100010, 100011],
        default: Severity::Warn,
        help: "a TypeScript file or package is compiled without its types",
    },
    RuleInfo {
        rule: Rule::UntypedPackage,
        name: "untyped-package",
        codes: &[100026],
        default: Severity::Allow,
        help: "a dependency is compiled as plain JavaScript",
    },
    RuleInfo {
        rule: Rule::LostLayout,
        name: "lost-layout",
        codes: &[100023, 100024],
        default: Severity::Allow,
        help: "a class has no fixed layout, or leaves declared fields out of it",
    },
    RuleInfo {
        rule: Rule::UntypedBase,
        name: "untyped-base",
        codes: &[100027],
        default: Severity::Allow,
        help: "a class has no fixed layout because it extends a built-in class or a JavaScript class",
    },
    RuleInfo {
        rule: Rule::OpenLayout,
        name: "open-layout",
        codes: &[100022],
        default: Severity::Allow,
        help: "a declared type can hold objects that typed code did not create, so every property access through it is checked",
    },
    RuleInfo {
        rule: Rule::Interpreted,
        name: "interpreted",
        codes: &[100025],
        default: Severity::Allow,
        help: "the program evaluates source text when it runs (eval, new Function, node:vm), and that code is interpreted",
    },
];

pub const EVERY_RULE: &str = "all";

impl Rule {
    pub const COUNT: usize = 6;

    pub fn info(self) -> &'static RuleInfo {
        &RULES[self as usize]
    }

    pub fn name(self) -> &'static str {
        self.info().name
    }

    pub fn named(name: &[u8]) -> Option<Rule> {
        RULES.iter().find(|info| info.name.as_bytes() == name).map(|info| info.rule)
    }

    pub fn of_code(code: u32) -> Option<Rule> {
        RULES.iter().find(|info| info.codes.contains(&code)).map(|info| info.rule)
    }
}

const _: () = {
    let mut at = 0;
    while at < RULES.len() {
        assert!(RULES[at].rule as usize == at, "RULES is indexed by Rule");
        at += 1;
    }
};

impl Severity {
    pub fn name(self) -> &'static str {
        match self {
            Severity::Allow => "allow",
            Severity::Warn => "warn",
            Severity::Deny => "deny",
        }
    }

    pub fn category(self) -> Option<Category> {
        match self {
            Severity::Allow => None,
            Severity::Warn => Some(Category::Warning),
            Severity::Deny => Some(Category::Error),
        }
    }
}

#[derive(Clone)]
struct Setting {
    rule: Option<Rule>,
    severity: Severity,
    scope: Option<Box<[u8]>>,
}

#[derive(Default, Clone)]
pub struct Settings {
    settings: Vec<Setting>,
}

pub struct UnknownRule {
    pub written: Vec<u8>,
}

impl Settings {
    pub fn is_default(&self) -> bool {
        self.settings.is_empty()
    }

    pub fn add(&mut self, severity: Severity, list: &[u8]) -> Result<(), UnknownRule> {
        for item in strings::split(list, b",") {
            let (name, scope) = match strings::index_of_char_usize(item, b':') {
                Some(colon) => (&item[..colon], Some(&item[colon + 1..])),
                None => (item, None),
            };
            let rule = match Rule::named(name) {
                Some(rule) => Some(rule),
                None if name == EVERY_RULE.as_bytes() => None,
                None => return Err(UnknownRule { written: name.to_vec() }),
            };
            self.settings.push(Setting { rule, severity, scope: scope.filter(|scope| !scope.is_empty()).map(Box::from) });
        }
        Ok(())
    }
}

type Severities = [Severity; Rule::COUNT];

fn default_severities() -> Severities {
    std::array::from_fn(|rule| RULES[rule].default)
}

pub const PRAGMA_PREFIX: &[u8] = b"@aot-";
pub const STRICT_PRAGMA: &[u8] = b"strict";
pub const ALLOW_PRAGMA: &[u8] = b"allow";

struct PragmaScope {
    file: FileId,
    start: u32,
    end: u32,
    severity: Severity,
    applies_to: [bool; Rule::COUNT],
}

fn parse_pragma(comment: &[u8]) -> Option<(Severity, [bool; Rule::COUNT])> {
    let written = comment.strip_prefix(b"//")?.trim_ascii().strip_prefix(PRAGMA_PREFIX)?;
    let word_len = written.iter().take_while(|byte| byte.is_ascii_alphabetic()).count();
    let (word, rest) = written.split_at(word_len);
    if word == STRICT_PRAGMA && rest.trim_ascii().is_empty() {
        return Some((Severity::Deny, [true; Rule::COUNT]));
    }
    if word != ALLOW_PRAGMA {
        return None;
    }
    let mut applies_to = [false; Rule::COUNT];
    for name in strings::split(rest, b",") {
        applies_to[Rule::named(name.trim_ascii())? as usize] = true;
    }
    Some((Severity::Allow, applies_to))
}

fn add_pragma_scopes(file: FileId, hir: &File<'_>, scopes: &mut Vec<PragmaScope>) {
    let text: &[u8] = &hir.text;
    if !strings::contains(text, PRAGMA_PREFIX) {
        return;
    }
    for comment in hir.comments.iter().filter(|comment| !comment.is_block) {
        let Some((severity, applies_to)) = parse_pragma(&text[comment.pos as usize..comment.end as usize]) else { continue };
        let start = comment.next_token_start;
        let end = if comment.prev_token_end == 0 {
            Some(text.len() as u32)
        } else {
            let statements = hir.stmts.iter().filter(|statement| statement.start == start).map(|statement| statement.loc.end);
            let members = hir.members.iter().filter(|member| member.start == start).map(|member| member.loc.end);
            statements.chain(members).max()
        };
        scopes.extend(end.map(|end| PragmaScope { file, start, end, severity, applies_to }));
    }
}

pub struct Scopes {
    outside_files: Severities,
    by_file: Vec<Severities>,
    pragmas: Vec<PragmaScope>,
    is_enabled: [bool; Rule::COUNT],
}

impl Scopes {
    pub fn new(settings: &Settings, files: &Files<'_>, base: &[u8]) -> Scopes {
        let apply = |severities: &mut Severities, setting: &Setting| match setting.rule {
            Some(rule) => severities[rule as usize] = setting.severity,
            None => *severities = [setting.severity; Rule::COUNT],
        };
        let mut pragmas = Vec::new();
        for (index, module) in files.modules.iter().enumerate().filter(|(_, module)| !module.is_lib && module.builtin.is_none() && !matches!(module.hir.kind, FileKind::Declaration | FileKind::Json)) {
            add_pragma_scopes(FileId(index as u32), &module.hir, &mut pragmas);
        }
        let is_denied_by_pragma = pragmas.iter().any(|pragma| pragma.severity == Severity::Deny);
        let mut outside_files = default_severities();
        for setting in settings.settings.iter().filter(|setting| setting.scope.is_none()) {
            apply(&mut outside_files, setting);
        }
        if settings.settings.iter().all(|setting| setting.scope.is_none()) {
            return Scopes { outside_files, by_file: Vec::new(), pragmas, is_enabled: outside_files.map(|severity| is_denied_by_pragma || severity != Severity::Allow) };
        }
        let patterns: Vec<Option<PathPattern>> = settings.settings.iter().map(|setting| setting.scope.as_deref().map(|scope| PathPattern::new(scope, base, files.is_case_sensitive))).collect();
        let by_file: Vec<Severities> = (files.modules.iter())
            .map(|module| {
                let mut severities = default_severities();
                for (setting, pattern) in settings.settings.iter().zip(&patterns) {
                    if pattern.as_ref().is_none_or(|pattern| pattern.matches(module.file_name())) {
                        apply(&mut severities, setting);
                    }
                }
                severities
            })
            .collect();
        let is_enabled = std::array::from_fn(|rule| is_denied_by_pragma || by_file.iter().any(|severities| severities[rule] != Severity::Allow));
        Scopes { outside_files, by_file, pragmas, is_enabled }
    }

    pub fn is_enabled(&self, rule: Rule) -> bool {
        self.is_enabled[rule as usize]
    }

    pub fn severity(&self, rule: Rule, file: FileId, pos: u32) -> Severity {
        let first = self.pragmas.partition_point(|pragma| pragma.file < file);
        let around = self.pragmas[first..].iter().take_while(|pragma| pragma.file == file).filter(|pragma| pragma.applies_to[rule as usize] && (pragma.start..pragma.end).contains(&pos));
        match around.min_by_key(|pragma| pragma.end - pragma.start) {
            Some(innermost) => innermost.severity,
            None => self.by_file.get(file.idx()).unwrap_or(&self.outside_files)[rule as usize],
        }
    }

    pub fn severity_outside_files(&self, rule: Rule) -> Severity {
        self.outside_files[rule as usize]
    }
}
