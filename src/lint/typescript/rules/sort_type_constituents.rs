use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::type_node_requires_parentheses;
use std::cmp::Ordering;

/// Enforce constituents of a type union/intersection to be sorted alphabetically.
pub struct SortTypeConstituents {
    is_case_sensitive: bool,
    checks_intersections: bool,
    checks_unions: bool,
    /// For each [`Group`], where it is in `groupOrder`. `u32::MAX` if it is not.
    positions: [u32; Group::COUNT],
}

const NOT_SORTED: Message = Message::new("notSorted", "{{type}} type constituents must be sorted.");
const NOT_SORTED_NAMED: Message =
    Message::new("notSortedNamed", "{{type}} type {{name}} constituents must be sorted.");
const SUGGEST_FIX: Message =
    Message::new("suggestFix", "Sort constituents of type (removes all comments).");

#[derive(Copy, Clone)]
enum Group {
    Conditional,
    Function,
    Import,
    Intersection,
    Keyword,
    Nullish,
    Literal,
    Named,
    Object,
    Operator,
    Tuple,
    Union,
}

impl Group {
    const COUNT: usize = 12;

    const DEFAULT_ORDER: [Group; Group::COUNT] = [
        Group::Named,
        Group::Keyword,
        Group::Operator,
        Group::Literal,
        Group::Function,
        Group::Import,
        Group::Conditional,
        Group::Object,
        Group::Tuple,
        Group::Intersection,
        Group::Union,
        Group::Nullish,
    ];

    fn named(name: &[u8]) -> Option<Group> {
        Some(match name {
            b"conditional" => Group::Conditional,
            b"function" => Group::Function,
            b"import" => Group::Import,
            b"intersection" => Group::Intersection,
            b"keyword" => Group::Keyword,
            b"nullish" => Group::Nullish,
            b"literal" => Group::Literal,
            b"named" => Group::Named,
            b"object" => Group::Object,
            b"operator" => Group::Operator,
            b"tuple" => Group::Tuple,
            b"union" => Group::Union,
            _ => return None,
        })
    }

    /// Upstream's `getGroup`.
    fn of(ty: TypeNode) -> Option<Group> {
        Some(match ty.kind() {
            TypeKind::Cond { .. } => Group::Conditional,
            TypeKind::Fn(_) => Group::Function,
            TypeKind::Import { is_typeof: false, .. } => Group::Import,
            TypeKind::Intersection(_) => Group::Intersection,
            TypeKind::Keyword(Keyword::Null | Keyword::Undefined | Keyword::Void) => Group::Nullish,
            TypeKind::Keyword(_) => Group::Keyword,
            TypeKind::StringLit(_)
            | TypeKind::NumberLit(_)
            | TypeKind::BigIntLit { .. }
            | TypeKind::BoolLit(_)
            | TypeKind::Template(_) => Group::Literal,
            TypeKind::Array(_) | TypeKind::IndexedAccess { .. } | TypeKind::Infer(_) | TypeKind::Ref { .. } => {
                Group::Named
            }
            TypeKind::Mapped(_) | TypeKind::Object(_) => Group::Object,
            TypeKind::Keyof(_)
            | TypeKind::Readonly(_)
            | TypeKind::UniqueSymbol
            | TypeKind::Unique(_)
            | TypeKind::Typeof { .. }
            | TypeKind::Import { is_typeof: true, .. } => Group::Operator,
            TypeKind::Tuple(_) => Group::Tuple,
            TypeKind::Union(_) => Group::Union,
            TypeKind::Error | TypeKind::Heritage { .. } | TypeKind::Predicate { .. } => return None,
        })
    }
}

impl SortTypeConstituents {
    fn position(&self, ty: TypeNode) -> u32 {
        Group::of(ty).map_or(u32::MAX, |group| self.positions[group as usize])
    }

    fn compare<'a>(&self, a: TypeNode<'a>, b: TypeNode<'a>) -> Ordering {
        self.position(a).cmp(&self.position(b)).then_with(|| {
            let (a, b) = (a.text(), b.text());
            match self.is_case_sensitive {
                true => strings::order_utf16(a, b),
                false => strings::locale_compare_numeric_base(a, b).then_with(|| strings::order_utf16(a, b)),
            }
        })
    }

    fn check<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let (types, is_intersection) = match ty.kind() {
            TypeKind::Union(types) => (types, false),
            TypeKind::Intersection(types) => (types, true),
            _ => return,
        };
        // A stable sort changes nothing if no constituent is greater than the next.
        if types.iter().zip(types.iter().skip(1)).all(|(a, b)| self.compare(a, b) != Ordering::Greater) {
            return;
        }
        let alias = match ty.parent() {
            Node::Stmt(parent) => match parent.kind() {
                StmtKind::TypeAlias(alias) => Some(alias),
                _ => None,
            },
            _ => None,
        };
        let report = match alias {
            Some(alias) => cx.report(ty, NOT_SORTED_NAMED).data("name", alias.name()),
            None => cx.report(ty, NOT_SORTED),
        }
        .data("type", if is_intersection { "Intersection" } else { "Union" });
        let fix = |fixer: Fixer<'a>| {
            let mut sorted: Vec<TypeNode<'a>> = types.iter().collect();
            utils::sort::sort_by(&mut sorted, |a, b| self.compare(*a, *b));
            let mut replacement = Vec::new();
            for (i, constituent) in sorted.into_iter().enumerate() {
                if i > 0 {
                    replacement.extend_from_slice(if is_intersection { b" & " } else { b" | " });
                }
                let text = constituent.text();
                let needs_parentheses = type_node_requires_parentheses(constituent, text)
                    || is_intersection && constituent.tag() == TypeTag::Union;
                if needs_parentheses {
                    replacement.push(b'(');
                }
                replacement.extend_from_slice(text);
                if needs_parentheses {
                    replacement.push(b')');
                }
            }
            fixer.replace(ty, replacement)
        };
        let file = cx.file();
        let has_comments = types
            .iter()
            .any(|it| file.comments_before(it).len() + file.comments_after(it).len() > 0);
        if has_comments {
            report.suggest(SUGGEST_FIX, fix);
        } else {
            report.fix(fix);
        }
    }
}

impl Rule for SortTypeConstituents {
    const META: Meta = Meta::typescript("sort-type-constituents", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .deprecated();
    const ON: On = On::new().types(&[TypeTag::Intersection, TypeTag::Union]);
    no_state!();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let mut positions = [u32::MAX; Group::COUNT];
        let mut place = |group: Group, at: usize| {
            let position = &mut positions[group as usize];
            *position = (*position).min(at as u32);
        };
        match object.get("groupOrder").and_then(Json::as_array) {
            Some(names) => {
                for (at, name) in names.iter().enumerate() {
                    if let Some(group) = name.as_str().and_then(Group::named) {
                        place(group, at);
                    }
                }
            }
            None => {
                for (at, group) in Group::DEFAULT_ORDER.into_iter().enumerate() {
                    place(group, at);
                }
            }
        }
        SortTypeConstituents {
            is_case_sensitive: object.bool_or("caseSensitive", false),
            checks_intersections: object.bool_or("checkIntersections", true),
            checks_unions: object.bool_or("checkUnions", true),
            positions,
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new();
        if self.checks_intersections {
            on = on.types(&[TypeTag::Intersection]);
        }
        if self.checks_unions {
            on = on.types(&[TypeTag::Union]);
        }
        on
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        self.check(ty, cx);
    }
}
