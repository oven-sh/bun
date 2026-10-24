use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::for_each_child_estree;
use bun_lint::utils::visible::is_only_declaration;

/// Enforce using a particular method signature syntax.
pub struct MethodSignatureStyle {
    is_method: bool,
}

const CONVERT_TO_METHOD_SIGNATURE: Message = Message::new(
    "convertToMethodSignature",
    "Convert to a method signature. This removes the `readonly` modifier, allowing the member to be reassigned.",
);
const ERROR_METHOD: Message = Message::new(
    "errorMethod",
    "Shorthand method signature is forbidden. Use a function property instead.",
);
const ERROR_PROPERTY: Message = Message::new(
    "errorProperty",
    "Function property signature is forbidden. Use a method shorthand instead.",
);

/// The parts that upstream's `getMethodKey` joins into one string: `key`, `[key]`, `key?`, `[key]?`.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub struct MethodKey<'a> {
    text: &'a [u8],
    is_computed: bool,
    is_optional: bool,
}

impl<'a> MethodKey<'a> {
    fn of(member: Member<'a>) -> Option<Self> {
        let key = member.key()?;
        Some(MethodKey {
            text: member.file().slice(key.inner_span(member.file())),
            is_computed: key.is_computed(),
            is_optional: member.flags().contains(Flags::OPTIONAL),
        })
    }

    fn append_to(self, out: &mut Vec<u8>) {
        if self.is_computed {
            out.push(b'[');
        }
        out.extend_from_slice(self.text);
        if self.is_computed {
            out.push(b']');
        }
        if self.is_optional {
            out.push(b'?');
        }
    }
}

/// Upstream's `getMethodParams`, `separator` and `getMethodReturnType`.
fn append_signature(func: Func, separator: &[u8], out: &mut Vec<u8>) {
    let file = func.file();
    if let Some(type_params) = func.type_params().angle_brackets_span() {
        out.extend_from_slice(file.slice(type_params));
    }
    let has_params = func.params_with_this().next().is_some();
    out.extend_from_slice(match func.params_span().filter(|_| has_params) {
        Some(params) => file.slice(params),
        None => &b"()"[..],
    });
    out.extend_from_slice(separator);
    // A missing return type is implicitly `any`.
    out.extend_from_slice(func.return_type().map_or(&b"any"[..], TypeNode::text));
}

fn get_delimiter(member: Member) -> &'static [u8] {
    match member.text() {
        [.., b';'] => b";",
        [.., b','] => b",",
        _ => b"",
    }
}

fn is_node_parent_module_declaration(member: Member) -> bool {
    Node::Member(member)
        .ancestors()
        .any(|it| matches!(it, Node::Stmt(statement) if statement.tag() == StmtTag::Module))
}

fn return_type_references_this_type(func: Func) -> bool {
    let is_this_type = |node: Node| match node {
        Node::Type(ty) => match ty.kind() {
            TypeKind::Keyword(Keyword::This) => Some(()),
            TypeKind::Predicate { param, .. } if param.is("this") => Some(()),
            _ => None,
        },
        _ => None,
    };
    func.return_type().is_some_and(|ty| for_each_child_estree(ty, is_this_type).is_some())
}

/// Returns the members of the interface or type literal that contains `member`.
fn siblings<'a>(member: Member<'a>) -> Option<List<'a, Member<'a>>> {
    match member.parent() {
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Interface(interface) => Some(interface.members()),
            _ => None,
        },
        Node::Type(ty) => match ty.kind() {
            TypeKind::Object(members) => Some(members),
            _ => None,
        },
        _ => None,
    }
}

impl MethodSignatureStyle {
    fn check_method<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.kind() != MemberKind::Method || !member.is_signature() {
            return;
        }
        let (Some(func), Some(key)) = (member.func(), MethodKey::of(member)) else {
            return;
        };
        // Another declaration of the interface may overload this method, and two properties with the same name are an
        // error.
        let is_safe = || match member.parent() {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::Interface(interface) => is_only_declaration(interface),
                _ => true,
            },
            _ => true,
        };
        cx.report(member, ERROR_METHOD).fix_where_safe(is_safe, |fixer| {
            if return_type_references_this_type(func) || is_node_parent_module_declaration(member) {
                return None;
            }
            // An accessor is a `TSMethodSignature` too.
            let key_of_method = |it: &Member<'a>| {
                MethodKey::of(*it).filter(|_| matches!(it.kind(), MemberKind::Method | MemberKind::Getter | MemberKind::Setter))
            };
            let overloads: Vec<Member<'a>> = siblings(member)?.iter().filter(|it| key_of_method(it) == Some(key)).collect();
            let mut text = Vec::new();
            key.append_to(&mut text);
            text.extend_from_slice(b": ");
            let mut fixes = Vec::with_capacity(overloads.len());
            if overloads.len() <= 1 {
                append_signature(func, b" => ", &mut text);
            } else {
                for (i, overload) in overloads.iter().enumerate() {
                    if i > 0 {
                        text.extend_from_slice(b" & ");
                    }
                    text.push(b'(');
                    append_signature(overload.func()?, b" => ", &mut text);
                    text.push(b')');
                    if *overload != member {
                        let whole = overload.span();
                        let next_token = skip_trivia(fixer.file().text(), whole.end);
                        fixes.push(fixer.remove(Span::new(whole.start, next_token)));
                    }
                }
            }
            text.extend_from_slice(get_delimiter(member));
            // Don't fix if there are comments in or between the overloads. A comment left behind would look like it
            // describes the next member.
            let end = fixes.iter().map(|it| it.span.end).fold(overloads.last()?.span().end, u32::max);
            let all = Span::new(overloads.first()?.span().start, end);
            if !fixer.keeps_comments(&fixer.replace(all, &text[..])) {
                return None;
            }
            fixes.push(fixer.replace(member, text));
            Some(fixes)
        });
    }

    fn check_property<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.kind() != MemberKind::Property || !member.is_signature() {
            return;
        }
        let Some(TypeKind::Fn(func)) = member.ty().map(TypeNode::kind) else {
            return;
        };
        if func.kind() != FnKind::FunctionType {
            return;
        }
        let Some(key) = MethodKey::of(member) else {
            return;
        };
        let fix = |fixer: Fixer<'a>| {
            let mut text = Vec::new();
            key.append_to(&mut text);
            append_signature(func, b": ", &mut text);
            text.extend_from_slice(get_delimiter(member));
            Some(fixer.replace(member, text)).filter(|it| fixer.keeps_comments(it))
        };
        let report = cx.report(member, ERROR_PROPERTY);
        // A method can't be `readonly`, so the change isn't safe.
        if member.flags().contains(Flags::READONLY) {
            report.suggest(CONVERT_TO_METHOD_SIGNATURE, fix);
        } else {
            report.fix(fix);
        }
    }
}

impl Rule for MethodSignatureStyle {
    const META: Meta = Meta::typescript("method-signature-style", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions();
    const ON: On = On::new().members();
    no_state!();

    fn new(options: &Options) -> Self {
        MethodSignatureStyle {
            is_method: options.str(0) == Some("method"),
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if self.is_method {
            self.check_property(member, cx);
        } else {
            self.check_method(member, cx);
        }
    }
}
