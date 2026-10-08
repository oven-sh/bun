use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::{MemberName, MemberNameType, get_name_from_member};
use smallvec::SmallVec;
use std::borrow::Cow;

/// Require that function overload signatures be consecutive.
pub struct AdjacentOverloadSignatures;

const ADJACENT_SIGNATURE: Message = Message::new(
    "adjacentSignature",
    "All {{name}} signatures should be adjacent.",
);

#[derive(PartialEq, Eq)]
struct Method<'a> {
    name: MemberName<'a>,
    /// `None` for a call or a construct signature, which is never the same as a method.
    is_static: Option<bool>,
    is_call_signature: bool,
}

fn get_member_method(member: Member<'_>) -> Option<Method<'_>> {
    let signature = |name: &'static [u8], is_call_signature| Method {
        name: MemberName {
            name: Cow::Borrowed(name),
            kind: MemberNameType::Normal,
        },
        is_static: None,
        is_call_signature,
    };
    match member.kind() {
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor
            if !member.flags().contains(Flags::ABSTRACT) =>
        {
            Some(Method {
                name: get_name_from_member(member),
                is_static: Some(member.is_static()),
                is_call_signature: false,
            })
        }
        MemberKind::CallSignature => Some(signature(b"call", true)),
        MemberKind::ConstructSignature => Some(signature(b"new", false)),
        _ => None,
    }
}

/// Calls `report` with each of `members` whose method was seen before, but not just before.
fn check_body_for_overload_methods<'a, T: Handle<'a>, M: PartialEq>(
    members: List<'a, T>,
    get_member_method: impl Fn(T) -> Option<M>,
    report: impl Fn(T, &M),
) {
    if members.len() < 3 {
        return;
    }
    let mut seen_methods: SmallVec<[M; 8]> = SmallVec::new();
    // Where it is in `seen_methods`.
    let mut last_method = None;
    for member in members {
        let Some(method) = get_member_method(member) else {
            last_method = None;
            continue;
        };
        let index = seen_methods.iter().position(|seen| *seen == method);
        match index {
            Some(_) if index != last_method => report(member, &method),
            Some(_) => {}
            None => seen_methods.push(method),
        }
        last_method = index.or_else(|| seen_methods.len().checked_sub(1));
    }
}

fn check_statements<'a>(statements: List<'a, Stmt<'a>>, cx: &Cx<'a, AdjacentOverloadSignatures>) {
    check_body_for_overload_methods(
        statements,
        |statement| match statement.kind() {
            StmtKind::Fn(func) => func.name().map(Ident::name),
            _ => None,
        },
        |statement, name| {
            cx.report(statement, ADJACENT_SIGNATURE).data("name", *name);
        },
    );
}

fn check_members<'a>(members: List<'a, Member<'a>>, cx: &Cx<'a, AdjacentOverloadSignatures>) {
    check_body_for_overload_methods(members, get_member_method, |member, method| {
        let prefix: &[u8] = if method.is_static == Some(true) { b"static " } else { b"" };
        cx.report(member, ADJACENT_SIGNATURE).data("name", [prefix, &method.name.name[..]].concat());
    });
}

impl Rule for AdjacentOverloadSignatures {
    const META: Meta = Meta::typescript("adjacent-overload-signatures", Kind::Suggestion)
        .presets(Presets::STYLISTIC);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        AdjacentOverloadSignatures
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.has_stmts([StmtTag::Fn]) {
            on.stmts([StmtTag::Block, StmtTag::Module], |_, statement, cx| match statement.kind() {
                StmtKind::Block(body) => check_statements(body, cx),
                StmtKind::Module(module) => check_statements(module.body(), cx),
                _ => {}
            });
            on.funcs(|_, func, cx| {
                if func.kind() != FnKind::StaticBlock
                    && let Some(body) = func.body_statements()
                {
                    check_statements(body, cx);
                }
            });
            on.finish(|_, cx| check_statements(cx.file().body(), cx));
        }
        on.classes(|_, class, cx| check_members(class.members(), cx));
        on.stmts([StmtTag::Interface], |_, statement, cx| {
            if let StmtKind::Interface(interface) = statement.kind() {
                check_members(interface.members(), cx);
            }
        });
        on.types([TypeTag::Object], |_, ty, cx| {
            if let TypeKind::Object(members) = ty.kind() {
                check_members(members, cx);
            }
        });
    }
}
