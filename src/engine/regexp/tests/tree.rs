mod support;

use bun_engine_regexp::Pattern;
use bun_engine_regexp::tree::{Node, NodeId, Tree, UNBOUNDED};
use support::{flags, in_each_width};

fn character(c: u32) -> String {
    match char::from_u32(c) {
        Some(c @ ' '..='~') => c.into(),
        _ => format!("<{c:x}>"),
    }
}

fn show(tree: &Tree, id: NodeId) -> String {
    let list = |children: &[NodeId], separator| {
        let shown: Vec<_> = children.iter().map(|&child| show(tree, child)).collect();
        format!("({})", shown.join(separator))
    };
    let mark = |is_set: bool, mark: &'static str| if is_set { mark } else { "" };
    match tree[id] {
        Node::Empty => "_".into(),
        Node::Text { chars, ignore_case } => {
            let text: String = tree[chars].iter().map(|&c| character(c)).collect();
            format!("'{text}'{}", mark(ignore_case, "i"))
        }
        Node::Set(set) => {
            let ranges = tree[set].ranges().map(|it| match it.last - it.first {
                0 => character(it.first),
                _ => format!("{}-{}", character(it.first), character(it.last)),
            });
            format!("[{}]", ranges.collect::<Vec<_>>().concat())
        }
        Node::Sequence(children) => list(&tree[children], " "),
        Node::Alternation(children) => list(&tree[children], "|"),
        Node::Capture { group, body } => format!("{group}:{}", show(tree, body)),
        Node::Repeat {
            body,
            min,
            max,
            greedy,
            captures,
        } => {
            let max = if max == UNBOUNDED {
                String::new()
            } else {
                max.to_string()
            };
            let captures = match captures.is_empty() {
                true => String::new(),
                false => format!("@{:?}", captures.range()),
            };
            let lazy = mark(!greedy, "?");
            format!("{}{{{min},{max}}}{lazy}{captures}", show(tree, body))
        }
        Node::Look {
            body,
            behind,
            negated,
            ..
        } => {
            let kind = if negated { "!" } else { "=" };
            format!("?{}{kind}{}", mark(behind, "<"), show(tree, body))
        }
        Node::BackReference {
            groups,
            ignore_case,
        } => format!("\\{:?}{}", &tree[groups], mark(ignore_case, "i")),
        Node::InputStart => "^".into(),
        Node::InputEnd => "$".into(),
        Node::LineStart => "^m".into(),
        Node::LineEnd => "$m".into(),
        Node::WordBoundary {
            negated,
            unicode_ignore_case,
        } => {
            let letter = if negated { "B" } else { "b" };
            format!("\\{letter}{}", mark(unicode_ignore_case, "i"))
        }
    }
}

fn reachable(tree: &Tree, id: NodeId) -> usize {
    1 + match tree[id] {
        Node::Sequence(children) | Node::Alternation(children) => {
            tree[children].iter().map(|&it| reachable(tree, it)).sum()
        }
        Node::Capture { body, .. } | Node::Repeat { body, .. } | Node::Look { body, .. } => {
            reachable(tree, body)
        }
        _ => 0,
    }
}

fn check(cases: &[(&str, &str, &str)]) {
    for &(source, letters, expected) in cases {
        in_each_width(source, |text| {
            let pattern = Pattern::new(text, flags(letters)).unwrap();
            let tree = pattern.tree();
            assert_eq!(show(tree, tree.root()), expected, "/{source}/{letters}");
            assert_eq!(reachable(tree, tree.root()), tree.node_count());
        });
    }
}

#[test]
fn terms() {
    check(&[
        ("", "", "_"),
        ("abc", "", "'abc'"),
        ("abc*d", "", "('ab' 'c'{0,} 'd')"),
        ("a|", "", "('a'|_)"),
        ("a(?:b)c(?:)[d]\\.", "", "'abcd.'"),
        ("a(?:b*c)d", "", "('a' 'b'{0,} 'cd')"),
        ("a(?:b|c){1}", "", "('a' ('b'|'c'))"),
        ("(a)((b)|c)+?", "", "(1:'a' 2:(3:'b'|'c'){1,}?@2..4)"),
        ("a{0}b(c){0}(?:)*", "", "'b'"),
        (
            "a{2}?b{2,}c{1,3000000000}",
            "",
            "('a'{2,2} 'b'{2,} 'c'{1,})",
        ),
        ("^$\\b\\B", "", "(^ $ \\b \\B)"),
        ("^$\\b", "miu", "(^m $m \\bi)"),
        ("(?=a)*(?!b)+(?:^){2}", "", "(?!'b' ^)"),
        ("(?<=a)(?<!b)", "", "(?<='a' ?<!'b')"),
        ("😀+", "", "('<d83d>' '<de00>'{1,})"),
        ("😀+", "u", "'<1f600>'{1,}"),
        (
            "\\ud83d\\ude00\\u{d83d}\\ude00",
            "u",
            "'<1f600><d83d><de00>'",
        ),
    ]);
}

#[test]
fn additions_for_web_browsers() {
    check(&[
        ("{a}]x{,1}x{1", "", "'{a}]x{,1}x{1'"),
        ("\\0\\08\\1\\18\\377\\400\\8", "", "'<0><0>8<1><1>8<ff> 08'"),
        ("\\c\\cA\\c1[\\c1][\\c_]", "", "'\\c<1>\\c1<11><1f>'"),
        (
            "\\k<a>\\p{L}\\x1\\u12\\u{2}",
            "",
            "('k<a>p{L}x1u12' 'u'{2,2})",
        ),
        ("[\\d-a][a-\\d][\\b\\B-]", "", "([-0-9a] [-0-9a] [<8>-B])"),
        ("(a)\\2\\1", "", "(1:'a' '<2>' \\[1])"),
    ]);
}

#[test]
fn case_and_modifiers() {
    check(&[
        ("abµ", "i", "'AB<39c>'i"),
        ("ABµ", "iu", "'ab<3bc>'i"),
        ("[Aa][b]", "", "('A'i 'b')"),
        ("[k][^k]", "i", "('K'i [<0>-JL-jl-<10ffff>])"),
        ("[k]", "iu", "[Kk<212a>]"),
        ("a(?i:b)(?-i:c)", "", "('a' 'B'i 'c')"),
        (
            "(?m-s:^.)$.",
            "s",
            "(^m [<0>-<9><b>-<c><e>-<2027><202a>-<10ffff>] $ [<0>-<10ffff>])",
        ),
        ("\\w", "iu", "[0-9A-Z_a-z<17f><212a>]"),
        ("[^\\W]", "iu", "[0-9A-Z_a-z<17f><212a>]"),
        ("[^\\P{ASCII}]", "iu", "[<0>-JL-RT-jl-rt-<7f>]"),
        ("[^\\P{ASCII}]", "iv", "[<0>-<7f><17f><212a>]"),
    ]);
}

#[test]
fn back_references() {
    check(&[
        ("\\1(a\\1)\\1|\\1", "", "((1:'a' \\[1])|_)"),
        ("(?<=\\1(a)\\1)", "", "?<=(\\[1] 1:'a')"),
        ("(?<=(?=\\1)(a))", "u", "?<=(?=\\[1] 1:'a')"),
        ("(a)(?<=\\1)", "i", "(1:'A'i ?<=\\[1]i)"),
        ("\\k<a>(?<a>\\k<a>)\\k<\\u0061>", "", "(1:_ \\[1])"),
        (
            "(?<a>x)\\k<a>|(?:(?<a>y)|(b)(?<a>z))\\k<a>",
            "",
            "((1:'x' \\[1])|((2:'y'|(3:'b' 4:'z')) \\[2, 4]))",
        ),
        ("(?<=\\k<a>(?<a>x))", "", "?<=(\\[1] 1:'x')"),
        ("(?<a>x)(?:\\k<a>){0}\\k<a>", "", "(1:'x' \\[1])"),
    ]);
}

#[test]
fn class_sets() {
    check(&[
        ("[[a-z]--[aeiou]]", "v", "[b-df-hj-np-tv-z]"),
        ("[\\w&&[^\\d]&&\\p{Lu}]", "v", "[A-Z]"),
        ("[a--a]", "v", "[]"),
        ("[\\q{}]", "v", "_"),
        ("[\\q{a|}]", "v", "('a'|_)"),
        ("[\\q{ab}]+", "v", "'ab'{1,}"),
        ("x[\\q{ab}]y", "v", "'xaby'"),
        (
            "[\\q{abc|ab|ad|bd|cd}a-e]",
            "v",
            "(('a' ('d'|('b' ('c'|_))|_))|([b-c] ('d'|_))|[d-e])",
        ),
        ("(?<=[\\q{abc|bc|d}])", "v", "?<=((('a'|_) 'bc')|'d')"),
        ("[\\q{ab|cd}--\\q{AB}]", "iv", "'cd'i"),
        ("[\\q{ab|cd}&&\\q{cd|ef}]", "v", "'cd'"),
        ("[^\\q{ab}&&a]", "v", "[<0>-<10ffff>]"),
        (
            "\\p{Emoji_Keycap_Sequence}",
            "v",
            "([#*0-9] '<fe0f><20e3>')",
        ),
    ]);
}

#[test]
fn group_names() {
    in_each_width("(?<=\\k<b>)(?<a>)(x)(?<b>)|(?<\\u{62}>)(?<$𝒜>)", |text| {
        let pattern = Pattern::new(text, flags("")).unwrap();
        let names = pattern.group_names().iter();
        let names: Vec<_> = names
            .map(|(name, groups)| (name.to_string(), groups))
            .collect();
        let expected: [(String, &[u16]); 3] = [
            ("a".into(), &[1]),
            ("b".into(), &[3, 4]),
            ("$𝒜".into(), &[5]),
        ];
        assert_eq!(names, expected);
        assert_eq!(pattern.group_count(), 5);
    });
}
