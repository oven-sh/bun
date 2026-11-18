use super::*;

/// `(parent, name, text)`, in document order. A name that starts with `@` is an attribute, an empty one is text.
struct Rows(Vec<(usize, &'static str, &'static str)>);

impl Rows {
    fn below(&self, parent: usize, attributes: bool) -> impl DoubleEndedIterator<Item = usize> {
        (1..self.0.len()).filter(move |it| {
            self.0[*it].0 == parent && self.0[*it].1.starts_with('@') == attributes
        })
    }
}

impl Tree for Rows {
    type Node = usize;
    type Name = Text;

    fn kind(&self, node: usize) -> NodeKind {
        match self.0[node].1 {
            _ if node == 0 => NodeKind::Other,
            "" => NodeKind::Text,
            name if name.starts_with('@') => NodeKind::Attribute,
            _ => NodeKind::Element,
        }
    }
    fn parent(&self, node: usize) -> Option<usize> {
        (node > 0).then(|| self.0[node].0)
    }
    fn first_child(&self, node: usize) -> Option<usize> {
        self.below(node, false).next()
    }
    fn last_child(&self, node: usize) -> Option<usize> {
        self.below(node, false).next_back()
    }
    fn next_sibling(&self, node: usize) -> Option<usize> {
        self.below(self.parent(node)?, false)
            .find(|it| *it > node && self.kind(node) != NodeKind::Attribute)
    }
    fn previous_sibling(&self, node: usize) -> Option<usize> {
        self.below(self.parent(node)?, false).rfind(|it| *it < node)
    }
    fn attributes(&self, node: usize) -> impl Iterator<Item = usize> {
        self.below(node, true)
    }
    fn compare_order(&self, a: usize, b: usize) -> core::cmp::Ordering {
        a.cmp(&b)
    }
    fn matches(&self, node: usize, test: &NameTest<Text>) -> bool {
        match test {
            NameTest::Any => true,
            NameTest::Unprefixed { local, .. } => local
                .chars()
                .is(self.0[node].1.trim_start_matches('@').as_bytes()),
            NameTest::InNamespace { .. } => false,
        }
    }
    fn element_by_id(&self, _: usize, id: Chars<'_>) -> Option<usize> {
        self.0
            .iter()
            .find(|it| it.1 == "@id" && id.is(it.2.as_bytes()))
            .map(|it| it.0)
    }
    fn language(&self, node: usize) -> Option<Text> {
        (node == 1).then(|| Chars::from("en-US").into())
    }
    fn push_string_value(&self, node: usize, out: &mut Text) {
        out.push_str(self.0[node].2);
        self.below(node, false)
            .for_each(|it| self.push_string_value(it, out));
    }
    fn push_local_name(&self, node: usize, out: &mut Text) {
        out.push_str(self.0[node].1.trim_start_matches('@'));
    }
    fn push_qualified_name(&self, node: usize, out: &mut Text) {
        self.push_local_name(node, out);
    }
    fn push_namespace(&self, _: usize, _: &mut Text) {}
}

struct NoPrefixes;

impl Names for NoPrefixes {
    type Name = Text;
    fn intern(&mut self, name: Chars<'_>) -> Text {
        name.into()
    }
    fn resolve(&mut self, _: Chars<'_>) -> Option<Text> {
        None
    }
}

fn run(rows: &Rows, source: &str) -> String {
    let expression = match parse(source.into(), &mut NoPrefixes) {
        Ok(expression) => expression,
        Err(ParseError::Syntax) => return "syntax".into(),
        Err(ParseError::Namespace) => return "namespace".into(),
    };
    match evaluate(rows, &expression, 1) {
        Ok(Value::Nodes(nodes)) => format!("{nodes:?}"),
        Ok(value) => value
            .into_text(rows)
            .chars()
            .units()
            .map(|it| char::from(it as u8))
            .collect(),
        Err(NotNodes) => "type".into(),
    }
}

#[test]
fn expressions() {
    let rows = Rows(vec![
        (0, "", ""),
        (0, "r", ""),
        (1, "a", ""),
        (2, "@id", "x"),
        (2, "@n", "2"),
        (2, "b", ""),
        (5, "", " one  two "),
        (2, "b", ""),
        (7, "a", ""),
        (8, "b", ""),
        (9, "", "3"),
        (1, "div", ""),
        (11, "@id", "y"),
    ]);
    for (source, expected) in [
        ("/", "[0]"),
        ("//b", "[5, 7, 9]"),
        ("//b[1]", "[5, 9]"),
        ("(//b)[last()]", "[9]"),
        ("//a/b", "[5, 7, 9]"),
        ("//a//b", "[5, 7, 9]"),
        ("//b/ancestor::*", "[1, 2, 7, 8]"),
        ("//b[.='3']/ancestor::*[1]", "[2, 8]"),
        ("div/preceding::*", "[2, 5, 7, 8, 9]"),
        ("div/preceding::*[1]", "[9]"),
        ("a/@id/following::*[1]", "[5]"),
        ("a/@n/preceding::node()", "[]"),
        ("//@*", "[3, 4, 12]"),
        ("div | a | //@n | a", "[2, 4, 11]"),
        ("id('y x nothing')", "[2, 11]"),
        ("id(//@id)/..", "[1]"),
        ("div div div", "NaN"),
        ("* * *", "NaN"),
        ("6 div 4 * 2 - -1", "4"),
        ("-5 mod 3", "-2"),
        ("1 div 0", "Infinity"),
        ("1 div round(-0.2)", "-Infinity"),
        ("-0", "0"),
        ("1000000000000000000000 * 10", "10000000000000000000000"),
        (".0000001", "0.0000001"),
        ("number(' -1.5 ') + number('1.')", "-0.5"),
        ("number('1e3')", "NaN"),
        ("//b = 3 and //@n < //b", "true"),
        ("//nothing = false()", "true"),
        ("'a' != 'a' or 1 = '1.0'", "true"),
        ("substring('12345', 1.5, 2.6)", "234"),
        ("substring('12345', 0, 3)", "12"),
        ("substring('12345', -1 div 0, 1 div 0)", ""),
        ("substring-after('a/b/c', '/')", "b/c"),
        ("substring-before('a/b/c', 'x')", ""),
        ("translate('--aaa--', 'abc-', 'ABC')", "AAA"),
        ("normalize-space(a/b)", "one two"),
        (
            "concat(name(), count(//*), sum(//@n), string-length('abc'))",
            "r723",
        ),
        ("a[lang('EN')] and not(lang('e'))", "true"),
        ("count(1)", "type"),
        ("1 | a", "type"),
        ("p:a", "namespace"),
        ("$a", "syntax"),
        ("a b", "syntax"),
        ("concat(1,)", "syntax"),
        ("true(1)", "syntax"),
        ("//", "syntax"),
        ("'a", "syntax"),
        ("", "syntax"),
    ] {
        assert_eq!(run(&rows, source), expected, "{source}");
    }
    assert_eq!(
        run(&rows, &("(".repeat(300) + "1" + &")".repeat(300))),
        "syntax"
    );
    assert_eq!(run(&rows, &("1+".repeat(100_000) + "1")), "100001");
}

#[test]
fn many_nodes_are_put_in_order() {
    let mut rows = vec![(0, "", ""), (0, "r", "")];
    for _ in 0..40 {
        let parent = rows.len();
        rows.extend([(1, "a", ""), (parent, "@n", ""), (parent, "b", "")]);
    }
    let all: Vec<usize> = (1..rows.len()).collect();
    assert_eq!(
        run(&Rows(rows), "//b | //@n | //b/ancestor::*"),
        format!("{all:?}")
    );
}
