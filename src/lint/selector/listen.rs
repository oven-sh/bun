//! Listening for the nodes that selectors can match, and the order in which ESLint comes to them.

use super::EsNode;
use crate::ast::{ExprTag, Node, PatTag, StmtTag, TypeTag};
use crate::context::Cx;
use crate::estree::VNode;
use crate::rule::{Listeners, NodeTags, Rule};
use smallvec::SmallVec;
use std::cmp::{Ordering, Reverse};

/// A rule that is called with nodes of any kind.
pub trait OnNode: Rule {
    fn on_node<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>);
}

const EXPR_TAGS: [ExprTag; ExprTag::COUNT] = {
    use ExprTag::*;
    [
        Missing,
        Ident,
        PrivateIdentifier,
        This,
        Super,
        Null,
        True,
        False,
        Number,
        String,
        BigInt,
        Regex,
        Template,
        TaggedTemplate,
        Array,
        Object,
        Fn,
        Class,
        Dot,
        Index,
        Call,
        New,
        Unary,
        Binary,
        Assign,
        Cond,
        Spread,
        Await,
        Yield,
        As,
        Satisfies,
        AsConst,
        NonNull,
        Instantiation,
        Jsx,
        ImportCall,
        ImportMeta,
        NewTarget,
    ]
};

/// Has [`OnNode::on_node`] called with every node of the kinds `tags`, **in no particular order**: without the sorting that
/// [`Listeners::enter`] takes. See [`sort_as_called`].
pub fn listen<'a, R: OnNode>(on: &mut Listeners<'a, R>, tags: NodeTags) {
    let has = |it: NodeTags| tags.union(it) == tags;
    on.exprs(
        EXPR_TAGS.into_iter().filter(|it| has((*it).into())),
        |rule, it, cx| rule.on_node(it.into(), cx),
    );
    on.stmts(
        StmtTag::ALL.into_iter().filter(|it| has((*it).into())),
        |rule, it, cx| rule.on_node(it.into(), cx),
    );
    on.types(
        TypeTag::ALL.into_iter().filter(|it| has((*it).into())),
        |rule, it, cx| rule.on_node(it.into(), cx),
    );
    if has(NodeTags::PAT) {
        on.pats(PatTag::ALL, |rule, it, cx| rule.on_node(it.into(), cx));
    }
    macro_rules! sorts {
        ($($tags:ident $method:ident;)*) => {
            $(if has(NodeTags::$tags) {
                on.$method(|rule, it, cx| rule.on_node(it.into(), cx));
            })*
        };
    }
    sorts! {
        FUNC funcs;
        CLASS classes;
        MEMBER members;
        PROP props;
        PARAM params;
        TYPE_PARAM type_params;
        VAR_DECL var_decls;
        CASE cases;
        ENUM_MEMBER enum_members;
        IMPORT_SPEC import_specs;
        EXPORT_SPEC export_specs;
    }
    // There is no other listener for these.
    let rest = [
        NodeTags::FILE,
        NodeTags::TUPLE_ELEM,
        NodeTags::PAT_PROP,
        NodeTags::PAT_ELEM,
    ];
    let rest = rest
        .into_iter()
        .filter(|it| has(*it))
        .fold(NodeTags::EMPTY, NodeTags::union);
    if rest != NodeTags::EMPTY {
        on.enter(rest, |rule, it, cx| rule.on_node(it, cx));
    }
}

/// Where `a` is in the tree, seen from `b`.
enum Relation {
    Same,
    Above,
    Below,
    Before,
    After,
}

fn relation<'a>(a: VNode<'a>, b: VNode<'a>) -> Relation {
    if a == b {
        return Relation::Same;
    }
    let from_a: SmallVec<[VNode<'a>; 32]> =
        std::iter::successors(Some(a), |it| it.parent()).collect();
    let mut below: Option<VNode<'a>> = None;
    for at in std::iter::successors(Some(b), |it| it.parent()) {
        let Some(i) = from_a.iter().position(|it| *it == at) else {
            below = Some(at);
            continue;
        };
        // `at` is the innermost node that both are in.
        let (Some(towards_a), Some(towards_b)) =
            (i.checked_sub(1).and_then(|i| from_a.get(i)), below)
        else {
            return if i == 0 {
                Relation::Above
            } else {
                Relation::Below
            };
        };
        let mut first = None;
        at.for_each_child(|it| {
            if first.is_none() && (it == *towards_a || it == towards_b) {
                first = Some(it);
            }
        });
        return if first == Some(towards_b) {
            Relation::After
        } else {
            Relation::Before
        };
    }
    Relation::Same
}

/// Sorts what listeners have found in no particular order the way the reports of ESLint are sorted, if each listener reports
/// what it is called with.
///
/// An element of `matches` is a node and the index of the selector that it matches, in a list that [`Selector::compare`] sorts.
/// `is_exit`: [`Selector::is_exit`] of the selector at an index.
///
/// Reports are sorted by where they start anyway. What this adds is the order of those for the same range: `a` is a `Program`, an
/// `ExpressionStatement` and an `Identifier`.
///
/// [`Selector::compare`]: super::Selector::compare
/// [`Selector::is_exit`]: super::Selector::is_exit
pub fn sort_as_called(matches: &mut [(EsNode<'_>, usize)], is_exit: impl Fn(usize) -> bool) {
    crate::utils::sort::sort_by_cached_key(matches, |it| {
        let span = it.0.span();
        (span.start, Reverse(span.end))
    });
    for same in matches
        .chunk_by_mut(|a, b| a.0.span() == b.0.span())
        .filter(|it| it.len() > 1)
    {
        crate::utils::sort::sort_by(same, |a, b| {
            match (relation(a.0.node, b.0.node), is_exit(a.1), is_exit(b.1)) {
                (Relation::Same, a_is_exit, b_is_exit) => {
                    a_is_exit.cmp(&b_is_exit).then(a.1.cmp(&b.1))
                }
                (Relation::Above, false, _)
                | (Relation::Below, _, true)
                | (Relation::Before, ..) => Ordering::Less,
                (Relation::Above, true, _)
                | (Relation::Below, _, false)
                | (Relation::After, ..) => Ordering::Greater,
            }
        });
        // For espree both names of `import { a }` are one node, which is visited twice: all the listeners are called for the
        // first visit, then all for the second.
        for visits in same.chunk_by_mut(|a, b| a.0 == b.0) {
            let mut visit = 0;
            let numbered = (0..visits.len()).map(|i| {
                visit = if i > 0 && visits[i].1 == visits[i - 1].1 {
                    visit + 1
                } else {
                    0
                };
                (visit, visits[i])
            });
            let mut numbered: SmallVec<[(u32, (EsNode<'_>, usize)); 8]> = numbered.collect();
            if numbered.iter().any(|it| it.0 > 0) {
                crate::utils::sort::sort_by_key(&mut numbered, |it| it.0);
                visits
                    .iter_mut()
                    .zip(numbered)
                    .for_each(|(to, from)| *to = from.1);
            }
        }
    }
}
