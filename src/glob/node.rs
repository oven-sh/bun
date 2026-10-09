//! The one tree that all readers make, the pieces that two of them write it in, and `lower`, which picks the loop that runs it.

use crate::class::Class;
use crate::linear::{self, Tok, Tokens};
use crate::sets;
use crate::unit::{Subject, Text, Unit, push_utf8};
use bun_core::strings;

// ───────────────────────────── assertions ─────────────────────────────

/// Each is decided by at most four bytes around the position.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Assertion {
    /// `^`
    Start,
    /// `$`
    End,
    /// `(?=$|\/$)`, and `\/?$`
    EndOrFinalSlash,
    /// `(?:$|\/)` at the end of a lookahead
    EndOrSlash,
    /// `(?!\.)`
    NotDot,
    /// `(?=.)`
    SomeUnit,
    /// `(?!\.{1,2}(?:\/|$))`
    NotDots,
    /// `(?!\.{0,1}(?:\/|$))`
    NotDotOrEmpty,
    /// `(?!(?:^|\/)\.{1,2}(?:\/|$))`
    NotDotsBehindStart,
    /// `(?!(?:^|\/)\.)`
    NotDotBehindStart,
    /// `\b`
    WordBoundary,
    /// `\B`
    NotWordBoundary,
}

fn ends_name(byte: Option<u8>) -> bool {
    matches!(byte, None | Some(b'/'))
}

fn is_word(byte: Option<u8>) -> bool {
    byte.is_some_and(|it| it.is_ascii_alphanumeric() || it == b'_')
}

/// `.` or `..` and then a `/` or the end, from `at`.
fn dots_at(subject: Subject<'_>, at: usize) -> bool {
    let second = subject.get(at + 1);
    subject.get(at) == Some(b'.')
        && (ends_name(second) || second == Some(b'.') && ends_name(subject.get(at + 2)))
}

impl Assertion {
    /// It is not written as a lookahead.
    fn is_anchor(self) -> bool {
        use Assertion::{End, NotWordBoundary, Start, WordBoundary};
        matches!(self, Start | End | WordBoundary | NotWordBoundary)
    }

    #[inline]
    pub(crate) fn holds(self, subject: Subject<'_>, at: usize) -> bool {
        let here = subject.get(at);
        let (is_slash, is_dot) = (here == Some(b'/'), here == Some(b'.'));
        match self {
            Assertion::Start => at == 0,
            Assertion::End => here.is_none(),
            Assertion::EndOrFinalSlash => {
                here.is_none() || is_slash && subject.get(at + 1).is_none()
            }
            Assertion::EndOrSlash => ends_name(here),
            Assertion::NotDot => !is_dot,
            Assertion::SomeUnit => {
                let rest = subject.bytes.get(at..).unwrap_or_default();
                here.is_some() && !bun_core::lexer::starts_with_line_break(rest)
            }
            Assertion::NotDots => !dots_at(subject, at),
            Assertion::NotDotOrEmpty => {
                !(ends_name(here) || is_dot && ends_name(subject.get(at + 1)))
            }
            Assertion::NotDotsBehindStart => {
                !(at == 0 && dots_at(subject, 0) || is_slash && dots_at(subject, at + 1))
            }
            Assertion::NotDotBehindStart => {
                !(at == 0 && is_dot || is_slash && subject.get(at + 1) == Some(b'.'))
            }
            Assertion::WordBoundary => is_word(subject.before(at)) != is_word(here),
            Assertion::NotWordBoundary => is_word(subject.before(at)) == is_word(here),
        }
    }
}

// ───────────────────────────── the tree ─────────────────────────────

/// What the references write as a regular expression, as values. It matches from the start. The end is `Assert(End)`.
#[derive(PartialEq, Eq)]
pub(crate) enum Node {
    /// `$.`, `[]`, `$^`
    Fail,
    Empty,
    Lit(Vec<u8>),
    /// `[^/]`
    Any,
    /// `.`
    Dot {
        newlines: bool,
    },
    Class(Class),
    /// `[^/]*`
    Star,
    /// `[^/]+`
    Plus,
    /// Names, each with its `/`: `(?:.*\/)?`, or without `empty_names` `(?:[^/]+\/)*`.
    Deep {
        empty_names: bool,
        newlines: bool,
    },
    /// `.+`, `.*` up to the end.
    Rest {
        min: u8,
        newlines: bool,
    },
    Assert(Assertion),
    Seq(Vec<Node>),
    Alt(Vec<Node>),
    /// `min` is 0 or 1.
    Repeat {
        node: Box<Node>,
        min: u8,
        unbounded: bool,
    },
    Look {
        negated: bool,
        node: Box<Node>,
    },
}

/// How deep a tree can be. The readers see to it. Whatever walks a tree recurses at most this deep, and a few levels that `lower` adds.
pub(crate) const MAX_NESTING: usize = 128;

impl Node {
    pub(crate) fn repeat(node: Node, min: u8, unbounded: bool) -> Node {
        Node::Repeat {
            node: Box::new(node),
            min,
            unbounded,
        }
    }

    /// A unit of UTF-16 as characters.
    pub(crate) fn of_unit(unit: u32) -> Node {
        let mut bytes = Vec::with_capacity(3);
        push_utf8(&mut bytes, unit);
        Node::Lit(bytes)
    }
}

// ───────────────────────────── pieces ─────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Open {
    /// `(?:`
    Group,
    /// `(`
    Capture,
    /// `(?=`
    Look,
    /// `(?!`
    NotLook,
}

/// What minimatch and picomatch write from left to right is not always nested: they write pieces, and `nest` makes the tree.
#[derive(PartialEq, Eq)]
pub(crate) enum Piece {
    /// A leaf.
    Node(Node),
    Open(Open),
    Close,
    Bar,
    /// `?`, `*`, `+` behind an atom.
    Quant {
        min: u8,
        unbounded: bool,
    },
    /// `\1`: the group of that number if there is one, else `unit`.
    Reference {
        number: u32,
        unit: u32,
    },
}

/// A group that is open: the alternatives that are closed, and the one that is being written.
struct Frame {
    kind: Open,
    alternatives: Vec<Node>,
    nodes: Vec<Node>,
    /// A `?`, `*` or `+` can follow.
    repeatable: bool,
}

impl Frame {
    fn new(kind: Open) -> Frame {
        Frame {
            kind,
            alternatives: Vec::new(),
            nodes: Vec::new(),
            repeatable: false,
        }
    }

    fn close(mut self) -> Node {
        self.alternatives.push(Node::Seq(self.nodes));
        match self.alternatives.pop() {
            Some(only) if self.alternatives.is_empty() => only,
            last => {
                self.alternatives.extend(last);
                Node::Alt(self.alternatives)
            }
        }
    }
}

/// `None`: it is no expression, or nested too deep. `Fail`: it refers to a group. No recursion: a stack of open groups.
pub(crate) fn nest(pieces: Vec<Piece>) -> Option<Node> {
    let is_capture = |piece: &&Piece| matches!(piece, Piece::Open(Open::Capture));
    let captures = pieces.iter().filter(is_capture).count();
    let mut stack: Vec<Frame> = Vec::new();
    let mut top = Frame::new(Open::Group);
    let mut refers = false;
    for piece in pieces {
        match piece {
            Piece::Node(node) => {
                // `^*` is refused, and so is `[^/]*?*`. An assertion that is written as a lookahead can be repeated.
                top.repeatable = match &node {
                    Node::Assert(assertion) => !assertion.is_anchor(),
                    node => !matches!(node, Node::Star | Node::Plus),
                };
                top.nodes.push(node);
            }
            Piece::Reference { number, unit } => {
                // It is an expression, but not one that is followed. If what is left is one too.
                refers |= number as usize <= captures;
                top.nodes.push(Node::of_unit(unit));
                top.repeatable = true;
            }
            Piece::Open(kind) => {
                if stack.len() >= MAX_NESTING {
                    return None;
                }
                stack.push(std::mem::replace(&mut top, Frame::new(kind)));
            }
            Piece::Bar => {
                let nodes = std::mem::take(&mut top.nodes);
                top.alternatives.push(Node::Seq(nodes));
                top.repeatable = false;
            }
            Piece::Close => {
                let closed = std::mem::replace(&mut top, stack.pop()?);
                let (kind, inner) = (closed.kind, closed.close());
                top.nodes.push(match kind {
                    Open::Group | Open::Capture => inner,
                    Open::Look | Open::NotLook => Node::Look {
                        negated: kind == Open::NotLook,
                        node: Box::new(inner),
                    },
                });
                top.repeatable = true;
            }
            Piece::Quant { min, unbounded } => {
                if !top.repeatable {
                    return None;
                }
                top.repeatable = false;
                let repeated = match top.nodes.pop()? {
                    // Only its last unit is repeated.
                    Node::Lit(mut bytes) => {
                        let last = Text::UTF16.prev(Subject::of(&bytes), bytes.len());
                        let unit = bytes.split_off(bytes.len() - last.map_or(0, |it| it.1));
                        if !bytes.is_empty() {
                            top.nodes.push(Node::Lit(bytes));
                        }
                        Node::Lit(unit)
                    }
                    // A lookahead that is repeated holds once or is left out.
                    Node::Look { .. } | Node::Assert(_) if min == 0 => continue,
                    look @ (Node::Look { .. } | Node::Assert(_)) => {
                        top.nodes.push(look);
                        continue;
                    }
                    other => other,
                };
                top.nodes.push(Node::repeat(repeated, min, unbounded));
            }
        }
    }
    stack.is_empty().then(|| match refers {
        true => Node::Fail,
        false => top.close(),
    })
}

// ───────────────────────────── lower ─────────────────────────────

fn push_part(nodes: &mut Vec<Node>, part: Node) {
    match part {
        Node::Empty => {}
        Node::Lit(bytes) => match nodes.last_mut() {
            Some(Node::Lit(last)) => last.extend_from_slice(&bytes),
            _ => nodes.push(Node::Lit(bytes)),
        },
        part => nodes.push(part),
    }
}

/// Without `Seq` in `Seq`, `Empty`, and `Lit` beside `Lit`. A `Seq` with a `Fail` is a `Fail`, an `Alt` loses it. As deep as the tree.
pub(crate) fn simplify(node: Node) -> Node {
    match node {
        Node::Seq(children) => {
            let mut nodes: Vec<Node> = Vec::with_capacity(children.len());
            for child in children {
                match simplify(child) {
                    Node::Fail => return Node::Fail,
                    Node::Seq(parts) => parts.into_iter().for_each(|it| push_part(&mut nodes, it)),
                    part => push_part(&mut nodes, part),
                }
            }
            match nodes.pop() {
                None => Node::Empty,
                Some(only) if nodes.is_empty() => only,
                Some(last) => {
                    nodes.push(last);
                    Node::Seq(nodes)
                }
            }
        }
        Node::Alt(children) => {
            let simplified = children.into_iter().map(simplify);
            let mut nodes: Vec<Node> = simplified.filter(|it| !matches!(it, Node::Fail)).collect();
            match nodes.pop() {
                None => Node::Fail,
                Some(only) if nodes.is_empty() => only,
                Some(last) => {
                    nodes.push(last);
                    Node::Alt(nodes)
                }
            }
        }
        Node::Repeat {
            node,
            min,
            unbounded,
        } => match simplify(*node) {
            Node::Fail if min > 0 => Node::Fail,
            Node::Fail | Node::Empty => Node::Empty,
            it => Node::repeat(it, min, unbounded),
        },
        Node::Look { negated, node } => match simplify(*node) {
            // What it comes to if it holds nowhere, and if it holds everywhere.
            Node::Fail if negated => Node::Empty,
            Node::Fail => Node::Fail,
            Node::Empty if negated => Node::Fail,
            Node::Empty => Node::Empty,
            it => Node::Look {
                negated,
                node: Box::new(it),
            },
        },
        Node::Lit(bytes) if bytes.is_empty() => Node::Empty,
        Node::Class(class) if class.is_slash() => Node::Lit(vec![b'/']),
        other => other,
    }
}

fn is_optional_slash(node: &Node) -> bool {
    matches!(node, Node::Repeat { node, min: 0, unbounded: false } if matches!(&**node, Node::Lit(bytes) if bytes == b"/"))
}

/// The tokens of `nodes`, if the linear loop gives the right answer for them.
fn tokens_of(nodes: &[Node], text: Text) -> Option<Tokens> {
    let mut out = Tokens::new(text);
    let mut first_deep = None;
    for (i, node) in nodes.iter().enumerate() {
        let after = nodes.get(i + 1..).unwrap_or_default();
        match node {
            Node::Lit(bytes) => out.push_lit(bytes),
            Node::Any => out.push(Tok::Any),
            Node::Star => out.push(Tok::Star),
            Node::Plus => out.push(Tok::Plus),
            // A `*` cannot take the `/` that the class could, so "only the last `*` counts" does not hold.
            Node::Class(class) if class.takes_slash() => return None,
            Node::Class(class) => out.push_class(class.clone()),
            Node::Deep {
                empty_names,
                newlines,
            } => {
                // It stands where a name starts. Otherwise a `*` before it is thrown away while it has taken nothing.
                let starts_name = match nodes.get(..i) {
                    Some([] | [Node::Assert(Assertion::Start)]) => true,
                    Some([.., Node::Lit(before)]) => before.ends_with(b"/"),
                    _ => false,
                };
                if !starts_name {
                    return None;
                }
                let kind = (*empty_names, *newlines);
                out.has_two_kinds_of_deep |= *first_deep.get_or_insert(kind) != kind;
                out.push(Tok::Deep {
                    empty_names: *empty_names,
                    newlines: *newlines,
                });
            }
            Node::Rest { min, newlines } => {
                // It does not go back, so what follows has to hold at the end.
                let holds_at_end = |it: &Node| {
                    use Assertion::{End, EndOrFinalSlash, EndOrSlash};
                    matches!(it, Node::Assert(End | EndOrFinalSlash | EndOrSlash))
                };
                if !after.iter().all(holds_at_end) {
                    return None;
                }
                out.push(Tok::Rest {
                    min: *min,
                    newlines: *newlines,
                });
                return Some(out);
            }
            Node::Assert(assertion) => out.push(Tok::Assert(*assertion)),
            // `\/?$`
            _ if is_optional_slash(node) && matches!(after, [Node::Assert(Assertion::End)]) => {
                out.push(Tok::Assert(Assertion::EndOrFinalSlash));
                return Some(out);
            }
            _ => return None,
        }
    }
    Some(out)
}

/// A tree that is ready to run.
pub(crate) enum Program {
    Never,
    Linear {
        tokens: Tokens,
        /// With two kinds of `**`, for a text with an empty name or a line terminator: there the last `**` is not enough.
        fallback: Option<Box<sets::Program>>,
        /// The same tree for the other loop, which has to give the same answers.
        #[cfg(debug_assertions)]
        check: Option<Box<sets::Program>>,
    },
    Sets {
        program: sets::Program,
        /// For `may_match_inside`.
        forwards: Option<Box<sets::Program>>,
    },
}

pub(crate) fn lower(node: Node, text: Text) -> Program {
    let nodes = match simplify(node) {
        Node::Fail => return Program::Never,
        Node::Empty => Vec::new(),
        Node::Seq(nodes) => nodes,
        it => vec![it],
    };
    let Some(mut tokens) = tokens_of(&nodes, text) else {
        return match sets::Program::new(&nodes, text) {
            // The other has fewer instructions than this one, so it is within the limit too.
            Some(program) => Program::Sets {
                program,
                forwards: sets::Program::new_forwards(&nodes, text).map(Box::new),
            },
            None => Program::Never,
        };
    };
    tokens.finish();
    let other_loop = || sets::Program::new(&nodes, text).map(Box::new);
    let fallback = match tokens.has_two_kinds_of_deep {
        true => Some(other_loop()),
        false => None,
    };
    match fallback {
        Some(None) => Program::Never,
        fallback => Program::Linear {
            tokens,
            fallback: fallback.flatten(),
            #[cfg(debug_assertions)]
            check: other_loop(),
        },
    }
}

fn has_empty_name_or_line_terminator(text: Text, subject: Subject<'_>) -> bool {
    let bytes = subject.bytes;
    strings::contains(bytes, b"//")
        || subject.slash && bytes.ends_with(b"/")
        || strings::contains_any(bytes, b"\n\r")
        || text.unit != Unit::Byte
            && (strings::contains(bytes, b"\xE2\x80\xA8")
                || strings::contains(bytes, b"\xE2\x80\xA9"))
}

impl Program {
    pub(crate) fn is_never(&self) -> bool {
        matches!(self, Program::Never)
    }

    #[inline]
    pub(crate) fn matches(&self, subject: Subject<'_>) -> bool {
        match self {
            Program::Never => false,
            Program::Linear {
                tokens,
                fallback: Some(fallback),
                ..
            } if has_empty_name_or_line_terminator(tokens.text, subject) => fallback.run(subject),
            Program::Linear { tokens, .. } => {
                let hit = tokens.run(subject, false);
                #[cfg(debug_assertions)]
                {
                    if let Program::Linear {
                        check: Some(check), ..
                    } = self
                    {
                        debug_assert_eq!(hit, check.run(subject), "the two loops differ");
                    }
                }
                hit
            }
            Program::Sets { program, .. } => program.run(subject),
        }
    }

    /// Whether something in `directory` can match. `directory.slash` is set. Never `false` if something can.
    pub(crate) fn may_match_inside(&self, directory: Subject<'_>) -> bool {
        match self {
            Program::Never => false,
            Program::Linear { tokens, .. } => tokens.run(directory, true),
            Program::Sets { forwards, .. } => {
                forwards.as_ref().is_none_or(|it| it.run_prefix(directory))
            }
        }
    }

    /// The longest run of characters that is somewhere in whatever matches. Empty: it is not known.
    pub(crate) fn longest_literal(&self) -> &[u8] {
        match self {
            Program::Linear { tokens, .. } => tokens.longest_literal(),
            _ => b"",
        }
    }

    /// For the index of `ignore.rs`.
    pub(crate) fn shape(&self) -> linear::Shape<'_> {
        match self {
            Program::Linear {
                tokens,
                fallback: None,
                ..
            } => tokens.shape(),
            _ => linear::Shape::Other,
        }
    }
}
