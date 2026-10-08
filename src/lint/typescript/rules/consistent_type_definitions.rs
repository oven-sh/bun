use bun_lint::prelude::*;

/// Enforce type definitions to consistently use either `interface` or `type`.
pub struct ConsistentTypeDefinitions {
    prefers_type: bool,
}

const INTERFACE_OVER_TYPE: Message =
    Message::new("interfaceOverType", "Use an `interface` instead of a `type`.");
const TYPE_OVER_INTERFACE: Message =
    Message::new("typeOverInterface", "Use a `type` instead of an `interface`.");

fn is_within_declare_global(statement: Stmt) -> bool {
    Node::Stmt(statement).ancestors().any(|ancestor| match ancestor {
        Node::Stmt(outer) => match outer.kind() {
            StmtKind::Module(module) => {
                matches!(module.name(), ModuleName::Global) && outer.flags().contains(Flags::AMBIENT)
            }
            _ => false,
        },
        _ => false,
    })
}

fn fix_type_alias<'a>(fixer: Fixer<'a>, statement: Stmt<'a>, alias: Alias<'a>) -> Option<Vec<Fix>> {
    let (file, ty) = (fixer.file(), alias.ty().span());
    let type_token = file.tokens_before(alias.name()).find(|token| token.is("type"))?;
    let equals_token = file.tokens_before(ty).find(|token| token.is("="))?;
    let before_equals_token = file.tokens_before(equals_token).with_comments().next()?;
    Some(vec![
        fixer.replace(type_token, "interface"),
        fixer.replace(Span::new(before_equals_token.end(), ty.start), " "),
        fixer.remove(Span::new(ty.end, statement.span().end)),
    ])
}

fn fix_interface<'a>(fixer: Fixer<'a>, statement: Stmt<'a>, interface: Interface<'a>) -> Vec<Fix> {
    let (file, name, body) = (fixer.file(), interface.name(), interface.body_span());
    let head_end = interface.type_params().angle_brackets_span().map_or(name.span().end, |it| it.end);
    let mut fixes = Vec::new();
    if let Some(first_token) = file.token_before(name) {
        fixes.push(fixer.replace(first_token, "type"));
        fixes.push(fixer.replace(Span::new(head_end, body.start), " = "));
    }
    for heritage in interface.extends() {
        fixes.push(fixer.insert_after(body, [&b" & "[..], heritage.text()].concat()));
    }
    if statement.is_default_export()
        && let Some(export) = statement.export_span()
    {
        fixes.push(fixer.remove(Span::new(export.start, statement.span_without_export().start)));
        fixes.push(fixer.insert_after(body, [&b"\nexport default "[..], name.bytes()].concat()));
    }
    fixes
}

impl Rule for ConsistentTypeDefinitions {
    const META: Meta = Meta::typescript("consistent-type-definitions", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ConsistentTypeDefinitions {
            prefers_type: options.str(0) == Some("type"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.prefers_type {
            on.stmts([StmtTag::Interface], |_, statement, cx| {
                let StmtKind::Interface(interface) = statement.kind() else {
                    return;
                };
                let report = cx.report(interface.name(), TYPE_OVER_INTERFACE);
                if !is_within_declare_global(statement) {
                    report.fix(|fixer| fix_interface(fixer, statement, interface));
                }
            });
        } else {
            on.stmts([StmtTag::TypeAlias], |_, statement, cx| {
                if let StmtKind::TypeAlias(alias) = statement.kind()
                    && alias.ty().tag() == TypeTag::Object
                {
                    cx.report(alias.name(), INTERFACE_OVER_TYPE)
                        .fix(|fixer| fix_type_alias(fixer, statement, alias));
                }
            });
        }
    }
}
