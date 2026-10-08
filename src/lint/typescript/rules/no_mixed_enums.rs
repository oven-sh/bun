use bun_lint::prelude::*;
use bun_lint::types::tsutils::is_type_flag_set;
use bun_lint::types::{SyntaxKind, Type, TypeFlags};

/// Disallow enums from having both number and string members.
pub struct NoMixedEnums;

const MIXED: Message = Message::new("mixed", "Mixing number and string enums can be confusing.");

#[derive(Copy, Clone, PartialEq, Eq)]
enum AllowedType {
    Number,
    String,
    Unknown,
}

/// Whether it is in quotes, and one name of upstream's `getModuleName`.
fn name_part<'a>(module: Module<'a>) -> (bool, &'a [u8]) {
    match module.name() {
        ModuleName::Ident(name) => (false, name.bytes()),
        ModuleName::String(name) => (true, name.bytes()),
        ModuleName::Global => (false, &b"global"[..]),
    }
}

/// `getModuleName(a.id) === getModuleName(b.id)`
fn have_same_module_name<'a>(a: Module<'a>, b: Module<'a>) -> bool {
    let (mut a, mut b) = (Some(a), Some(b));
    loop {
        match (a, b) {
            (None, None) => return true,
            (Some(left), Some(right)) if name_part(left) == name_part(right) => {
                a = left.nested();
                b = right.nested();
            }
            _ => return false,
        }
    }
}

/// `getEnclosingScopes(node).some(visit)`, for the statement of an enum or a namespace.
fn any_enclosing_scope<'a>(declaration: Stmt<'a>, visit: &mut dyn FnMut(Scope<'a>) -> bool) -> bool {
    let Some(enclosing) = Node::Stmt(declaration).scope().parent() else {
        return false;
    };
    if !declaration.is_exported() {
        return visit(enclosing);
    }
    // `getMergedScopes`
    let Node::Stmt(block) = enclosing.node() else {
        return visit(enclosing);
    };
    let StmtKind::Module(module) = block.kind() else {
        return visit(enclosing);
    };
    any_enclosing_scope(block, &mut |outer| {
        outer.children().any(|child| match child.node() {
            Node::Stmt(it) => {
                matches!(it.kind(), StmtKind::Module(other) if have_same_module_name(module, other)) && visit(child)
            }
            _ => false,
        })
    })
}

fn get_allowed_type(ty: Type) -> AllowedType {
    if ty.is_unresolved() {
        return AllowedType::Unknown;
    }
    match is_type_flag_set(ty, TypeFlags::STRING_LIKE) {
        true => AllowedType::String,
        false => AllowedType::Number,
    }
}

fn get_type_from_imported<'a>(file: &'a File<'a>, imported: Declaration<'a>) -> Option<AllowedType> {
    let types = file.type_checker();
    let ty = match imported {
        Declaration::ImportSpec(it) => it.type_at_location(),
        Declaration::ImportEquals(it) => it.type_at_location(),
        Declaration::ImportDefault(it) => types.get_type_at_location(it.default()?),
        Declaration::ImportNamespace(it) => types.get_type_at_location(it.namespace()?),
        _ => return None,
    };
    let value_declaration = ty.get_symbol()?.value_declaration()?;
    if value_declaration.kind() != SyntaxKind::EnumDeclaration {
        return None;
    }
    let first = value_declaration.children().find(|it| it.kind() == SyntaxKind::EnumMember)?;
    Some(get_allowed_type(first.get_type_at_location()))
}

fn get_member_type(member: EnumMember) -> AllowedType {
    let Some(initializer) = member.init() else {
        return AllowedType::Number;
    };
    match initializer.kind() {
        ExprKind::Number(_) => AllowedType::Number,
        ExprKind::String(_) | ExprKind::Template(_) => AllowedType::String,
        ExprKind::True | ExprKind::False | ExprKind::Null | ExprKind::BigInt(_) | ExprKind::Regex(_) => {
            AllowedType::Unknown
        }
        _ => get_allowed_type(initializer.ty()),
    }
}

fn get_desired_type_for_definition<'a>(file: &'a File<'a>, node: Enum<'a>, first: EnumMember<'a>) -> AllowedType {
    let (statement, name) = (node.stmt(), node.name().name());

    // Merged ambiently via module augmentation.
    for scope in Node::Stmt(statement).scope().chain() {
        let Some(variable) = scope.get_name(name) else {
            continue;
        };
        if let Some(from_imported) = variable.declarations().find_map(|it| get_type_from_imported(file, it)) {
            return from_imported;
        }
    }

    // Several declarations in the file, also across the declarations of a namespace.
    let start = statement.span().start;
    let mut previous_sibling = None;
    any_enclosing_scope(statement, &mut |enclosing| {
        let Some(variable) = enclosing.get_name(name) else {
            return false;
        };
        previous_sibling = variable.declarations().find_map(|definition| match definition {
            Declaration::Enum(it) if it.stmt().span().start < start => it.members().first(),
            _ => None,
        });
        previous_sibling.is_some()
    });
    get_member_type(previous_sibling.unwrap_or(first))
}

impl Rule for NoMixedEnums {
    const META: Meta = Meta::typescript("no-mixed-enums", Kind::Problem)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoMixedEnums
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Enum], |_, statement, cx| {
            let StmtKind::Enum(node) = statement.kind() else {
                return;
            };
            let Some(first) = node.members().first() else {
                return;
            };
            let desired_type = get_desired_type_for_definition(cx.file(), node, first);
            if desired_type == AllowedType::Unknown {
                return;
            }
            for member in node.members() {
                let current_type = get_member_type(member);
                if current_type == AllowedType::Unknown {
                    return;
                }
                if current_type != desired_type {
                    match member.init() {
                        Some(initializer) => cx.report(initializer, MIXED),
                        None => cx.report(member, MIXED),
                    };
                    return;
                }
            }
        });
    }
}
