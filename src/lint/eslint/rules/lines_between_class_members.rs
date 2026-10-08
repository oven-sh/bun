use bun_lint::prelude::*;

/// Require or disallow an empty line between class members.
pub struct LinesBetweenClassMembers {
    configure_list: Vec<Configure>,
    except_after_single_line: bool,
}

const NEVER: Message = Message::new("never", "Unexpected blank line between class members.");
const ALWAYS: Message = Message::new("always", "Expected blank line between class members.");

/// ESLint's `ClassMemberTypes`.
#[derive(Copy, Clone)]
enum MemberType {
    Any,
    Field,
    Method,
}

struct Configure {
    is_always: bool,
    prev: MemberType,
    next: MemberType,
}

impl MemberType {
    fn of(name: Option<&str>) -> MemberType {
        match name {
            Some("field") => MemberType::Field,
            Some("method") => MemberType::Method,
            _ => MemberType::Any,
        }
    }

    fn test(self, member: Member) -> bool {
        match self {
            MemberType::Any => true,
            // `PropertyDefinition`
            MemberType::Field => {
                member.kind() == MemberKind::Property
                    && !member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
            }
            // `MethodDefinition`
            MemberType::Method => {
                matches!(
                    member.kind(),
                    MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor
                ) && !member.flags().contains(Flags::ABSTRACT)
            }
        }
    }
}

/// ESLint's `findLastConsecutiveTokenAfter`.
fn find_last_consecutive_token_after<'a>(
    file: &'a File<'a>,
    prev_last_token: Token<'a>,
    next_first_token: Token<'a>,
    max_line: u32,
) -> Token<'a> {
    let mut last = prev_last_token;
    for after in file.tokens_after(prev_last_token).with_comments() {
        if after == next_first_token || file.line_of(after.start()) > file.line_of(last.end()) + max_line {
            break;
        }
        last = after;
    }
    last
}

/// ESLint's `findFirstConsecutiveTokenBefore`.
fn find_first_consecutive_token_before<'a>(
    file: &'a File<'a>,
    next_first_token: Token<'a>,
    prev_last_token: Token<'a>,
    max_line: u32,
) -> Token<'a> {
    let mut first = next_first_token;
    for before in file.tokens_before(next_first_token).with_comments() {
        if before == prev_last_token || file.line_of(first.start()) > file.line_of(before.end()) + max_line {
            break;
        }
        first = before;
    }
    first
}

impl LinesBetweenClassMembers {
    /// ESLint's `getPaddingType`: whether a blank line is required, as opposed to forbidden.
    fn is_always(&self, prev: Member, next: Member) -> Option<bool> {
        let mut list = self.configure_list.iter().rev();
        list.find(|it| it.prev.test(prev) && it.next.test(next)).map(|it| it.is_always)
    }

    fn check_pair<'a>(&self, current: Member<'a>, next: Member<'a>, cx: &Cx<'a, Self>) {
        let Some(is_always) = self.is_always(current, next) else {
            return;
        };
        let file = cx.file();
        let (Some(cur_first), Some(last_token), Some(next_token)) =
            (file.first_token(current), file.last_token(current), file.first_token(next))
        else {
            return;
        };
        let Some(prev_token) = file.token_before(last_token) else {
            return;
        };
        // ESLint's `getBoundaryTokens`
        let is_semicolon_less_style = ast_utils::is_semicolon_token(&last_token)
            && !ast_utils::is_token_on_same_line(file, prev_token, last_token)
            && ast_utils::is_token_on_same_line(file, last_token, next_token);
        let (cur_last, next_first) = match is_semicolon_less_style {
            true => (prev_token, last_token),
            false => (last_token, next_token),
        };
        let before_padding = find_last_consecutive_token_after(file, cur_last, next_first, 1);
        let after_padding = find_first_consecutive_token_before(file, next_first, cur_last, 1);
        let is_padded = file.line_of(after_padding.start()) > file.line_of(before_padding.end()) + 1;
        let has_token_in_padding =
            || file.tokens_between(before_padding, after_padding).with_comments().next().is_some();
        if !is_always && is_padded {
            cx.report(next, NEVER).fix(|fixer| {
                let padding = Span::new(before_padding.end(), after_padding.start());
                (!has_token_in_padding()).then(|| fixer.replace(padding, "\n"))
            });
        } else if is_always && !is_padded {
            let is_multi = !ast_utils::is_token_on_same_line(file, cur_first, cur_last);
            if !is_multi && self.except_after_single_line {
                return;
            }
            cx.report(next, ALWAYS).fix(|fixer| {
                let cur_line_last_token = find_last_consecutive_token_after(file, cur_last, next_first, 0);
                (!has_token_in_padding()).then(|| fixer.insert_after(cur_line_last_token, "\n"))
            });
        }
    }
}

impl Rule for LinesBetweenClassMembers {
    const META: Meta = Meta::eslint("lines-between-class-members", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let configure_list = match options.get(0).and_then(Json::as_object) {
            Some(_) => (options.object(0).array("enforce").iter())
                .map(|it| {
                    let it = Object::of(Some(it));
                    Configure {
                        is_always: it.str("blankLine") != Some("never"),
                        prev: MemberType::of(it.str("prev")),
                        next: MemberType::of(it.str("next")),
                    }
                })
                .collect(),
            None => vec![Configure {
                is_always: options.str(0) != Some("never"),
                prev: MemberType::Any,
                next: MemberType::Any,
            }],
        };
        LinesBetweenClassMembers {
            configure_list,
            except_after_single_line: options.object(1).bool_or("exceptAfterSingleLine", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.classes(|rule, class, cx| {
            let mut members = class.members().iter();
            let Some(mut current) = members.next() else {
                return;
            };
            for next in members {
                rule.check_pair(current, next, cx);
                current = next;
            }
        });
    }
}
