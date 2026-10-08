use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::is_definition_file;

/// Disallow the declaration of empty interfaces.
pub struct NoEmptyInterface {
    allow_single_extends: bool,
}

const NO_EMPTY: Message = Message::new("noEmpty", "An empty interface is equivalent to `{}`.");
const NO_EMPTY_WITH_SUPER: Message = Message::new(
    "noEmptyWithSuper",
    "An interface declaring no members is equivalent to its supertype.",
);

/// `type I<T> = Super` in place of `interface I<T> extends Super {}`.
fn fix<'a>(fixer: Fixer<'a>, interface: Interface<'a>, extended: TypeNode<'a>) -> Fix {
    let type_params = interface.type_params().angle_brackets_span();
    let text = [
        &b"type "[..],
        fixer.file().slice(interface.name().span()),
        type_params.map_or(&b""[..], |it| fixer.file().slice(it)),
        b" = ",
        extended.text(),
    ]
    .concat();
    fixer.replace(interface.stmt().span_without_export(), text)
}

impl NoEmptyInterface {
    fn check<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Interface(interface) = statement.kind() else {
            return;
        };
        if !interface.members().is_empty() {
            return;
        }
        let extends = interface.extends();
        let Some(extended) = extends.first() else {
            cx.report(interface.name(), NO_EMPTY);
            return;
        };
        if extends.len() != 1 || self.allow_single_extends {
            return;
        }
        let scope = Node::Stmt(statement).scope();
        let is_merged_with_class_declaration = scope.get_name(interface.name().name()).is_some_and(|symbol| {
            symbol
                .declarations()
                .any(|it| matches!(it, Declaration::Class(class) if matches!(class.owner(), Node::Stmt(_))))
        });
        let report = cx.report(interface.name(), NO_EMPTY_WITH_SUPER);
        if is_merged_with_class_declaration {
            return;
        }
        let is_in_ambient_declaration = is_definition_file(cx.path())
            && scope.kind() == ScopeKind::TsModule
            && matches!(scope.node(), Node::Stmt(module) if module.flags().contains(Flags::AMBIENT));
        if is_in_ambient_declaration {
            report.suggest(NO_EMPTY_WITH_SUPER, |fixer| fix(fixer, interface, extended));
        } else {
            report.fix(|fixer| fix(fixer, interface, extended));
        }
    }
}

impl Rule for NoEmptyInterface {
    const META: Meta = Meta::typescript("no-empty-interface", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoEmptyInterface {
            allow_single_extends: options.object(0).bool_or("allowSingleExtends", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Interface], Self::check);
    }
}
