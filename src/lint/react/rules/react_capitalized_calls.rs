use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_react_compiler::{EnvOptions, ErrorCategory, Flavor, rule};
use std::sync::Arc;

/// A React Compiler rule, which reports the diagnostics of one category. `RULE` below `RULES.len()` is oxlint's
/// `react/..` rule for that entry of [`RULES`]. From `RULES.len()` on it's eslint-plugin-react-hooks' `react-hooks/..`
/// rule for the same entries.
///
/// The plugin's rule has one option, an object that's merged into the compiler's options. It's ignored here.
pub struct CompilerRule<const RULE: usize = 0> {
    /// oxlint's `react/capitalized-calls` has the options `allow` and `allowPattern`. `None` without them, and for
    /// every other rule.
    env_options: Option<Arc<EnvOptions>>,
}

/// (name, category, its kind in oxlint, whether it's in the plugin's `recommended` config)
const RULES: [(&str, ErrorCategory, Kind, bool); 26] = [
    ("capitalized-calls", ErrorCategory::CapitalizedCalls, Kind::Problem, false),
    ("config", ErrorCategory::Config, Kind::Problem, true),
    ("error-boundaries", ErrorCategory::ErrorBoundaries, Kind::Problem, true),
    ("exhaustive-effect-dependencies", ErrorCategory::EffectExhaustiveDependencies, Kind::Problem, false),
    ("fbt", ErrorCategory::FBT, Kind::Problem, false),
    ("gating", ErrorCategory::Gating, Kind::Problem, true),
    ("globals", ErrorCategory::Globals, Kind::Problem, true),
    ("hooks", ErrorCategory::Hooks, Kind::Problem, false),
    ("immutability", ErrorCategory::Immutability, Kind::Problem, true),
    ("incompatible-library", ErrorCategory::IncompatibleLibrary, Kind::Problem, true),
    ("invariant", ErrorCategory::Invariant, Kind::Suggestion, false),
    ("memo-dependencies", ErrorCategory::MemoDependencies, Kind::Problem, false),
    ("memoized-effect-dependencies", ErrorCategory::EffectDependencies, Kind::Problem, false),
    ("no-deriving-state-in-effects", ErrorCategory::EffectDerivationsOfState, Kind::Suggestion, false),
    ("preserve-manual-memoization", ErrorCategory::PreserveManualMemo, Kind::Problem, true),
    ("purity", ErrorCategory::Purity, Kind::Problem, true),
    ("refs", ErrorCategory::Refs, Kind::Problem, true),
    ("rule-suppression", ErrorCategory::Suppression, Kind::Suggestion, false),
    ("set-state-in-effect", ErrorCategory::EffectSetState, Kind::Problem, true),
    ("set-state-in-render", ErrorCategory::RenderSetState, Kind::Problem, true),
    ("static-components", ErrorCategory::StaticComponents, Kind::Problem, true),
    ("syntax", ErrorCategory::Syntax, Kind::Suggestion, false),
    ("todo", ErrorCategory::Todo, Kind::Suggestion, false),
    ("unsupported-syntax", ErrorCategory::UnsupportedSyntax, Kind::Suggestion, true),
    ("use-memo", ErrorCategory::UseMemo, Kind::Problem, true),
    ("void-use-memo", ErrorCategory::VoidUseMemo, Kind::Problem, false),
];

impl<const RULE: usize> CompilerRule<RULE> {
    const FLAVOR: Flavor = if RULE < RULES.len() { Flavor::Oxlint } else { Flavor::Eslint };
    const CATEGORY: ErrorCategory = RULES[RULE % RULES.len()].1;
}

impl<const RULE: usize> Rule for CompilerRule<RULE> {
    const META: Meta = {
        let (name, category, kind, is_recommended) = RULES[RULE % RULES.len()];
        // The plugin marks every compiler rule as fixable with suggestions. None of them fix, and only these three suggest.
        let suggests = matches!(
            category,
            ErrorCategory::MemoDependencies | ErrorCategory::EffectExhaustiveDependencies | ErrorCategory::Syntax
        );
        let plugin_meta = Meta::plugin(Plugin::ReactHooks, name, Kind::Problem)
            .fixable(Fixable::Code)
            .has_suggestions()
            .never_fixes()
            .reports_on_creation();
        let plugin_meta = if suggests { plugin_meta } else { plugin_meta.never_suggests() };
        match (Self::FLAVOR, is_recommended) {
            (Flavor::Oxlint, _) => Meta::oxlint(Plugin::React, name, kind),
            (Flavor::Eslint, true) => plugin_meta.recommended(),
            (Flavor::Eslint, false) => plugin_meta,
        }
    };
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        if !matches!((Self::FLAVOR, Self::CATEGORY), (Flavor::Oxlint, ErrorCategory::CapitalizedCalls)) {
            return Self { env_options: None };
        }
        // oxlint's `CapitalizedCallsConfig`
        let options = options.object(0);
        let allow = options.strings("allow");
        let pattern = options.str("allowPattern").and_then(allow_pattern);
        let env_options = (!allow.is_empty() || pattern.is_some()).then(|| {
            Arc::new(EnvOptions {
                capitalized_calls_allow: allow.into_iter().map(str::to_owned).collect(),
                capitalized_calls_allow_pattern: pattern,
            })
        });
        Self { env_options }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !rule::starts(file, Self::FLAVOR, Self::CATEGORY) {
            return None;
        }
        if let Some(env_options) = &self.env_options {
            bun_lint_react_compiler::set_env_options(file, env_options);
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        match Self::FLAVOR {
            Flavor::Oxlint => rule::report(cx, Self::CATEGORY),
            Flavor::Eslint => rule::report_as_eslint(cx, Self::CATEGORY),
        }
    }
}

/// Compiles `allowPattern`, which oxlint compiles with Rust's `regex` crate. `None` if JavaScript has no equivalent.
fn allow_pattern(pattern: &str) -> Option<Regex> {
    let mut parser = RustPattern {
        pattern,
        offset: 0,
        modes: Modes {
            ignore_case: false,
            multi_line: false,
            dot_all: false,
            crlf: false,
            ignore_whitespace: false,
            unicode: true,
        },
    };
    let mut javascript = String::new();
    parser.alternatives(&mut javascript, 0)?;
    // A `)` without its `(` ends it early.
    if !parser.rest().is_empty() {
        return None;
    }
    Regex::new(&javascript, "v").ok()
}

/// The crate's flags, except `U`: greediness changes which match is found, not whether there is one.
#[derive(Copy, Clone)]
struct Modes {
    ignore_case: bool,
    multi_line: bool,
    dot_all: bool,
    crlf: bool,
    ignore_whitespace: bool,
    unicode: bool,
}

enum Escape {
    Literal(char),
    /// `\d`, `\pL`: a JavaScript class.
    Class(String),
    /// `\b`: a JavaScript assertion.
    Assertion(String),
}

/// Rewrites a pattern of the `regex` crate as a JavaScript pattern for the `v` flag, with `regex-syntax` 0.8's parser.
struct RustPattern<'p> {
    pattern: &'p str,
    offset: usize,
    modes: Modes,
}

/// `regex-syntax` rejects more groups and classes inside each other.
const NEST_LIMIT: u32 = 250;

/// What the classes `\d`, `\s` and `\w` have by Unicode, and with `(?-u)`.
const DIGIT: [&str; 2] = [r"\p{Nd}", "0-9"];
const SPACE: [&str; 2] = [r"\p{White_Space}", r"\t\n\v\f\r\x20"];
const WORD: [&str; 2] = [
    r"\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}",
    "0-9A-Za-z_",
];

/// Adds `c` as itself, for inside a class and outside.
fn push_literal(out: &mut String, c: char) {
    match c.is_ascii_alphanumeric() {
        true => out.push(c),
        false => out.push_str(&format!("\\u{{{:X}}}", u32::from(c))),
    }
}

/// The binary properties that both `regex-syntax` 0.8.11 and JavaScript have, by each name that JavaScript takes.
/// The crate's `Other_*`, `Grapheme_Link`, `Hyphen`, `IDS_Unary_Operator`, `ID_Compat_Math_*`, `Modifier_Combining_Mark`
/// and `Prepended_Concatenation_Mark` are missing, which JavaScript hasn't.
const BINARY_PROPERTIES: &[u8] = b"\
AHex ASCII_Hex_Digit Alpha Alphabetic Bidi_C Bidi_Control Bidi_M Bidi_Mirrored CI CWCF CWCM CWL CWT CWU \
Case_Ignorable Cased Changes_When_Casefolded Changes_When_Casemapped Changes_When_Lowercased \
Changes_When_Titlecased Changes_When_Uppercased DI Dash Default_Ignorable_Code_Point Dep Deprecated Dia \
Diacritic EBase EComp EMod EPres Emoji Emoji_Component Emoji_Modifier Emoji_Modifier_Base Emoji_Presentation Ext \
ExtPict Extended_Pictographic Extender Gr_Base Gr_Ext Grapheme_Base Grapheme_Extend Hex Hex_Digit IDC IDS IDSB \
IDST IDS_Binary_Operator IDS_Trinary_Operator ID_Continue ID_Start Ideo Ideographic Join_C Join_Control LOE \
Logical_Order_Exception Lower Lowercase Math NChar Noncharacter_Code_Point Pat_Syn Pat_WS Pattern_Syntax \
Pattern_White_Space QMark Quotation_Mark RI Radical Regional_Indicator SD STerm Sentence_Terminal Soft_Dotted \
Term Terminal_Punctuation UIdeo Unified_Ideograph Upper Uppercase VS Variation_Selector White_Space XIDC XIDS \
XID_Continue XID_Start space";

/// The crate's general categories, by each name that JavaScript takes. It has no `Cs`.
const GENERAL_CATEGORIES: &[u8] = b"\
C Cased_Letter Cc Cf Close_Punctuation Cn Co Combining_Mark Connector_Punctuation Control Currency_Symbol \
Dash_Punctuation Decimal_Number Enclosing_Mark Final_Punctuation Format Initial_Punctuation L LC Letter \
Letter_Number Line_Separator Ll Lm Lo Lowercase_Letter Lt Lu M Mark Math_Symbol Mc Me Mn Modifier_Letter \
Modifier_Symbol N Nd Nl No Nonspacing_Mark Number Open_Punctuation Other Other_Letter Other_Number \
Other_Punctuation Other_Symbol P Paragraph_Separator Pc Pd Pe Pf Pi Po Private_Use Ps Punctuation S Sc Separator \
Sk Sm So Space_Separator Spacing_Mark Symbol Titlecase_Letter Unassigned Uppercase_Letter Z Zl Zp Zs cntrl digit \
punct";

/// The crate's scripts, which are Unicode 16's, by each name that JavaScript takes. It has no `Hrkt` and no `Zzzz`.
const SCRIPTS: &[u8] = b"\
Adlam Adlm Aghb Ahom Anatolian_Hieroglyphs Arab Arabic Armenian Armi Armn Avestan Avst Bali Balinese Bamu Bamum \
Bass Bassa_Vah Batak Batk Beng Bengali Bhaiksuki Bhks Bopo Bopomofo Brah Brahmi Brai Braille Bugi Buginese Buhd \
Buhid Cakm Canadian_Aboriginal Cans Cari Carian Caucasian_Albanian Chakma Cham Cher Cherokee Chorasmian Chrs \
Common Copt Coptic Cpmn Cprt Cuneiform Cypriot Cypro_Minoan Cyrillic Cyrl Deseret Deva Devanagari Diak \
Dives_Akuru Dogr Dogra Dsrt Dupl Duployan Egyp Egyptian_Hieroglyphs Elba Elbasan Elym Elymaic Ethi Ethiopic Gara \
Garay Geor Georgian Glag Glagolitic Gong Gonm Goth Gothic Gran Grantha Greek Grek Gujarati Gujr Gukh \
Gunjala_Gondi Gurmukhi Guru Gurung_Khema Han Hang Hangul Hani Hanifi_Rohingya Hano Hanunoo Hatr Hatran Hebr \
Hebrew Hira Hiragana Hluw Hmng Hmnp Hung Imperial_Aramaic Inherited Inscriptional_Pahlavi Inscriptional_Parthian \
Ital Java Javanese Kaithi Kali Kana Kannada Katakana Kawi Kayah_Li Khar Kharoshthi Khitan_Small_Script Khmer \
Khmr Khoj Khojki Khudawadi Kirat_Rai Kits Knda Krai Kthi Lana Lao Laoo Latin Latn Lepc Lepcha Limb Limbu Lina \
Linb Linear_A Linear_B Lisu Lyci Lycian Lydi Lydian Mahajani Mahj Maka Makasar Malayalam Mand Mandaic Mani \
Manichaean Marc Marchen Masaram_Gondi Medefaidrin Medf Meetei_Mayek Mend Mende_Kikakui Merc Mero \
Meroitic_Cursive Meroitic_Hieroglyphs Miao Mlym Modi Mong Mongolian Mro Mroo Mtei Mult Multani Myanmar Mymr \
Nabataean Nag_Mundari Nagm Nand Nandinagari Narb Nbat New_Tai_Lue Newa Nko Nkoo Nshu Nushu \
Nyiakeng_Puachue_Hmong Ogam Ogham Ol_Chiki Ol_Onal Olck Old_Hungarian Old_Italic Old_North_Arabian Old_Permic \
Old_Persian Old_Sogdian Old_South_Arabian Old_Turkic Old_Uyghur Onao Oriya Orkh Orya Osage Osge Osma Osmanya \
Ougr Pahawh_Hmong Palm Palmyrene Pau_Cin_Hau Pauc Perm Phag Phags_Pa Phli Phlp Phnx Phoenician Plrd Prti \
Psalter_Pahlavi Qaac Qaai Rejang Rjng Rohg Runic Runr Samaritan Samr Sarb Saur Saurashtra Sgnw Sharada Shavian \
Shaw Shrd Sidd Siddham SignWriting Sind Sinh Sinhala Sogd Sogdian Sogo Sora Sora_Sompeng Soyo Soyombo Sund \
Sundanese Sunu Sunuwar Sylo Syloti_Nagri Syrc Syriac Tagalog Tagb Tagbanwa Tai_Le Tai_Tham Tai_Viet Takr Takri \
Tale Talu Tamil Taml Tang Tangsa Tangut Tavt Telu Telugu Tfng Tglg Thaa Thaana Thai Tibetan Tibt Tifinagh Tirh \
Tirhuta Tnsa Todhri Todr Toto Tulu_Tigalari Tutg Ugar Ugaritic Vai Vaii Vith Vithkuqi Wancho Wara Warang_Citi \
Wcho Xpeo Xsux Yezi Yezidi Yi Yiii Zanabazar_Square Zanb Zinh Zyyy";

/// `regex-syntax`'s `symbolic_name_normalize`: the name of a property or of a value without what the crate ignores.
fn symbolic_name_normalize(name: &str) -> String {
    let bytes = name.as_bytes();
    let after_is = match bytes {
        [b'i' | b'I', b's' | b'S', rest @ ..] => Some(rest),
        _ => None,
    };
    let mut normalized = String::new();
    for &byte in after_is.unwrap_or(bytes) {
        if byte.is_ascii() && !matches!(byte, b' ' | b'_' | b'-') {
            normalized.push(char::from(byte.to_ascii_lowercase()));
        }
    }
    // `isc` is a property that the crate has no class for, and not the general category `C`.
    if after_is.is_some() && normalized == "c" {
        return "isc".to_owned();
    }
    normalized
}

/// The name in `names`, a space-separated list, that the crate reads as `normalized`.
fn spelling_of(names: &'static [u8], normalized: &str) -> Option<&'static str> {
    let is_same = |name: &&[u8]| {
        let letters = name.iter().filter(|&&byte| byte != b'_');
        letters.map(u8::to_ascii_lowercase).eq(normalized.bytes())
    };
    let name = strings::split(names, b" ").find(is_same)?;
    std::str::from_utf8(name).ok()
}

/// What JavaScript has between the braces for a general category of the crate.
fn general_category(normalized: &str) -> Option<String> {
    Some(match normalized {
        // General categories in the crate, properties in JavaScript.
        "any" => "Any".to_owned(),
        "assigned" => "Assigned".to_owned(),
        "ascii" => "ASCII".to_owned(),
        _ => format!("gc={}", spelling_of(GENERAL_CATEGORIES, normalized)?),
    })
}

/// The same for a name without a property, which the crate reads as a binary property, then as a general category,
/// then as a script. Its properties that aren't binary have no class. Of their names only `cf`, `sc` and `lc` are also
/// names of a category or a script, and it reads those as categories.
fn lone_name(normalized: &str) -> Option<String> {
    // JavaScript has no `WSpace`.
    if normalized == "wspace" {
        return Some("White_Space".to_owned());
    }
    let property = spelling_of(BINARY_PROPERTIES, normalized).map(str::to_owned);
    let category = property.or_else(|| general_category(normalized));
    category.or_else(|| Some(format!("sc={}", spelling_of(SCRIPTS, normalized)?)))
}

/// `\p{name}` in JavaScript, which takes one spelling of a name where the crate ignores case, ` `, `_`, `-` and a
/// leading `is`. `None` if the crate has no such class, or if JavaScript hasn't: `Age`, `Grapheme_Cluster_Break`,
/// `Sentence_Break`, `Word_Break` and the binary properties that [`BINARY_PROPERTIES`] lacks.
fn unicode_class(name: &str, is_negated: bool) -> Option<String> {
    let bytes = name.as_bytes();
    // The crate looks for `!=`, then for `:`, then for `=`.
    let (separator, is_negated) = match strings::index_of(bytes, b"!=") {
        Some(at) => (Some((at, at + 2)), !is_negated),
        None => {
            let colon = strings::index_of_char_usize(bytes, b':');
            let at = colon.or_else(|| strings::index_of_char_usize(bytes, b'='));
            (at.map(|at| (at, at + 1)), is_negated)
        }
    };
    let class = match separator {
        None => lone_name(&symbolic_name_normalize(name))?,
        Some((start, end)) => {
            let value = symbolic_name_normalize(name.get(end..)?);
            match symbolic_name_normalize(name.get(..start)?).as_str() {
                "gc" | "generalcategory" => general_category(&value)?,
                "sc" | "script" => format!("sc={}", spelling_of(SCRIPTS, &value)?),
                "scx" | "scriptextensions" => format!("scx={}", spelling_of(SCRIPTS, &value)?),
                _ => return None,
            }
        }
    };
    let escape = if is_negated { 'P' } else { 'p' };
    Some(format!("\\{escape}{{{class}}}"))
}

/// The items before a class's operator, and after it. JavaScript has `&&` and `--` between classes only, and no `~~`.
fn set_operation(operands: Option<&(String, char)>, right: &str) -> Option<String> {
    let Some((left, operator)) = operands else {
        return Some(right.to_owned());
    };
    // Each `~~` doubles the text, and the engine takes 2^20 characters.
    if left.len() + right.len() > 1 << 20 {
        return None;
    }
    Some(match operator {
        '&' => format!("[{left}]&&[{right}]"),
        '-' => format!("[{left}]--[{right}]"),
        _ => format!("[[{left}][{right}]]--[[{left}]&&[{right}]]"),
    })
}

impl<'p> RustPattern<'p> {
    fn rest(&self) -> &'p str {
        self.pattern.get(self.offset..).unwrap_or_default()
    }

    fn char(&self) -> Option<char> {
        self.rest().chars().next()
    }

    fn peek(&self) -> Option<char> {
        self.rest().chars().nth(1)
    }

    fn bump(&mut self) {
        self.offset += self.char().map_or(0, char::len_utf8);
    }

    fn bump_if(&mut self, prefix: &str) -> bool {
        let has_prefix = self.rest().starts_with(prefix);
        if has_prefix {
            self.offset += prefix.len();
        }
        has_prefix
    }

    /// With `(?x)`, skips blanks and comments.
    fn bump_space(&mut self) {
        if !self.modes.ignore_whitespace {
            return;
        }
        while let Some(c) = self.char() {
            if c.is_whitespace() {
                self.bump();
            } else if c == '#' {
                let rest = self.rest().as_bytes();
                self.offset += match strings::index_of_char_usize(rest, b'\n') {
                    Some(at) => at + 1,
                    None => rest.len(),
                };
            } else {
                break;
            }
        }
    }

    /// Returns the character it stops at.
    fn bump_and_bump_space(&mut self) -> Option<char> {
        self.bump();
        self.bump_space();
        self.char()
    }

    fn peek_space(&self) -> Option<char> {
        if !self.modes.ignore_whitespace {
            return self.peek();
        }
        let mut is_in_comment = false;
        // Any non-space character inside a comment ends the search, as in upstream.
        self.rest().chars().skip(1).find(|&c| {
            if c.is_whitespace() {
                return false;
            }
            if !is_in_comment && c == '#' {
                is_in_comment = true;
                return false;
            }
            if is_in_comment && c == '\n' {
                is_in_comment = false;
                return false;
            }
            true
        })
    }

    /// Adds `atom`, which matches one character, with the case sensitivity that's set here.
    fn push_matcher(&self, out: &mut String, atom: &str) {
        if !self.modes.ignore_case {
            out.push_str(atom);
            return;
        }
        if !self.modes.unicode {
            // JavaScript also takes `ſ` for `s` and the Kelvin sign for `k`.
            out.push_str(r"(?![\u017F\u212A])");
        }
        out.push_str("(?i:");
        out.push_str(atom);
        out.push(')');
    }

    fn perl_class(&self, [by_unicode, by_ascii]: [&str; 2], is_negated: bool) -> String {
        let negation = if is_negated { "^" } else { "" };
        let items = match self.modes.unicode {
            true => by_unicode,
            false => by_ascii,
        };
        format!("[{negation}{items}]")
    }

    /// The alternatives of a group, up to its `)`, or of the pattern.
    fn alternatives(&mut self, out: &mut String, depth: u32) -> Option<()> {
        // Where the item starts that a repetition operator repeats.
        let mut repeated = None;
        loop {
            self.bump_space();
            let start = out.len();
            match self.char() {
                None | Some(')') => return Some(()),
                Some('(') => repeated = self.group(out, depth)?.then_some(start),
                Some('|') => {
                    self.bump();
                    out.push('|');
                    repeated = None;
                }
                Some('[') => {
                    let class = self.class(depth)?;
                    self.push_matcher(out, &class);
                    repeated = Some(start);
                }
                Some(operator @ ('?' | '*' | '+' | '{')) => {
                    // In a group, because JavaScript repeats neither an assertion nor a repetition.
                    out.insert_str(repeated?, "(?:");
                    out.push(')');
                    if operator == '{' {
                        self.counted_repetition(out)?;
                    } else {
                        out.push(operator);
                        self.bump();
                        self.bump_if("?");
                    }
                }
                Some(_) => {
                    self.primitive(out)?;
                    repeated = Some(start);
                }
            }
        }
    }

    /// At `(`. Returns whether it's a group, and not flags for what follows.
    fn group(&mut self, out: &mut String, depth: u32) -> Option<bool> {
        self.bump();
        self.bump_space();
        let lookarounds = ["?=", "?!", "?<=", "?<!"];
        if lookarounds.iter().any(|it| self.rest().starts_with(it)) {
            return None;
        }
        let mut modes = self.modes;
        if self.bump_if("?P<") || self.bump_if("?<") {
            // No group captures, because nothing can refer to one.
            self.offset += strings::index_of_char_usize(self.rest().as_bytes(), b'>')? + 1;
        } else if self.bump_if("?") {
            modes = self.flags()?;
            if self.char() == Some(')') {
                self.bump();
                self.modes = modes;
                return Some(false);
            }
            self.bump();
        }
        if depth >= NEST_LIMIT {
            return None;
        }
        let outer_modes = std::mem::replace(&mut self.modes, modes);
        out.push_str("(?:");
        self.alternatives(out, depth + 1)?;
        if !self.bump_if(")") {
            return None;
        }
        out.push(')');
        self.modes = outer_modes;
        Some(true)
    }

    /// The modes with the flags that end at `:` or `)`.
    fn flags(&mut self) -> Option<Modes> {
        let mut modes = self.modes;
        let mut is_on = true;
        loop {
            match self.char()? {
                ':' | ')' => return Some(modes),
                '-' => is_on = false,
                'i' => modes.ignore_case = is_on,
                'm' => modes.multi_line = is_on,
                's' => modes.dot_all = is_on,
                'R' => modes.crlf = is_on,
                'x' => modes.ignore_whitespace = is_on,
                'u' => modes.unicode = is_on,
                'U' => {}
                _ => return None,
            }
            self.bump();
        }
    }

    /// At `{`.
    fn counted_repetition(&mut self, out: &mut String) -> Option<()> {
        self.bump_and_bump_space()?;
        out.push_str(&format!("{{{}", self.decimal()?));
        if self.char()? == ',' {
            out.push(',');
            if self.bump_and_bump_space()? != '}' {
                out.push_str(&self.decimal()?.to_string());
            }
        }
        if !self.bump_if("}") {
            return None;
        }
        out.push('}');
        self.bump_space();
        self.bump_if("?");
        Some(())
    }

    fn decimal(&mut self) -> Option<u32> {
        let mut digits = String::new();
        while self.char().is_some_and(char::is_whitespace) {
            self.bump();
        }
        while let Some(digit) = self.char().filter(char::is_ascii_digit) {
            digits.push(digit);
            self.bump_and_bump_space();
        }
        while self.char().is_some_and(char::is_whitespace) {
            self.bump_and_bump_space();
        }
        digits.parse().ok()
    }

    fn primitive(&mut self, out: &mut String) -> Option<()> {
        let c = self.char()?;
        if c == '\\' {
            match self.escape()? {
                Escape::Literal(c) => self.push_literal_matcher(out, c),
                Escape::Class(class) => self.push_matcher(out, &class),
                Escape::Assertion(assertion) => out.push_str(&assertion),
            }
            return Some(());
        }
        self.bump();
        let (multi_line, crlf) = (self.modes.multi_line, self.modes.crlf);
        // The pattern has no `m` flag in JavaScript, so there `^` and `$` are the ends of the text.
        match c {
            '.' => out.push_str(match (self.modes.dot_all, crlf) {
                (true, _) => r"[\s\S]",
                (false, false) => r"[^\n]",
                (false, true) => r"[^\n\r]",
            }),
            '^' => out.push_str(match (multi_line, crlf) {
                (false, _) => "^",
                (true, false) => r"(?<![^\n])",
                (true, true) => r"(?:(?<![^\n])|(?<=\r)(?!\n))",
            }),
            '$' => out.push_str(match (multi_line, crlf) {
                (false, _) => "$",
                (true, false) => r"(?![^\n])",
                (true, true) => r"(?:(?![^\r])|(?=\n)(?<!\r))",
            }),
            _ => self.push_literal_matcher(out, c),
        }
        Some(())
    }

    fn push_literal_matcher(&self, out: &mut String, c: char) {
        let mut literal = String::new();
        push_literal(&mut literal, c);
        // With `(?-u)` only ASCII letters fold.
        match self.modes.unicode || c.is_ascii() {
            true => self.push_matcher(out, &literal),
            false => out.push_str(&literal),
        }
    }

    /// At `\`.
    fn escape(&mut self) -> Option<Escape> {
        self.bump();
        let c = self.char()?;
        match c {
            'x' | 'u' | 'U' => return self.hex().map(Escape::Literal),
            'p' | 'P' => return self.unicode_class(c == 'P').map(Escape::Class),
            _ => {}
        }
        self.bump();
        Some(match c {
            'd' | 'D' => Escape::Class(self.perl_class(DIGIT, c == 'D')),
            's' | 'S' => Escape::Class(self.perl_class(SPACE, c == 'S')),
            'w' | 'W' => Escape::Class(self.perl_class(WORD, c == 'W')),
            'a' => Escape::Literal('\x07'),
            'f' => Escape::Literal('\x0C'),
            't' => Escape::Literal('\t'),
            'n' => Escape::Literal('\n'),
            'r' => Escape::Literal('\r'),
            'v' => Escape::Literal('\x0B'),
            'A' => Escape::Assertion("^".to_owned()),
            'z' => Escape::Assertion("$".to_owned()),
            'b' | 'B' | '<' | '>' => {
                let name = match c {
                    'b' if self.char() == Some('{') => self.special_word_boundary()?,
                    _ => c.to_string(),
                };
                Escape::Assertion(self.word_boundary(&name)?)
            }
            _ if c.is_ascii() && !c.is_ascii_alphanumeric() => Escape::Literal(c),
            _ => return None,
        })
    }

    /// At the `{` after `\b`. Returns the name in `\b{name}`, or `b` if the `{` is a repetition's.
    fn special_word_boundary(&mut self) -> Option<String> {
        let is_name_char = |c: char| c.is_ascii_alphabetic() || c == '-';
        let start = self.offset;
        if !is_name_char(self.bump_and_bump_space()?) {
            self.offset = start;
            return Some("b".to_owned());
        }
        let mut name = String::new();
        while let Some(c) = self.char().filter(|&c| is_name_char(c)) {
            name.push(c);
            self.bump_and_bump_space();
        }
        self.bump_if("}").then_some(name)
    }

    fn word_boundary(&self, name: &str) -> Option<String> {
        let word = self.perl_class(WORD, false);
        Some(match name {
            "b" => format!("(?:(?<={word})(?!{word})|(?<!{word})(?={word}))"),
            "B" => format!("(?:(?<={word})(?={word})|(?<!{word})(?!{word}))"),
            "<" | "start" => format!("(?<!{word})(?={word})"),
            ">" | "end" => format!("(?<={word})(?!{word})"),
            "start-half" => format!("(?<!{word})"),
            "end-half" => format!("(?!{word})"),
            _ => return None,
        })
    }

    /// At the `x` of `\x41` and `\x{41}`, and the same for `\u0041` and `\U00000041`.
    fn hex(&mut self) -> Option<char> {
        let length = match self.char()? {
            'x' => 2,
            'u' => 4,
            _ => 8,
        };
        let mut digits = String::new();
        if self.bump_and_bump_space()? == '{' {
            loop {
                match self.bump_and_bump_space()? {
                    '}' => break,
                    digit if digit.is_ascii_hexdigit() => digits.push(digit),
                    _ => return None,
                }
            }
        } else {
            for at in 0..length {
                if at > 0 {
                    self.bump_and_bump_space()?;
                }
                digits.push(self.char().filter(char::is_ascii_hexdigit)?);
            }
        }
        self.bump_and_bump_space();
        u32::from_str_radix(&digits, 16)
            .ok()
            .and_then(char::from_u32)
    }

    /// At the `p` of `\pL` and `\p{Greek}`.
    fn unicode_class(&mut self, is_negated: bool) -> Option<String> {
        // The crate rejects it with `(?-u)`.
        if !self.modes.unicode {
            return None;
        }
        let letter = self.bump_and_bump_space()?;
        if letter != '{' {
            self.bump_and_bump_space();
            return unicode_class(letter.encode_utf8(&mut [0; 4]), is_negated);
        }
        // Not a slice of the pattern: with `(?x)` the blanks and comments inside the braces aren't part of the name.
        let mut name = String::new();
        loop {
            match self.bump_and_bump_space()? {
                '}' => break,
                c => name.push(c),
            }
        }
        self.bump();
        unicode_class(&name, is_negated)
    }

    /// At `[`. Returns the class as a JavaScript class.
    fn class(&mut self, depth: u32) -> Option<String> {
        if depth >= NEST_LIMIT {
            return None;
        }
        let mut first = self.bump_and_bump_space()?;
        let is_negated = first == '^';
        if is_negated {
            first = self.bump_and_bump_space()?;
        }
        let mut union = String::new();
        // A `]` here is itself, and so is every `-`.
        if first == ']' {
            push_literal(&mut union, ']');
            self.bump_and_bump_space()?;
        }
        while first != ']' && self.char()? == '-' {
            push_literal(&mut union, '-');
            self.bump_and_bump_space()?;
        }
        let mut operands = None;
        loop {
            self.bump_space();
            match self.char()? {
                '[' => match self.ascii_class() {
                    Some(class) => union.push_str(&class),
                    None => union.push_str(&self.class(depth + 1)?),
                },
                ']' => break,
                operator @ ('&' | '-' | '~') if self.peek() == Some(operator) => {
                    self.bump();
                    self.bump();
                    operands = Some((set_operation(operands.as_ref(), &union)?, operator));
                    union.clear();
                }
                _ => self.class_range(&mut union)?,
            }
        }
        self.bump();
        let negation = if is_negated { "^" } else { "" };
        let items = set_operation(operands.as_ref(), &union)?;
        Some(format!("[{negation}{items}]"))
    }

    fn class_range(&mut self, union: &mut String) -> Option<()> {
        let first = self.class_item()?;
        self.bump_space();
        if self.char()? != '-' || matches!(self.peek_space(), Some(']' | '-')) {
            match first {
                Escape::Literal(c) => push_literal(union, c),
                Escape::Class(class) => union.push_str(&class),
                Escape::Assertion(_) => return None,
            }
            return Some(());
        }
        self.bump_and_bump_space()?;
        let (Escape::Literal(start), Escape::Literal(end)) = (first, self.class_item()?) else {
            return None;
        };
        push_literal(union, start);
        union.push('-');
        push_literal(union, end);
        Some(())
    }

    fn class_item(&mut self) -> Option<Escape> {
        match self.char()? {
            '\\' => self.escape(),
            c => {
                self.bump();
                Some(Escape::Literal(c))
            }
        }
    }

    /// At a `[` inside a class. Returns `[:alpha:]` and the like as a JavaScript class.
    fn ascii_class(&mut self) -> Option<String> {
        let rest = self.rest().strip_prefix("[:")?;
        let (negation, rest) = match rest.strip_prefix('^') {
            Some(rest) => ("^", rest),
            None => ("", rest),
        };
        let name = rest.get(..strings::index_of_char_usize(rest.as_bytes(), b':')?)?;
        let after = rest.get(name.len()..)?.strip_prefix(":]")?;
        let items = match name {
            "alnum" => "0-9A-Za-z",
            "alpha" => "A-Za-z",
            "ascii" => r"\x00-\x7F",
            "blank" => r"\t\x20",
            "cntrl" => r"\x00-\x1F\x7F",
            "digit" => "0-9",
            "graph" => r"\x21-\x7E",
            "lower" => "a-z",
            "print" => r"\x20-\x7E",
            "punct" => r"\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E",
            "space" => r"\t\n\v\f\r\x20",
            "upper" => "A-Z",
            "word" => "0-9A-Za-z_",
            "xdigit" => "0-9A-Fa-f",
            _ => return None,
        };
        self.offset = self.pattern.len() - after.len();
        Some(format!("[{negation}{items}]"))
    }
}
