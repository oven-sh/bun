use bun_core::strings;

use super::*;
use core::fmt::Write;
use std::cell::RefCell;
use std::rc::Rc;

struct Ids;

impl Dom for Ids {
    type Node = usize;
    type Name = Rc<[u16]>;
    type Text = Rc<[u16]>;
    type Stencil = Rc<[Attribute<Ids>]>;
    fn chars_of_name(name: &Rc<[u16]>) -> Chars<'_> {
        Chars::Utf16(name)
    }
    fn chars_of_text(text: &Rc<[u16]>) -> Chars<'_> {
        Chars::Utf16(text)
    }
    fn attributes_of(stencil: &Self::Stencil) -> Vec<Attribute<Ids>> {
        stencil.to_vec()
    }
}

type Remembered = (String, u64, Rc<[Attribute<Ids>]>);

thread_local! {
    static STENCILS: RefCell<Vec<Remembered>> = RefCell::default();
}

enum Data {
    Root,
    Element {
        name: String,
        attributes: Vec<(String, String)>,
        contents: Option<usize>,
    },
    Text(String),
    Markup(String),
}

struct Node {
    data: Data,
    parent: Option<usize>,
    children: Vec<usize>,
}

struct Tree {
    nodes: Vec<Node>,
    quirks: Quirks,
    scripts: Vec<Position>,
}

fn string(chars: Chars<'_>) -> String {
    String::from_utf16_lossy(&chars.units().collect::<Vec<_>>())
}

fn pair(attribute: &Attribute<Ids>) -> (String, String) {
    let prefix = match attribute.namespace {
        AttributeNamespace::None => "",
        AttributeNamespace::XLink => "xlink ",
        AttributeNamespace::Xml => "xml ",
        AttributeNamespace::Xmlns => "xmlns ",
    };
    (
        prefix.to_owned() + &String::from_utf16_lossy(&attribute.name),
        String::from_utf16_lossy(&attribute.value),
    )
}

impl Tree {
    fn new() -> Tree {
        let mut tree = Tree {
            nodes: Vec::new(),
            quirks: Quirks::None,
            scripts: Vec::new(),
        };
        tree.add(Data::Root);
        tree
    }

    fn add(&mut self, data: Data) -> usize {
        self.nodes.push(Node {
            data,
            parent: None,
            children: Vec::new(),
        });
        self.nodes.len() - 1
    }

    fn index(&self, place: &Place<usize>) -> usize {
        let children = &self.nodes[place.parent].children;
        place.before.map_or(children.len(), |before| {
            children.iter().position(|it| *it == before).unwrap()
        })
    }

    fn insert(&mut self, node: usize, place: Place<usize>) {
        let index = self.index(&place);
        self.nodes[place.parent].children.insert(index, node);
        self.nodes[node].parent = Some(place.parent);
    }

    fn dump(&self, parent: usize, depth: usize, out: &mut String) {
        let indent = "  ".repeat(depth);
        for &child in &self.nodes[parent].children {
            match &self.nodes[child].data {
                Data::Root => unreachable!(),
                Data::Text(text) => writeln!(out, "| {indent}\"{text}\"").unwrap(),
                Data::Markup(markup) => writeln!(out, "| {indent}{markup}").unwrap(),
                Data::Element {
                    name,
                    attributes,
                    contents,
                } => {
                    writeln!(out, "| {indent}<{name}>").unwrap();
                    let mut attributes = attributes.clone();
                    attributes.sort();
                    for (name, value) in attributes {
                        writeln!(out, "| {indent}  {name}=\"{value}\"").unwrap();
                    }
                    if let Some(contents) = contents {
                        writeln!(out, "| {indent}  content").unwrap();
                        self.dump(*contents, depth + 2, out);
                    }
                    self.dump(child, depth + 1, out);
                }
            }
        }
    }
}

impl Sink for Tree {
    type Dom = Ids;

    fn name(&mut self, chars: Chars<'_>, short: Option<ShortName>) -> Rc<[u16]> {
        assert!(short.is_none() || short == ShortName::new(chars));
        chars.units().collect()
    }
    fn value(&mut self, _: &Rc<[u16]>, chars: Chars<'_>) -> Rc<[u16]> {
        chars.units().collect()
    }
    fn recall(&mut self, source: TagSource<'_>) -> Option<Rc<[Attribute<Ids>]>> {
        let text = string(source.chars);
        let (_, hash, stencil) =
            STENCILS.with_borrow(|it| it.iter().find(|it| it.0 == text).cloned())?;
        assert_eq!(hash, source.hash);
        Some(stencil)
    }
    fn remember(
        &mut self,
        source: TagSource<'_>,
        _: Tag,
        attributes: &mut Vec<Attribute<Ids>>,
    ) -> Option<Rc<[Attribute<Ids>]>> {
        let stencil: Rc<[_]> = attributes.drain(..).collect();
        STENCILS.with_borrow_mut(|it| {
            it.push((string(source.chars), source.hash, Rc::clone(&stencil)))
        });
        Some(stencil)
    }
    fn document(&self) -> usize {
        0
    }
    fn is_in_quirks_mode(&self) -> bool {
        self.quirks == Quirks::Full
    }
    fn set_quirks(&mut self, quirks: Quirks) {
        self.quirks = quirks;
    }
    fn parent(&self, node: usize) -> Option<usize> {
        self.nodes[node].parent
    }
    fn template_contents(&mut self, node: usize) -> Option<usize> {
        match self.nodes[node].data {
            Data::Element { contents, .. } => contents,
            _ => None,
        }
    }
    fn create_element(&mut self, element: NewElement<'_, Ids>) -> usize {
        element
            .attributes
            .extend(element.stencil.map(Ids::attributes_of).unwrap_or_default());
        let local = match element.name {
            ElementName::Known(tag) => tag.name().to_owned(),
            ElementName::Other(name) => String::from_utf16_lossy(name),
        };
        if local == "script" {
            self.scripts.push(element.position);
        }
        let name = match element.namespace {
            Namespace::Html => local,
            Namespace::Svg => format!("svg {local}"),
            Namespace::MathMl => format!("math {local}"),
        };
        let contents = (name == "template").then(|| self.add(Data::Root));
        self.add(Data::Element {
            name,
            attributes: element.attributes.drain(..).map(|it| pair(&it)).collect(),
            contents,
        })
    }
    fn insert_element(&mut self, node: usize, place: Place<usize>) {
        self.insert(node, place);
    }
    fn runs_script_when_inserted(&self, node: usize) -> bool {
        node.is_multiple_of(3)
    }
    fn insert_text(&mut self, text: Chars<'_>, place: Place<usize>) {
        let previous = self
            .index(&place)
            .checked_sub(1)
            .map(|it| self.nodes[place.parent].children[it]);
        if let Some(Data::Text(data)) = previous.map(|it| &mut self.nodes[it].data) {
            return data.push_str(&string(text));
        }
        let node = self.add(Data::Text(string(text)));
        self.insert(node, place);
    }
    fn insert_comment(&mut self, data: Chars<'_>, place: Place<usize>) {
        let node = self.add(Data::Markup(format!("<!-- {} -->", string(data))));
        self.insert(node, place);
    }
    fn insert_instruction(&mut self, target: Chars<'_>, data: Chars<'_>, place: Place<usize>) {
        let node = self.add(Data::Markup(format!(
            "<?{} {}?>",
            string(target),
            string(data)
        )));
        self.insert(node, place);
    }
    fn insert_doctype(&mut self, name: Chars<'_>, public_id: Chars<'_>, system_id: Chars<'_>) {
        let ids = if public_id.is_empty() && system_id.is_empty() {
            String::new()
        } else {
            format!(" \"{}\" \"{}\"", string(public_id), string(system_id))
        };
        let node = self.add(Data::Markup(format!("<!DOCTYPE {}{ids}>", string(name))));
        self.insert(
            node,
            Place {
                parent: 0,
                before: None,
            },
        );
    }
    fn reparent(&mut self, node: usize, place: Place<usize>) {
        self.remove(node);
        self.insert(node, place);
    }
    fn reparent_children(&mut self, from: usize, to: usize) {
        for child in self.nodes[from].children.clone() {
            self.reparent(
                child,
                Place {
                    parent: to,
                    before: None,
                },
            );
        }
    }
    fn remove(&mut self, node: usize) {
        if let Some(parent) = self.nodes[node].parent.take() {
            self.nodes[parent].children.retain(|it| *it != node);
        }
    }
    fn add_missing_attributes(&mut self, node: usize, more: &mut Vec<Attribute<Ids>>) {
        let Data::Element { attributes, .. } = &mut self.nodes[node].data else {
            return;
        };
        for (name, value) in more.iter().map(pair) {
            if attributes.iter().all(|it| it.0 != name) {
                attributes.push((name, value));
            }
        }
    }
    fn associate_with_form(&mut self, _: usize, _: usize, _: usize) {}
    fn attach_shadow(&mut self, _: usize, _: NewElement<'_, Ids>) -> Option<usize> {
        None
    }
    fn start_patch(&mut self, _: usize, _: Chars<'_>) -> Option<Patch<usize>> {
        None
    }
    fn finished(&mut self, _: usize) {}
    fn mark_script_as_started(&mut self, _: usize) {}
    fn wants_to_pause(&mut self) -> bool {
        false
    }
}

fn options(scripting: bool) -> Options {
    Options {
        scripting,
        allows_declarative_shadow_roots: false,
        allows_patches: false,
        keeps_mode: false,
    }
}

fn run(
    parser: &mut Parser<Ids>,
    tree: &mut Tree,
    mut on_script: impl FnMut(&mut Parser<Ids>, &mut Tree),
) {
    loop {
        match parser.run(tree) {
            Stop::NeedsInput | Stop::Finished => return,
            Stop::Insert(node, place) => tree.insert(node, place),
            Stop::Script(_) => on_script(parser, tree),
            Stop::Paused => {}
        }
    }
}

fn dump(tree: &Tree, root: usize) -> String {
    let mut out = String::new();
    tree.dump(root, 0, &mut out);
    out
}

fn parse_document(source: Chars<'_>, chunk: usize, scripting: bool) -> String {
    let (mut tree, mut parser) = (Tree::new(), Parser::new(options(scripting)));
    for start in (0..source.len()).step_by(chunk) {
        parser.write(source.slice(start..source.len().min(start.saturating_add(chunk))));
        run(&mut parser, &mut tree, |_, _| {});
    }
    parser.end();
    run(&mut parser, &mut tree, |_, _| {});
    dump(&tree, 0)
}

fn cut<'a>(text: &'a str, at: &str) -> Option<(&'a str, &'a str)> {
    let index = strings::index_of(text.as_bytes(), at.as_bytes())?;
    Some((&text[..index], &text[index + at.len()..]))
}

fn parse_in(context: &str, source: Chars<'_>, scripting: bool) -> String {
    let (namespace, name) = match cut(context, " ") {
        Some(("svg", name)) => (Namespace::Svg, name),
        Some((_, name)) => (Namespace::MathMl, name),
        None => (Namespace::Html, context),
    };
    let mut tree = Tree::new();
    let (node, root) = (tree.add(Data::Root), tree.add(Data::Root));
    let tag = Tag::from_name(name.to_ascii_lowercase().as_str().into());
    let context = Context {
        node,
        tag,
        namespace: Some(namespace),
        attributes: Vec::new(),
        form: None,
    };
    parse_fragment(source, &context, root, options(scripting), &mut tree);
    dump(&tree, root)
}

/// In the format of html5lib's tests.
#[test]
fn tree_construction() {
    let mut failures = String::new();
    for case in strings::split(include_bytes!("tests.dat"), b"\n#data\n").skip(1) {
        let case = core::str::from_utf8(case).unwrap();
        let (source, rest) = match case.strip_prefix("#errors\n") {
            Some(rest) => ("", rest),
            None => cut(case, "\n#errors\n").unwrap(),
        };
        let (head, expected) = cut(rest, "#document\n").unwrap();
        let expected = cut(expected, "\n#description\n").map_or(expected, |it| it.0);
        let context = cut(head, "#document-fragment\n").map(|it| cut(it.1, "\n").unwrap().0);
        let scripting = cut(head, "#script-off").is_none();
        let wide: Vec<u16> = source.encode_utf16().collect();
        let narrow: Option<Vec<u8>> = wide.iter().map(|it| u8::try_from(*it).ok()).collect();
        for source in [
            Some(Chars::Utf16(&wide)),
            narrow.as_deref().map(Chars::Latin1),
        ]
        .into_iter()
        .flatten()
        {
            for chunk in [usize::MAX, 1, 3, 7] {
                let actual = match context {
                    Some(context) => parse_in(context, source, scripting),
                    None => parse_document(source, chunk, scripting),
                };
                if actual.trim_end_matches('\n') != expected.trim_end_matches('\n') {
                    failures += &format!(
                        "{:?} in {context:?}, chunks of {chunk}\n{expected}\n{actual}\n",
                        string(source)
                    );
                    break;
                }
            }
        }
    }
    assert!(failures.is_empty(), "{failures}");
}

#[test]
fn what_a_script_writes_comes_before_the_rest() {
    let (mut tree, mut parser) = (Tree::new(), Parser::new(options(true)));
    parser.write("<body>\n<script>1</script>c>\n\n <script>2</script>id=x>y\n<script>".into());
    parser.end();
    let mut writes = [
        "<i>a</i><b",
        "<an-element-with-a-name-that-is-longer-than-all-that-has-been-read-up-to-here ",
    ]
    .iter();
    run(&mut parser, &mut tree, |parser, tree| {
        parser.begin_script();
        parser.write((*writes.next().unwrap()).into());
        run(parser, tree, |_, _| unreachable!());
        parser.end_script();
    });
    let expected = r#"| <html>
|   <head>
|   <body>
|     "
"
|     <script>
|       "1"
|     <i>
|       "a"
|     <bc>
|       "

 "
|       <script>
|         "2"
|       <an-element-with-a-name-that-is-longer-than-all-that-has-been-read-up-to-here>
|         id="x"
|         "y
"
|         <script>
"#;
    assert_eq!(dump(&tree, 0), expected);
    let at = |line, column| Position { line, column };
    assert_eq!(tree.scripts, [at(1, 8), at(3, 9), at(4, 8)]);
}

#[test]
fn what_is_too_deep_becomes_a_sibling() {
    let source = "<div>".repeat(600);
    let tree = parse_in("div", source.as_str().into(), true);
    let deepest = strings::split(tree.as_bytes(), b"\n")
        .map(<[u8]>::len)
        .max();
    assert_eq!(deepest, Some("| <div>".len() + 2 * 511));
}

#[test]
fn how_the_input_is_split_does_not_matter() {
    let extras = [
        " ",
        "x",
        "\0",
        "\r",
        "\n",
        "<",
        "</",
        "</>",
        "<!",
        "<!--",
        "-->",
        "--!>",
        "-",
        ">",
        "&",
        "&amp",
        "&not",
        "in;",
        "&#x4",
        "1;",
        "<?a",
        "?>",
        "<![CDATA[",
        "]]>",
        "<!doctype html",
        "<x-y a=",
        "\"",
        "'",
        "/>",
        "</x-y>",
        "<input type=hidden>",
        "<font color>",
        "<annotation-xml encoding=text/html>",
        "<script",
        "</script",
        "\u{e9}",
        "\u{3b1}",
    ];
    let mut seed = 1u64;
    let mut next = |below: usize| {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (seed >> 33) as usize % below
    };
    for _ in 0..3000 {
        let (mut source, few) = (
            String::new(),
            [(); 6].map(|()| Tag::ALL[1 + next(Tag::ALL.len() - 1)].name()),
        );
        for _ in 0..next(40) {
            match next(4) {
                0 => source.push_str(extras[next(extras.len())]),
                1 => write!(source, "</{}>", few[next(6)]).unwrap(),
                _ => write!(source, "<{}>", few[next(6)]).unwrap(),
            }
        }
        let wide: Vec<u16> = source.encode_utf16().collect();
        let (source, scripting) = (Chars::Utf16(&wide), next(2) == 0);
        let whole = parse_document(source, usize::MAX, scripting);
        assert_eq!(
            whole,
            parse_document(source, 1 + next(5), scripting),
            "{:?}",
            string(source)
        );
        parse_in(few[0], source, scripting);
        parse_in(
            ["svg desc", "svg g", "math mi", "math annotation-xml"][next(4)],
            source,
            scripting,
        );
    }
}
