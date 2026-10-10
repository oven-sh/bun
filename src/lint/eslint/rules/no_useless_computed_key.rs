use bun_lint::prelude::*;

/// Disallow unnecessary computed property keys in objects and classes.
pub struct NoUselessComputedKey {
    enforces_for_class_members: bool,
}

const UNNECESSARILY_COMPUTED_PROPERTY: Message = Message::new(
    "unnecessarilyComputedProperty",
    "Unnecessarily computed property [{{property}}] found.",
);

enum Literal<'a> {
    String(Name<'a>),
    Number,
}

impl Literal<'_> {
    fn is_any(&self, names: &[&str]) -> bool {
        match self {
            Literal::String(value) => value.is_any(names),
            Literal::Number => false,
        }
    }
}

/// What is in the brackets of `key`, if that is a string or a number literal.
fn computed_literal<'a>(key: Option<Key<'a>>, file: &File<'a>) -> Option<(Key<'a>, Literal<'a>)> {
    let key = key?;
    let literal = match key.kind() {
        KeyKind::ComputedString(value) => {
            let start = key.inner_span(file).start;
            if file.text().get(start as usize) == Some(&b'`') {
                return None;
            }
            Literal::String(value)
        }
        KeyKind::ComputedNumber(_) => Literal::Number,
        // In parentheses.
        KeyKind::Computed(e) => match e.kind() {
            ExprKind::String(value) => Literal::String(value),
            ExprKind::Number(_) => Literal::Number,
            _ => return None,
        },
        _ => return None,
    };
    Some((key, literal))
}

impl NoUselessComputedKey {
    fn report<'a>(node: Node<'a>, key: Key<'a>, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let (brackets, literal) = (key.span(file), key.inner_span(file));
        // Of a property of an object or a class, oxlint points at what is in the brackets.
        let is_property = match node {
            Node::Prop(_) => true,
            Node::Member(member) => member.kind() == MemberKind::Property,
            _ => false,
        };
        let place = match key.kind() {
            _ if !(is_property && cx.language().is_oxlint) => node.span(),
            KeyKind::Computed(e) => e.outer_span(),
            _ => literal,
        };
        cx.report(place, UNNECESSARILY_COMPUTED_PROPERTY)
            .data("property", file.slice(literal))
            .fix(|fixer| {
                let left = Span::new(brackets.start, brackets.start + 1);
                let right = Span::new(brackets.end - 1, brackets.end);
                if file.comments_exist_between(left, right) {
                    return None;
                }
                // `get[2]() {}` must not become `get2() {}`.
                let before = file.token_before(left)?;
                let needs_space_before_key = before.end() == left.start
                    && !ast_utils::can_tokens_be_adjacent(before, file.first_token(literal)?);
                let raw = file.slice(literal);
                Some(match needs_space_before_key {
                    true => fixer.replace(brackets, [&b" "[..], raw].concat()),
                    false => fixer.replace(brackets, raw),
                })
            });
    }
}

impl Rule for NoUselessComputedKey {
    const META: Meta = Meta::eslint("no-useless-computed-key", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().props().pats(&[PatTag::Object]).members();
    no_state!();

    fn new(options: &Options) -> Self {
        NoUselessComputedKey {
            enforces_for_class_members: options.object(0).bool_or("enforceForClassMembers", true),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new().props().pats(&[PatTag::Object]);
        if self.enforces_for_class_members {
            on = on.members();
        }
        on
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        let Some((key, literal)) = computed_literal(prop.key(), cx.file()) else {
            return;
        };
        // `{ "__proto__": a }` sets the prototype, unless it is a pattern.
        if literal.is_any(&["__proto__"])
            && !matches!(prop.parent(), Node::Expr(object) if utils::is_assignment_target(object))
        {
            return;
        }
        Self::report(prop.into(), key, cx);
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(props) = pat.kind() else {
            return;
        };
        for prop in props {
            if let Some((key, _)) = computed_literal(prop.key(), cx.file()) {
                Self::report(prop.into(), key, cx);
            }
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let Some((key, literal)) = computed_literal(member.key(), cx.file()) else {
            return;
        };
        // Only `MethodDefinition` and `PropertyDefinition`.
        if member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR) || member.is_signature() {
            return;
        }
        let needs_brackets: &[&str] = match (member.kind() == MemberKind::Property, member.is_static()) {
            (true, true) => &["constructor", "prototype"],
            (true, false) | (false, false) => &["constructor"],
            (false, true) => &["prototype"],
        };
        if !literal.is_any(needs_brackets) {
            Self::report(member.into(), key, cx);
        }
    }
}
