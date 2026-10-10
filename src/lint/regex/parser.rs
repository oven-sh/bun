//! `RegExpParser` of `@eslint-community/regexpp`: builds the [`Ast`] from what the validator finds.

use super::ast::{Ast, Data, EscapeSet, Flags, ModifierFlags, NodeData, NodeId, Reference, Run};
use super::validator::{self, Handler, Mode, Options, SyntaxError};
use std::cell::OnceCell;

/// `new RegExpParser(options).parseLiteral(source)`, `parseRegExpLiteral(source, options)`
pub fn parse_literal(source: &[u8], options: Options) -> Result<Ast<'_>, SyntaxError> {
    let mut builder = Builder::new(source);
    validator::validate_literal(source, options, &mut builder)?;
    let (pattern, flags) = (builder.node, builder.flags);
    let root = builder.push(
        Data::RegExpLiteral { pattern, flags },
        NodeId::NONE,
        0,
        source.len() as u32,
    );
    builder.set_parent(pattern, root);
    builder.set_parent(flags, root);
    Ok(builder.finish(root))
}

/// `new RegExpParser(options).parsePattern(source, 0, source.length, mode)`
pub fn parse_pattern(source: &[u8], mode: Mode, options: Options) -> Result<Ast<'_>, SyntaxError> {
    let mut builder = Builder::new(source);
    validator::validate_pattern(source, mode, options, &mut builder)?;
    let root = builder.node;
    Ok(builder.finish(root))
}

/// `new RegExpParser(options).parseFlags(source)`
pub fn parse_flags(source: &[u8], options: Options) -> Result<Flags, SyntaxError> {
    struct Keep(Flags);
    impl Handler for Keep {
        fn on_regexp_flags(&mut self, _start: u32, _end: u32, flags: Flags) {
            self.0 = flags;
        }
    }
    let mut keep = Keep(Flags::default());
    validator::validate_flags(source, options, &mut keep)?;
    Ok(keep.0)
}

/// regexpp's `RegExpParserState`.
///
/// A node that is being parsed has the index in `pending` of its first child as the `start` of its
/// list. The list moves to `Ast::lists` when the node ends.
struct Builder<'s> {
    ast: Ast<'s>,
    /// The node that is being parsed.
    node: NodeId,
    flags: NodeId,
    /// The children so far of the nodes that are being parsed, outermost first.
    pending: Vec<NodeId>,
    backreferences: Vec<NodeId>,
    capturing_groups: Vec<NodeId>,
}

impl<'s> Builder<'s> {
    fn new(source: &'s [u8]) -> Self {
        Builder {
            ast: Ast {
                source,
                nodes: Vec::new(),
                lists: Vec::new(),
                text: Vec::new(),
                root: NodeId::NONE,
                utf16: OnceCell::new(),
            },
            node: NodeId::NONE,
            flags: NodeId::NONE,
            pending: Vec::new(),
            backreferences: Vec::new(),
            capturing_groups: Vec::new(),
        }
    }

    fn finish(mut self, root: NodeId) -> Ast<'s> {
        self.ast.root = root;
        self.ast
    }

    fn push(&mut self, data: Data, parent: NodeId, start: u32, end: u32) -> NodeId {
        let id = NodeId(self.ast.nodes.len() as u32);
        self.ast.nodes.push(NodeData {
            data,
            parent,
            start,
            end,
        });
        id
    }

    fn get_mut(&mut self, id: NodeId) -> Option<&mut NodeData> {
        self.ast.nodes.get_mut(id.0 as usize)
    }

    fn data(&self, id: NodeId) -> Option<Data> {
        self.ast.nodes.get(id.0 as usize).map(|node| node.data)
    }

    fn set_parent(&mut self, child: NodeId, parent: NodeId) {
        if let Some(node) = self.get_mut(child) {
            node.parent = parent;
        }
    }

    fn text(&mut self, text: &[u8]) -> Run {
        let start = self.ast.text.len() as u32;
        self.ast.text.extend_from_slice(text);
        Run {
            start,
            len: text.len() as u32,
        }
    }

    /// An empty list for a node that starts.
    fn open_list(&self) -> Run {
        Run {
            start: self.pending.len() as u32,
            len: 0,
        }
    }

    /// A child of the current node that has no children itself.
    fn leaf(&mut self, data: Data, start: u32, end: u32) -> NodeId {
        let id = self.push(data, self.node, start, end);
        self.pending.push(id);
        id
    }

    /// A child of the current node, which becomes the current node. `data` is given the empty list.
    fn open(&mut self, start: u32, data: impl FnOnce(Run) -> Data) {
        let id = self.push(Data::Any, self.node, start, start);
        self.pending.push(id);
        let list = self.open_list();
        if let Some(node) = self.get_mut(id) {
            node.data = data(list);
        }
        self.node = id;
    }

    /// Ends the current node.
    fn close(&mut self, end: u32) {
        let id = self.node;
        let lists = self.ast.lists.len() as u32;
        let pending = self.pending.len() as u32;
        let Some(node) = self.ast.nodes.get_mut(id.0 as usize) else {
            return;
        };
        node.end = end;
        self.node = node.parent;
        let (Data::Pattern { alternatives: list }
        | Data::Alternative { elements: list }
        | Data::Group {
            alternatives: list, ..
        }
        | Data::CapturingGroup {
            alternatives: list, ..
        }
        | Data::Lookaround {
            alternatives: list, ..
        }
        | Data::CharacterClass { elements: list, .. }
        | Data::ClassStringDisjunction { alternatives: list }
        | Data::StringAlternative { elements: list }) = &mut node.data
        else {
            return;
        };
        let first = list.start.min(pending);
        *list = Run {
            start: lists,
            len: pending - first,
        };
        self.ast.lists.extend(self.pending.drain(first as usize..));
    }

    /// Removes the last child so far of the current node.
    fn pop_child(&mut self) -> Option<NodeId> {
        let (Data::Alternative { elements: list } | Data::CharacterClass { elements: list, .. }) =
            self.data(self.node)?
        else {
            return None;
        };
        if self.pending.len() as u32 <= list.start {
            return None;
        }
        self.pending.pop()
    }

    fn list(&mut self, ids: impl Iterator<Item = NodeId>) -> Run {
        let start = self.ast.lists.len() as u32;
        self.ast.lists.extend(ids);
        Run {
            start,
            len: self.ast.lists.len() as u32 - start,
        }
    }

    fn class_operation(&mut self, start: u32, end: u32, data: fn(NodeId, NodeId) -> Data) {
        let class = self.node;
        let Some(Data::CharacterClass { expression, .. }) = self.data(class) else {
            return;
        };
        let Some(right) = self.pop_child() else {
            return;
        };
        let left = if expression == NodeId::NONE {
            self.pop_child()
        } else {
            Some(expression)
        };
        let Some(left) = left else { return };
        let id = self.push(data(left, right), class, start, end);
        self.set_parent(left, id);
        self.set_parent(right, id);
        if let Some(NodeData {
            data: Data::CharacterClass { expression, .. },
            ..
        }) = self.get_mut(class)
        {
            *expression = id;
        }
    }
}

/// The groups of one name.
struct Named {
    name: Run,
    /// Where they are in the list of all groups with a name.
    first: usize,
    len: usize,
    /// They, as the list that every backreference by this name resolves to.
    groups: Option<Run>,
    /// The backreferences by this name.
    references: Vec<NodeId>,
}

impl Builder<'_> {
    /// Gives each backreference its groups and each group its backreferences. Backreferences by one name share their list, and
    /// so do the groups of one name that no number refers to: n groups and n backreferences of one name take room for 2 n.
    fn resolve_backreferences(&mut self) {
        let text = std::mem::take(&mut self.ast.text);
        let text_of =
            |run: Run| text.get(run.start as usize..run.start as usize + run.len as usize);
        let name_of = |nodes: &[NodeData], group: NodeId| match nodes
            .get(group.0 as usize)
            .map(|it| it.data)
        {
            Some(Data::CapturingGroup { name, .. }) if name.start != Run::NONE.start => Some(name),
            _ => None,
        };
        let is_by_name = |it: &NodeId| matches!(self.data(*it), Some(Data::Backreference { name, .. }) if name.start != Run::NONE.start);
        let (mut with_name, mut names): (Vec<(Run, NodeId)>, Vec<Named>) = (Vec::new(), Vec::new());
        if self.backreferences.iter().any(is_by_name) {
            let all = self.capturing_groups.iter();
            with_name
                .extend(all.filter_map(|&group| Some((name_of(&self.ast.nodes, group)?, group))));
            crate::utils::sort::sort_by_key(&mut with_name, |it| text_of(it.0));
            let mut first = 0;
            for same in with_name.chunk_by(|a, b| text_of(a.0) == text_of(b.0)) {
                names.push(Named {
                    name: same[0].0,
                    first,
                    len: same.len(),
                    groups: None,
                    references: Vec::new(),
                });
                first += same.len();
            }
        }
        // (group, reference), in the order of the references.
        let mut by_number: Vec<(NodeId, NodeId)> = Vec::new();
        for i in 0..self.backreferences.len() {
            let reference = self.backreferences[i];
            let Some(Data::Backreference { number, name, .. }) = self.data(reference) else {
                continue;
            };
            let groups = if name.start == Run::NONE.start {
                let group = (number as usize)
                    .checked_sub(1)
                    .and_then(|i| self.capturing_groups.get(i))
                    .copied();
                by_number.extend(group.map(|group| (group, reference)));
                self.list(group.into_iter())
            } else {
                match names.binary_search_by_key(&text_of(name), |it| text_of(it.name)) {
                    Ok(at) => {
                        let named = &mut names[at];
                        named.references.push(reference);
                        let groups = &with_name[named.first..named.first + named.len];
                        *named
                            .groups
                            .get_or_insert_with(|| self.list(groups.iter().map(|it| it.1)))
                    }
                    Err(_) => Run::default(),
                }
            };
            if let Some(NodeData {
                data: Data::Backreference { resolved, .. },
                ..
            }) = self.get_mut(reference)
            {
                *resolved = groups;
            }
        }
        let set_references = |this: &mut Self, group: NodeId, list: Run| {
            if let Some(NodeData {
                data: Data::CapturingGroup { references, .. },
                ..
            }) = this.get_mut(group)
            {
                *references = list;
            }
        };
        for named in names.iter().filter(|it| !it.references.is_empty()) {
            let list = self.list(named.references.iter().copied());
            for &(_, group) in &with_name[named.first..named.first + named.len] {
                set_references(self, group, list);
            }
        }
        crate::utils::sort::sort_by_key(&mut by_number, |(group, _)| group.0);
        for same in by_number.chunk_by(|a, b| a.0 == b.0) {
            let group = same[0].0;
            let by_name = name_of(&self.ast.nodes, group)
                .and_then(|name| {
                    names
                        .binary_search_by_key(&text_of(name), |it| text_of(it.name))
                        .ok()
                })
                .map_or(&[][..], |at| &names[at].references);
            // Nodes are numbered in the order of the source.
            let mut all: Vec<NodeId> = same
                .iter()
                .map(|it| it.1)
                .chain(by_name.iter().copied())
                .collect();
            crate::utils::sort::sort_by_key(&mut all, |it| it.0);
            let list = self.list(all.into_iter());
            set_references(self, group, list);
        }
        self.ast.text = text;
    }
}

impl Handler for Builder<'_> {
    fn on_regexp_flags(&mut self, start: u32, end: u32, flags: Flags) {
        self.flags = self.push(Data::Flags(flags), NodeId::NONE, start, end);
    }

    fn on_pattern_enter(&mut self, start: u32) {
        // The flags of a literal come first and stay.
        let keep = if self.flags == NodeId::NONE {
            0
        } else {
            self.flags.0 as usize + 1
        };
        self.ast.nodes.truncate(keep);
        self.ast.lists.clear();
        self.ast.text.clear();
        self.pending.clear();
        self.backreferences.clear();
        self.capturing_groups.clear();
        self.node = self.push(
            Data::Pattern {
                alternatives: Run::default(),
            },
            NodeId::NONE,
            start,
            start,
        );
    }

    fn on_pattern_leave(&mut self, _start: u32, end: u32) {
        let pattern = self.node;
        self.close(end);
        self.node = pattern;

        self.resolve_backreferences();
    }

    fn on_alternative_enter(&mut self, start: u32, _index: u32) {
        self.open(start, |elements| Data::Alternative { elements });
    }

    fn on_alternative_leave(&mut self, _start: u32, end: u32, _index: u32) {
        self.close(end);
    }

    fn on_group_enter(&mut self, start: u32) {
        self.open(start, |alternatives| Data::Group {
            modifiers: NodeId::NONE,
            alternatives,
        });
    }

    fn on_group_leave(&mut self, _start: u32, end: u32) {
        self.close(end);
    }

    fn on_modifiers_enter(&mut self, start: u32) {
        let group = self.node;
        let id = self.push(
            Data::Modifiers {
                add: NodeId::NONE,
                remove: NodeId::NONE,
            },
            group,
            start,
            start,
        );
        if let Some(NodeData {
            data: Data::Group { modifiers, .. },
            ..
        }) = self.get_mut(group)
        {
            *modifiers = id;
        }
        self.node = id;
    }

    fn on_modifiers_leave(&mut self, _start: u32, end: u32) {
        self.close(end);
    }

    fn on_add_modifiers(&mut self, start: u32, end: u32, flags: ModifierFlags) {
        let id = self.push(Data::ModifierFlags(flags), self.node, start, end);
        if let Some(NodeData {
            data: Data::Modifiers { add, .. },
            ..
        }) = self.get_mut(self.node)
        {
            *add = id;
        }
    }

    fn on_remove_modifiers(&mut self, start: u32, end: u32, flags: ModifierFlags) {
        let id = self.push(Data::ModifierFlags(flags), self.node, start, end);
        if let Some(NodeData {
            data: Data::Modifiers { remove, .. },
            ..
        }) = self.get_mut(self.node)
        {
            *remove = id;
        }
    }

    fn on_capturing_group_enter(&mut self, start: u32, name: Option<&[u8]>) {
        let name = name.map_or(Run::NONE, |name| self.text(name));
        self.open(start, |alternatives| Data::CapturingGroup {
            name,
            alternatives,
            references: Run::default(),
        });
        self.capturing_groups.push(self.node);
    }

    fn on_capturing_group_leave(&mut self, _start: u32, end: u32, _name: Option<&[u8]>) {
        self.close(end);
    }

    fn on_quantifier(&mut self, _start: u32, end: u32, min: u32, max: u32, greedy: bool) {
        let Some(element) = self.pop_child() else {
            return;
        };
        let start = self
            .ast
            .nodes
            .get(element.0 as usize)
            .map_or(0, |node| node.start);
        let id = self.leaf(
            Data::Quantifier {
                min,
                max,
                greedy,
                element,
            },
            start,
            end,
        );
        self.set_parent(element, id);
    }

    fn on_lookaround_assertion_enter(&mut self, start: u32, behind: bool, negate: bool) {
        self.open(start, |alternatives| Data::Lookaround {
            behind,
            negate,
            alternatives,
        });
    }

    fn on_lookaround_assertion_leave(
        &mut self,
        _start: u32,
        end: u32,
        _behind: bool,
        _negate: bool,
    ) {
        self.close(end);
    }

    fn on_edge_assertion(&mut self, start: u32, end: u32, at_end: bool) {
        self.leaf(Data::Edge { end: at_end }, start, end);
    }

    fn on_word_boundary_assertion(&mut self, start: u32, end: u32, negate: bool) {
        self.leaf(Data::WordBoundary { negate }, start, end);
    }

    fn on_any_character_set(&mut self, start: u32, end: u32) {
        self.leaf(Data::Any, start, end);
    }

    fn on_escape_character_set(&mut self, start: u32, end: u32, set: EscapeSet, negate: bool) {
        self.leaf(Data::Escape { set, negate }, start, end);
    }

    fn on_unicode_property_character_set(
        &mut self,
        start: u32,
        end: u32,
        key: &[u8],
        value: Option<&[u8]>,
        negate: bool,
        strings: bool,
    ) {
        let key = self.text(key);
        let value = value.map_or(Run::NONE, |value| self.text(value));
        self.leaf(
            Data::Property {
                key,
                value,
                negate,
                strings,
            },
            start,
            end,
        );
    }

    fn on_character(&mut self, start: u32, end: u32, value: u32) {
        self.leaf(Data::Character { value }, start, end);
    }

    fn on_backreference(&mut self, start: u32, end: u32, reference: Reference<'_>) {
        let (number, name) = match reference {
            Reference::Number(number) => (number, Run::NONE),
            Reference::Name(name) => (0, self.text(name)),
        };
        let id = self.leaf(
            Data::Backreference {
                number,
                name,
                resolved: Run::default(),
            },
            start,
            end,
        );
        self.backreferences.push(id);
    }

    fn on_character_class_enter(&mut self, start: u32, negate: bool, unicode_sets: bool) {
        self.open(start, |elements| Data::CharacterClass {
            unicode_sets,
            negate,
            elements,
            expression: NodeId::NONE,
        });
    }

    fn on_character_class_leave(&mut self, _start: u32, end: u32, _negate: bool) {
        let class = self.node;
        self.close(end);
        if let Some(node) = self.get_mut(class)
            && let Data::CharacterClass {
                negate, expression, ..
            } = node.data
            && expression != NodeId::NONE
        {
            node.data = Data::ExpressionCharacterClass { negate, expression };
        }
    }

    fn on_character_class_range(&mut self, start: u32, end: u32, _min: u32, _max: u32) {
        let Some(Data::CharacterClass { unicode_sets, .. }) = self.data(self.node) else {
            return;
        };
        let Some(max) = self.pop_child() else { return };
        if !unicode_sets {
            self.pop_child();
        }
        let Some(min) = self.pop_child() else { return };
        let id = self.leaf(Data::CharacterClassRange { min, max }, start, end);
        self.set_parent(min, id);
        self.set_parent(max, id);
    }

    fn on_class_intersection(&mut self, start: u32, end: u32) {
        self.class_operation(start, end, |left, right| Data::ClassIntersection {
            left,
            right,
        });
    }

    fn on_class_subtraction(&mut self, start: u32, end: u32) {
        self.class_operation(start, end, |left, right| Data::ClassSubtraction {
            left,
            right,
        });
    }

    fn on_class_string_disjunction_enter(&mut self, start: u32) {
        self.open(start, |alternatives| Data::ClassStringDisjunction {
            alternatives,
        });
    }

    fn on_class_string_disjunction_leave(&mut self, _start: u32, end: u32) {
        self.close(end);
    }

    fn on_string_alternative_enter(&mut self, start: u32, _index: u32) {
        self.open(start, |elements| Data::StringAlternative { elements });
    }

    fn on_string_alternative_leave(&mut self, _start: u32, end: u32, _index: u32) {
        self.close(end);
    }
}
