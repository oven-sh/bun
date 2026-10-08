use bun_lint::prelude::*;
use std::borrow::Cow;

/// Disallow certain types.
pub struct NoRestrictedTypes {
    /// By name without whitespace, sorted.
    banned: Vec<(Vec<u8>, Ban)>,
    /// The length of the longest of the names.
    longest: usize,
}

struct Ban {
    /// Empty, or with a space before it.
    custom_message: Vec<u8>,
    fix_with: Option<Vec<u8>>,
    suggest: Vec<Vec<u8>>,
}

const BANNED_TYPE_MESSAGE: Message = Message::new(
    "bannedTypeMessage",
    "Don't use `{{name}}` as a type.{{customMessage}}",
);
const BANNED_TYPE_REPLACEMENT: Message = Message::new(
    "bannedTypeReplacement",
    "Replace `{{name}}` with `{{replacement}}`.",
);

/// `str.replaceAll(/\s/g, '')`
fn remove_spaces(text: &[u8]) -> Cow<'_, [u8]> {
    if !text.iter().any(|b| matches!(b, 0x09..=0x0D | 0x20 | 0x80..)) {
        return Cow::Borrowed(text);
    }
    let mut out = Vec::with_capacity(text.len());
    let mut points = text::code_points(text).peekable();
    while let Some((at, c)) = points.next() {
        let end = points.peek().map_or(text.len(), |next| next.0);
        if !text::is_js_whitespace(c) {
            out.extend_from_slice(&text[at..end]);
        }
    }
    Cow::Owned(out)
}

fn custom_message(message: &[u8]) -> Vec<u8> {
    match message.is_empty() {
        true => Vec::new(),
        false => [&b" "[..], message].concat(),
    }
}

fn keyword_name(keyword: Keyword) -> Option<&'static str> {
    Some(match keyword {
        Keyword::BigInt => "bigint",
        Keyword::Boolean => "boolean",
        Keyword::Never => "never",
        Keyword::Null => "null",
        Keyword::Number => "number",
        Keyword::Object => "object",
        Keyword::String => "string",
        Keyword::Symbol => "symbol",
        Keyword::Undefined => "undefined",
        Keyword::Unknown => "unknown",
        Keyword::Void => "void",
        Keyword::Any | Keyword::This | Keyword::Intrinsic => return None,
    })
}

impl NoRestrictedTypes {
    fn get(&self, name: &[u8]) -> Option<&Ban> {
        let at = self.banned.binary_search_by(|it| (*it.0).cmp(name)).ok()?;
        Some(&self.banned.get(at)?.1)
    }

    fn check_named<'a>(&self, at: Span, name: &[u8], cx: &Cx<'a, Self>) {
        let Some(ban) = self.get(name) else {
            return;
        };
        let mut report = cx
            .report(at, BANNED_TYPE_MESSAGE)
            .data("name", name.to_vec())
            .data("customMessage", ban.custom_message.clone());
        if let Some(fix_with) = &ban.fix_with {
            report = report.fix(|fixer| fixer.replace(at, &fix_with[..]));
        }
        for replacement in &ban.suggest {
            report = report.suggest_with(
                BANNED_TYPE_REPLACEMENT,
                &[("name", name), ("replacement", &replacement[..])],
                |fixer| fixer.replace(at, &replacement[..]),
            );
        }
        drop(report);
    }

    fn check(&self, at: Span, cx: &Cx<'_, Self>) {
        // What has more characters that are no spaces than the longest name is none of them.
        let text = cx.slice(at);
        if text.len() <= self.longest || text.iter().filter(|it| it.is_ascii_graphic()).nth(self.longest).is_none() {
            self.check_named(at, &remove_spaces(text), cx);
        }
    }

    /// A `TSTypeReference`, a `TSClassImplements` or a `TSInterfaceHeritage`.
    fn check_reference<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let (name, args) = match ty.kind() {
            TypeKind::Ref { name, args } => (name.span(), args),
            TypeKind::Heritage { expr, args } => (expr.span(), args),
            _ => return,
        };
        self.check(name, cx);
        if !args.is_empty() {
            self.check(ty.span(), cx);
        }
    }
}

impl Rule for NoRestrictedTypes {
    const META: Meta = Meta::typescript("no-restricted-types", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let mut banned: Vec<(Vec<u8>, Ban)> = Vec::new();
        for (name, value) in options.object(0).object("types").entries() {
            let name = remove_spaces(name).into_owned();
            // A later entry replaces an earlier one of the same name.
            banned.retain(|it| it.0 != name);
            let ban = match value {
                Json::Bool(true) => Ban {
                    custom_message: Vec::new(),
                    fix_with: None,
                    suggest: Vec::new(),
                },
                Json::String(message) => Ban {
                    custom_message: custom_message(message),
                    fix_with: None,
                    suggest: Vec::new(),
                },
                Json::Object(_) => {
                    let object = Object::of(Some(value));
                    let bytes = |key| object.get(key).and_then(Json::as_str);
                    Ban {
                        custom_message: custom_message(bytes("message").unwrap_or_default()),
                        fix_with: bytes("fixWith").filter(|it| !it.is_empty()).map(<[u8]>::to_vec),
                        suggest: object
                            .array("suggest")
                            .iter()
                            .filter_map(|it| Some(it.as_str()?.to_vec()))
                            .collect(),
                    }
                }
                _ => continue,
            };
            banned.push((name, ban));
        }
        banned.sort_by(|a, b| a.0.cmp(&b.0));
        NoRestrictedTypes {
            longest: banned.iter().map(|it| it.0.len()).max().unwrap_or(0),
            banned,
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.banned.is_empty() {
            return;
        }
        on.types([TypeTag::Ref, TypeTag::Heritage], Self::check_reference);
        on.types([TypeTag::Tuple, TypeTag::Object], |rule, ty, cx| {
            let is_empty = match ty.kind() {
                TypeKind::Tuple(elements) => elements.is_empty(),
                TypeKind::Object(members) => members.is_empty(),
                _ => false,
            };
            if is_empty {
                rule.check(ty.span(), cx);
            }
        });
        on.types([TypeTag::Keyword], |rule, ty, cx| {
            if let TypeKind::Keyword(keyword) = ty.kind()
                && let Some(name) = keyword_name(keyword)
            {
                rule.check_named(ty.span(), name.as_bytes(), cx);
            }
        });
        // ESLint has a `TSSymbolKeyword` in `unique symbol`, and a `TSTypeReference` in `as const`.
        on.types([TypeTag::UniqueSymbol], |rule, ty, cx| {
            if let Some(keyword) = ty.unique_symbol_keyword_span() {
                rule.check_named(keyword, b"symbol", cx);
            }
        });
        on.exprs([ExprTag::AsConst], |rule, e, cx| {
            if let Some(keyword) = e.const_keyword_span() {
                rule.check_named(keyword, b"const", cx);
            }
        });
    }
}
