//! Groups, repeats and lookaheads: sets of instructions, read from the end of the text. Instructions x (bytes + 1) steps.

use crate::class::Class;
use crate::node::{Assertion, Node};
use crate::unit::{Subject, Text, is_line_terminator};
use bun_collections::smallvec::SmallVec;

/// `out`: where to go on.
#[derive(Copy, Clone)]
enum Inst {
    Unit {
        unit: u32,
        out: u32,
    },
    /// Not a `/`.
    Any {
        out: u32,
    },
    Dot {
        newlines: bool,
        out: u32,
    },
    Class {
        index: u32,
        out: u32,
    },
    Split {
        out: u32,
        other: u32,
    },
    Assert {
        assertion: Assertion,
        out: u32,
    },
    Look {
        table: u32,
        negated: bool,
        out: u32,
    },
    Fail,
    Match,
}

/// About as many as a pattern has bytes. It is `MAX_LOOKS` that cuts what grows.
const MAX_INSTRUCTIONS: usize = 65_536;
const MAX_LOOKS: usize = 1_024;
const SLASH: u32 = b'/' as u32;

pub(crate) struct Program {
    insts: Box<[Inst]>,
    /// The lookaheads, the inner ones first, and the main one last: for each its entry.
    programs: Box<[u32]>,
    classes: Box<[Class]>,
    text: Text,
    /// What the main program looks for may end anywhere. Otherwise at the end of the text.
    floats: bool,
}

struct Compiler {
    insts: Vec<Inst>,
    programs: Vec<u32>,
    classes: Vec<Class>,
    text: Text,
    /// It is written to be read from the start of the text to its end, for `run_prefix`.
    forwards: bool,
}

/// `None`: beyond a limit.
impl Compiler {
    fn emit(&mut self, inst: Inst) -> Option<u32> {
        if self.insts.len() >= MAX_INSTRUCTIONS {
            return None;
        }
        self.insts.push(inst);
        Some(self.insts.len() as u32 - 1)
    }

    /// Writes `nodes` as a program of its own, and returns its number.
    fn program(&mut self, nodes: &[Node]) -> Option<u32> {
        let entry = self.emit(Inst::Match)?;
        let entry = self.sequence(nodes, entry)?;
        if self.programs.len() > MAX_LOOKS {
            return None;
        }
        self.programs.push(entry);
        Some(self.programs.len() as u32 - 1)
    }

    /// What is written last is read first.
    fn sequence(&mut self, nodes: &[Node], next: u32) -> Option<u32> {
        match self.forwards {
            true => nodes
                .iter()
                .rev()
                .try_fold(next, |next, it| self.build(it, next)),
            false => nodes.iter().try_fold(next, |next, it| self.build(it, next)),
        }
    }

    /// Where to start so that `node` is read, from its end to its start, and then `next`. As deep as the tree.
    fn build(&mut self, node: &Node, mut next: u32) -> Option<u32> {
        match node {
            Node::Fail => self.emit(Inst::Fail),
            Node::Empty => Some(next),
            Node::Lit(bytes) if self.forwards => {
                let mut at = bytes.len();
                while let Some((unit, len)) = self.text.prev(Subject::of(bytes), at) {
                    next = self.emit(Inst::Unit { unit, out: next })?;
                    at = at.saturating_sub(len);
                }
                Some(next)
            }
            Node::Lit(bytes) => {
                let mut at = 0;
                while let Some((unit, len)) = self.text.next(Subject::of(bytes), at) {
                    next = self.emit(Inst::Unit { unit, out: next })?;
                    at += len;
                }
                Some(next)
            }
            Node::Any => self.emit(Inst::Any { out: next }),
            Node::Dot { newlines } => self.emit(Inst::Dot {
                newlines: *newlines,
                out: next,
            }),
            Node::Class(class) => {
                self.classes.push(class.clone());
                self.emit(Inst::Class {
                    index: self.classes.len() as u32 - 1,
                    out: next,
                })
            }
            Node::Star => self.build(&Node::repeat(Node::Any, 0, true), next),
            Node::Plus => self.build(&Node::repeat(Node::Any, 1, true), next),
            Node::Deep {
                empty_names,
                newlines,
            } => {
                let slash = Node::Lit(vec![b'/']);
                let newlines = *newlines;
                self.build(
                    &match empty_names {
                        // `(?:.*\/)?`
                        true => {
                            let all = Node::repeat(Node::Dot { newlines }, 0, true);
                            Node::repeat(Node::Seq(vec![all, slash]), 0, false)
                        }
                        // `(?:[^/]+\/)*`
                        false => Node::repeat(Node::Seq(vec![Node::Plus, slash]), 0, true),
                    },
                    next,
                )
            }
            Node::Rest { min, newlines } => {
                let dot = Node::Dot {
                    newlines: *newlines,
                };
                self.build(&Node::repeat(dot, *min, true), next)
            }
            Node::Assert(assertion) => self.emit(Inst::Assert {
                assertion: *assertion,
                out: next,
            }),
            Node::Seq(nodes) => self.sequence(nodes, next),
            Node::Alt(nodes) => {
                let mut entry = None;
                for it in nodes {
                    let other = self.build(it, next)?;
                    entry = Some(match entry {
                        Some(out) => self.emit(Inst::Split { out, other })?,
                        None => other,
                    });
                }
                entry
            }
            Node::Repeat {
                node,
                min,
                unbounded: false,
            } => {
                let other = self.build(node, next)?;
                match min {
                    0 => self.emit(Inst::Split { out: next, other }),
                    _ => Some(other),
                }
            }
            // The body is written once, whatever `min` is.
            Node::Repeat { node, min, .. } => {
                let again = self.emit(Inst::Split {
                    out: next,
                    other: 0,
                })?;
                let body = self.build(node, again)?;
                if let Some(Inst::Split { other, .. }) = self.insts.get_mut(again as usize) {
                    *other = body;
                }
                Some(if *min == 0 { again } else { body })
            }
            // What it asks lies behind the end of the text of which `run_prefix` is asked.
            Node::Look { .. } if self.forwards => Some(next),
            Node::Look { negated, node } => {
                let table = self.program(std::slice::from_ref(&**node))?;
                self.emit(Inst::Look {
                    table,
                    negated: *negated,
                    out: next,
                })
            }
        }
    }
}

type List = SmallVec<[u32; 64]>;

/// A program on a text.
struct Run<'r> {
    program: &'r Program,
    subject: Subject<'r>,
    /// For each instruction the position at which it was last put into a list, and one more.
    mark: SmallVec<[u32; 64]>,
    /// For each lookahead `words` words: a bit for each position, whether it matches something that starts there.
    tables: SmallVec<[u64; 8]>,
    words: usize,
    stack: List,
    /// `Match` has been reached at the position that is being filled.
    matched: bool,
    /// The text is the start of a longer one.
    is_prefix: bool,
}

impl Run<'_> {
    /// Puts `pc` and what follows from it without taking a unit into `list`.
    fn add(&mut self, list: &mut List, pc: u32, pos: usize) {
        self.stack.push(pc);
        while let Some(pc) = self.stack.pop() {
            let at = pc as usize;
            let (Some(mark), Some(inst)) = (self.mark.get_mut(at), self.program.insts.get(at))
            else {
                continue;
            };
            if *mark == pos as u32 + 1 {
                continue;
            }
            *mark = pos as u32 + 1;
            match *inst {
                Inst::Split { out, other } => self.stack.extend([other, out]),
                Inst::Assert { assertion, out } if self.holds(assertion, pos) => {
                    self.stack.push(out);
                }
                Inst::Look {
                    table,
                    negated,
                    out,
                } if self.looked(table, pos) != negated => self.stack.push(out),
                Inst::Assert { .. } | Inst::Look { .. } => {}
                Inst::Fail if !self.is_prefix => {}
                Inst::Match => self.matched = true,
                _ => list.push(pc),
            }
        }
    }

    fn holds(&self, assertion: Assertion, pos: usize) -> bool {
        match self.is_prefix {
            true if assertion == Assertion::Start => pos == 0,
            // What looks beyond the end of the text holds.
            true if pos + 3 >= self.subject.len() => true,
            _ => assertion.holds(self.subject, pos),
        }
    }

    fn looked(&self, table: u32, pos: usize) -> bool {
        let word = self.tables.get(table as usize * self.words + pos / 64);
        word.is_some_and(|it| it & (1 << (pos % 64)) != 0)
    }

    /// One program over the whole text. `table`: the table to fill. `None` for the main program, of which only position 0 is asked.
    fn run_one(&mut self, entry: u32, floats: bool, table: Option<usize>) -> bool {
        let (program, n) = (self.program, self.subject.len());
        let (mut current, mut following) = (List::new(), List::new());
        self.matched = false;
        let mut pos = n;
        loop {
            if floats || pos == n {
                self.add(&mut current, entry, pos);
            }
            if self.matched
                && let Some(table) = table
                && let Some(word) = self.tables.get_mut(table * self.words + pos / 64)
            {
                *word |= 1 << (pos % 64);
            }
            if current.is_empty() && !floats && pos > 0 {
                return false;
            }
            let Some((unit, len)) = program.text.prev(self.subject, pos) else {
                return self.matched;
            };
            pos = pos.saturating_sub(len);
            following.clear();
            self.matched = false;
            for pc in &current {
                if let Some(out) = program.taken(*pc, unit) {
                    self.add(&mut following, out, pos);
                }
            }
            // `add(current, entry, pos)` at the top goes on filling the same list for the same position.
            std::mem::swap(&mut current, &mut following);
        }
    }
}

impl Program {
    fn compiled(nodes: &[Node], text: Text, forwards: bool) -> Option<Program> {
        let mut compiler = Compiler {
            insts: Vec::new(),
            programs: Vec::new(),
            classes: Vec::new(),
            text,
            forwards,
        };
        compiler.program(nodes)?;
        Some(Program {
            insts: compiler.insts.into(),
            programs: compiler.programs.into(),
            classes: compiler.classes.into(),
            text,
            floats: true,
        })
    }

    /// `None`: beyond a limit.
    pub(crate) fn new(nodes: &[Node], text: Text) -> Option<Program> {
        // An end that is the last thing of all is not an instruction: the main program is then entered at the end of the text only.
        match nodes {
            [main @ .., Node::Assert(Assertion::End)] => {
                let program = Program::compiled(main, text, false)?;
                Some(Program {
                    floats: false,
                    ..program
                })
            }
            _ => Program::compiled(nodes, text, false),
        }
    }

    /// The same tree written forwards, for `run_prefix`. Lookaheads are left out of it.
    pub(crate) fn new_forwards(nodes: &[Node], text: Text) -> Option<Program> {
        Program::compiled(nodes, text, true)
    }

    /// Where to go on from the instruction at `pc`, if it takes `unit`.
    #[inline]
    fn taken(&self, pc: u32, unit: u32) -> Option<u32> {
        match *self.insts.get(pc as usize)? {
            Inst::Unit { unit: wanted, out } if wanted == unit => Some(out),
            Inst::Any { out } if unit != SLASH => Some(out),
            Inst::Dot { newlines, out } if newlines || !is_line_terminator(unit) => Some(out),
            Inst::Class { index, out } if self.classes.get(index as usize)?.has(unit) => Some(out),
            _ => None,
        }
    }

    fn on<'r>(&'r self, subject: Subject<'r>, tables: usize, is_prefix: bool) -> Run<'r> {
        let words = subject.len() / 64 + 1;
        Run {
            program: self,
            subject,
            mark: SmallVec::from_elem(0, self.insts.len()),
            tables: SmallVec::from_elem(0, tables * words),
            words,
            stack: List::new(),
            matched: false,
            is_prefix,
        }
    }

    /// Whether `subject`, a directory with its `/`, can be the start of a match. Never `false` if it can.
    pub(crate) fn run_prefix(&self, subject: Subject<'_>) -> bool {
        let Some(entry) = self.programs.first() else {
            return true;
        };
        if subject.len() >= u32::MAX as usize {
            return true;
        }
        let mut run = self.on(subject, 0, true);
        let (mut current, mut following) = (List::new(), List::new());
        run.add(&mut current, *entry, 0);
        let mut pos = 0;
        while let Some((unit, len)) = self.text.next(subject, pos) {
            if current.is_empty() {
                return false;
            }
            pos += len;
            following.clear();
            run.matched = false;
            for pc in &current {
                if let Some(out) = self.taken(*pc, unit) {
                    run.add(&mut following, out, pos);
                }
            }
            std::mem::swap(&mut current, &mut following);
        }
        !current.is_empty() || run.matched
    }

    /// Whether the tree matches from the start of `subject`.
    pub(crate) fn run(&self, subject: Subject<'_>) -> bool {
        let Some((main, looks)) = self.programs.split_last() else {
            return false;
        };
        if subject.len() >= u32::MAX as usize {
            return false;
        }
        let mut run = self.on(subject, looks.len(), false);
        for (table, entry) in looks.iter().enumerate() {
            run.run_one(*entry, true, Some(table));
        }
        run.run_one(*main, self.floats, None)
    }
}
