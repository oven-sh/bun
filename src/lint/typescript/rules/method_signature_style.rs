use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::for_each_child_estree;
use rustc_hash::FxHashMap;

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

/// What upstream's `getMethodKey` makes one string of: `key`, `[key]`, `key?`, `[key]?`.
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
    // Without a return type it is implicitly `any`.
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

/// The methods and accessors of an interface or a type literal with many members, by their keys.
type Overloads<'a> = FxHashMap<MethodKey<'a>, Vec<Member<'a>>>;

/// The members of the interface or the type literal that `member` is in.
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
        cx.report(member, ERROR_METHOD).fix(|fixer| {
            if return_type_references_this_type(func) || is_node_parent_module_declaration(member) {
                return None;
            }
            // An accessor is a `TSMethodSignature` too.
            let key_of_method = |it: &Member<'a>| {
                MethodKey::of(*it).filter(|_| matches!(it.kind(), MemberKind::Method | MemberKind::Getter | MemberKind::Setter))
            };
            let siblings = siblings(member)?;
            let few: Vec<Member<'a>>;
            let overloads: &[Member<'a>] = if siblings.len() <= 16 {
                few = siblings.iter().filter(|it| key_of_method(it) == Some(key)).collect();
                &few
            } else {
                let by_key = cx.state.entry(member.parent()).or_insert_with(|| {
                    let mut by_key = Overloads::default();
                    for sibling in siblings {
                        if let Some(key) = key_of_method(&sibling) {
                            by_key.entry(key).or_default().push(sibling);
                        }
                    }
                    by_key
                });
                by_key.get(&key)?
            };
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
            fixer.replace(member, text)
        };
        let report = cx.report(member, ERROR_PROPERTY);
        // A method cannot be `readonly`, so the change is not safe.
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
    /// By the interface or the type literal.
    type State<'a> = FxHashMap<Node<'a>, Overloads<'a>>;

    fn new(options: &Options) -> Self {
        MethodSignatureStyle {
            is_method: options.str(0) == Some("method"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        if self.is_method {
            on.members(Self::check_property);
        } else {
            on.members(Self::check_method);
        }
        FxHashMap::default()
    }
}
