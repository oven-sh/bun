// What the JavaScript step reads and copies of a tree under construction: the members of a node by their name in ast.json, internal/ast/deepclone.go, and the predicates of internal/ast/utilities.go that upstream's reparser calls.
use crate::ast::{
    FileBuilder, JSDeclarationKind, Kind, MemberValue, ModifierListId, NodeFlags, NodeId,
    NodeListId, NodeSink, SlotType, is_assignment_operator,
};
use crate::core::TextRange;
use crate::internal::{Fault, FaultKind};

// What the step does where upstream panics: the message is recorded with the kind of the node.
#[cold]
pub(crate) fn unhandled(b: &FileBuilder, message: &'static str, node: NodeId) {
    b.faults.record(Fault {
        kind: FaultKind::Panic,
        message,
        detail: b.kind(node) as u32,
        id: node.0,
    });
}

// Go stacks grow: a function that calls itself as deep as the tree ends here with an internal diagnostic when the thread has no stack left.
#[cold]
pub(crate) fn stack_limit(b: &FileBuilder, node: NodeId) {
    b.faults.record(Fault {
        kind: FaultKind::StackLimit,
        message: "stack limit reached",
        detail: 0,
        id: node.0,
    });
}

// A member that holds a node: nil when the definition of the node has no such member.
pub(crate) fn node_member(b: &FileBuilder, node: NodeId, member: &[u8]) -> NodeId {
    match b.member(node, member) {
        Some(MemberValue::Node(child)) => child,
        _ => NodeId::NIL,
    }
}

// A member that holds a list of nodes: the nil list when the definition of the node has no such member.
pub(crate) fn list_member(b: &FileBuilder, node: NodeId, member: &[u8]) -> NodeListId {
    match b.member(node, member) {
        Some(MemberValue::List(list)) => list,
        _ => NodeListId::NIL,
    }
}

pub(crate) fn text_member<'b>(b: &'b FileBuilder, node: NodeId, member: &[u8]) -> &'b [u8] {
    match b.member(node, member) {
        Some(MemberValue::Text(text)) => text,
        _ => &[],
    }
}

pub(crate) fn bool_member(b: &FileBuilder, node: NodeId, member: &[u8]) -> bool {
    matches!(b.member(node, member), Some(MemberValue::Bool(true)))
}

pub(crate) fn kind_member(b: &FileBuilder, node: NodeId, member: &[u8]) -> Kind {
    match b.member(node, member) {
        Some(MemberValue::Kind(kind)) => kind,
        _ => Kind::Unknown,
    }
}

// `node.<member> = value` of a member that holds a node.
pub(crate) fn set_node_member(b: &mut FileBuilder, node: NodeId, member: &[u8], value: NodeId) {
    b.set_member(node, member, MemberValue::Node(value));
}

// `node.<member> = list` of a member that holds a list of nodes.
pub(crate) fn set_list_member(b: &mut FileBuilder, node: NodeId, member: &[u8], value: NodeListId) {
    b.set_member(node, member, MemberValue::List(value));
}

// Node.Text
pub(crate) fn text(b: &FileBuilder, node: NodeId) -> &[u8] {
    text_member(b, node, b"Text")
}

// Node.Name
pub(crate) fn name(b: &FileBuilder, node: NodeId) -> NodeId {
    node_member(b, node, b"name")
}

// Node.Expression
pub(crate) fn expression(b: &FileBuilder, node: NodeId) -> NodeId {
    node_member(b, node, b"Expression")
}

// Node.Type
pub(crate) fn type_node(b: &FileBuilder, node: NodeId) -> NodeId {
    node_member(b, node, b"Type")
}

// Node.Initializer
pub(crate) fn initializer(b: &FileBuilder, node: NodeId) -> NodeId {
    node_member(b, node, b"Initializer")
}

// Node.TypeExpression
pub(crate) fn type_expression(b: &FileBuilder, node: NodeId) -> NodeId {
    node_member(b, node, b"TypeExpression")
}

// Node.TagName
pub(crate) fn tag_name(b: &FileBuilder, node: NodeId) -> NodeId {
    node_member(b, node, b"TagName")
}

// Node.Modifiers
pub(crate) fn modifiers(b: &FileBuilder, node: NodeId) -> ModifierListId {
    ModifierListId(list_member(b, node, b"modifiers").0)
}

// Node.ModifierNodes
pub(crate) fn modifier_nodes(b: &FileBuilder, node: NodeId) -> &[NodeId] {
    b.list_nodes(list_member(b, node, b"modifiers"))
}

// Node.ParameterList
pub(crate) fn parameter_list(b: &FileBuilder, node: NodeId) -> NodeListId {
    list_member(b, node, b"Parameters")
}

// Node.TypeParameterList
pub(crate) fn type_parameter_list(b: &FileBuilder, node: NodeId) -> NodeListId {
    list_member(b, node, b"TypeParameters")
}

// `node.FunctionLikeData().FullSignature`
pub(crate) fn full_signature(b: &FileBuilder, node: NodeId) -> NodeId {
    node_member(b, node, b"FullSignature")
}

// The children of a node in the order of ForEachChild.
pub(crate) fn children(b: &FileBuilder, node: NodeId, out: &mut Vec<NodeId>) {
    let info = b.def(node).info();
    // forEachChild_JSDocParameterOrPropertyTag: the name comes before the type when IsNameFirst is set.
    let name_first = !info.children_alt.is_empty() && bool_member(b, node, b"IsNameFirst");
    let layout = if name_first {
        info.children_alt
    } else {
        info.children
    };
    for slot in layout {
        let word = b.slot(node, *slot);
        if word == 0 {
            continue;
        }
        match info.slots.get(usize::from(*slot)) {
            Some(member) if member.ty.is_list() => {
                out.extend_from_slice(b.list_nodes(NodeListId(word)));
            }
            Some(_) => out.push(NodeId(word)),
            None => {}
        }
    }
}

// One member of a node that holds a node or a list of nodes.
#[derive(Clone, Copy)]
pub(crate) struct ChildMember {
    pub(crate) name: &'static str,
    // The word of the slot: the id of the node or of the list.
    pub(crate) word: u32,
    pub(crate) is_list: bool,
}

// The members of a node that hold a node or a list, in the order in which upstream's parser reads them: by position, members at the same position in the order of the struct.
pub(crate) fn members_in_source_order(b: &FileBuilder, node: NodeId, out: &mut Vec<ChildMember>) {
    let info = b.def(node).info();
    let mut keyed: Vec<(i32, ChildMember)> = Vec::new();
    for (index, member) in info.slots.iter().enumerate() {
        let is_list = member.ty.is_list();
        if !is_list && !member.ty.is_node() {
            continue;
        }
        let Ok(slot) = u8::try_from(index) else {
            continue;
        };
        let word = b.slot(node, slot);
        if word == 0 {
            continue;
        }
        let pos = if is_list {
            let list = NodeListId(word);
            match b.list_nodes(list).first() {
                Some(first) => b.loc(*first).pos(),
                None => b.list_loc(list).pos(),
            }
        } else {
            b.loc(NodeId(word)).pos()
        };
        let child = ChildMember {
            name: member.name,
            word,
            is_list,
        };
        keyed.push((pos, child));
    }
    keyed.sort_by_key(|entry| entry.0);
    out.extend(keyed.iter().map(|entry| entry.1));
}

// A list with these nodes in the place of `list`, with its range.
pub(crate) fn replace_list_nodes(
    b: &mut FileBuilder,
    owner: NodeId,
    member: &[u8],
    list: NodeListId,
    nodes: &[NodeId],
) {
    let loc = b.list_loc(list);
    let replaced = b.new_node_list(nodes);
    b.set_list_loc(replaced, loc);
    set_list_member(b, owner, member, replaced);
}

// The copy that getDeepCloneVisitor makes without synthetic locations: the node and everything that VisitEachChild visits under it, each with the flags and the range of its original.
fn deep_clone(b: &mut FileBuilder, node: NodeId) -> NodeId {
    let root = b.clone_node(node);
    let mut pending = vec![root];
    let mut items: Vec<NodeId> = Vec::new();
    while let Some(clone) = pending.pop() {
        let def = b.def(clone);
        let info = def.info();
        for slot in info.children {
            let word = b.slot(clone, *slot);
            if word == 0 {
                continue;
            }
            let Some(member) = info.slots.get(usize::from(*slot)) else {
                continue;
            };
            let copy = match member.ty {
                SlotType::Node => {
                    let child = b.clone_node(NodeId(word));
                    pending.push(child);
                    child.0
                }
                SlotType::NodeList | SlotType::RawNodeList | SlotType::ModifierList => {
                    let list = NodeListId(word);
                    items.clear();
                    items.extend_from_slice(b.list_nodes(list));
                    for item in &mut items {
                        *item = b.clone_node(*item);
                    }
                    pending.extend_from_slice(&items);
                    let loc = b.list_loc(list);
                    let copy = if member.ty == SlotType::ModifierList {
                        b.new_modifier_list(&items).as_node_list()
                    } else {
                        b.new_node_list(&items)
                    };
                    b.set_list_loc(copy, loc);
                    copy.0
                }
                _ => continue,
            };
            b.set_slot(clone, def, *slot, copy);
        }
    }
    root
}

// NodeFactory.DeepCloneReparse. SetParentInChildren has nothing to do: `finish` gives every node of the copy the parent that holds it.
pub(crate) fn deep_clone_reparse(b: &mut FileBuilder, node: NodeId) -> NodeId {
    if node.is_nil() {
        return NodeId::NIL;
    }
    let clone = deep_clone(b, node);
    let flags = b.flags(clone) | NodeFlags::REPARSED;
    b.set_flags(clone, flags);
    clone
}

// NodeFactory.DeepCloneReparseModifiers
pub(crate) fn deep_clone_reparse_modifiers(
    b: &mut FileBuilder,
    modifiers: ModifierListId,
) -> ModifierListId {
    if modifiers.is_nil() {
        return ModifierListId::NIL;
    }
    let list = modifiers.as_node_list();
    let mut nodes = b.list_nodes(list).to_vec();
    for node in &mut nodes {
        *node = deep_clone(b, *node);
    }
    let loc = b.list_loc(list);
    let clone = b.new_modifier_list(&nodes);
    b.set_list_loc(clone.as_node_list(), loc);
    clone
}

// ast.IsInJSFile
pub(crate) fn is_in_js_file(b: &FileBuilder, node: NodeId) -> bool {
    !node.is_nil() && b.flags(node).intersects(NodeFlags::JAVA_SCRIPT_FILE)
}

// ast.IsAccessExpression
pub(crate) fn is_access_expression(b: &FileBuilder, node: NodeId) -> bool {
    let kind = b.kind(node);
    kind == Kind::PropertyAccessExpression || kind == Kind::ElementAccessExpression
}

// ast.IsStringOrNumericLiteralLike
pub(crate) fn is_string_or_numeric_literal_like(b: &FileBuilder, node: NodeId) -> bool {
    matches!(
        b.kind(node),
        Kind::StringLiteral | Kind::NoSubstitutionTemplateLiteral | Kind::NumericLiteral
    )
}

// ast.SkipParentheses
pub(crate) fn skip_parentheses(b: &FileBuilder, node: NodeId) -> NodeId {
    let mut node = node;
    while b.kind(node) == Kind::ParenthesizedExpression {
        node = expression(b, node);
    }
    node
}

// ast.IsModuleIdentifier
pub(crate) fn is_module_identifier(b: &FileBuilder, node: NodeId) -> bool {
    b.kind(node) == Kind::Identifier && text(b, node) == b"module"
}

// ast.IsExportsIdentifier
pub(crate) fn is_exports_identifier(b: &FileBuilder, node: NodeId) -> bool {
    b.kind(node) == Kind::Identifier && text(b, node) == b"exports"
}

// ast.IsThisIdentifier
pub(crate) fn is_this_identifier(b: &FileBuilder, node: NodeId) -> bool {
    b.kind(node) == Kind::Identifier && text(b, node) == b"this"
}

// ast.GetElementOrPropertyAccessName
pub(crate) fn get_element_or_property_access_name(b: &FileBuilder, node: NodeId) -> NodeId {
    match b.kind(node) {
        Kind::PropertyAccessExpression => {
            let name = name(b, node);
            if b.kind(name) == Kind::Identifier {
                return name;
            }
            NodeId::NIL
        }
        Kind::ElementAccessExpression => {
            let arg = skip_parentheses(b, node_member(b, node, b"ArgumentExpression"));
            if is_string_or_numeric_literal_like(b, arg) {
                return arg;
            }
            NodeId::NIL
        }
        _ => {
            unhandled(b, "Unhandled case in GetElementOrPropertyAccessName", node);
            NodeId::NIL
        }
    }
}

// ast.IsModuleExportsAccessExpression
pub(crate) fn is_module_exports_access_expression(b: &FileBuilder, node: NodeId) -> bool {
    if is_access_expression(b, node) && is_module_identifier(b, expression(b, node)) {
        let name = get_element_or_property_access_name(b, node);
        if !name.is_nil() {
            return text(b, name) == b"exports";
        }
    }
    false
}

// ast.IsEntityNameExpressionEx with IsPropertyAccessEntityNameExpression and isElementAccessEntityNameExpression, as a loop over the chain of the expressions.
pub(crate) fn is_entity_name_expression_ex(b: &FileBuilder, node: NodeId, allow_js: bool) -> bool {
    let mut node = node;
    loop {
        match b.kind(node) {
            Kind::Identifier => return true,
            Kind::PropertyAccessExpression if b.kind(name(b, node)) == Kind::Identifier => {
                node = expression(b, node);
            }
            Kind::ThisKeyword if allow_js => return true,
            Kind::ElementAccessExpression
                if allow_js
                    && is_string_or_numeric_literal_like(
                        b,
                        node_member(b, node, b"ArgumentExpression"),
                    ) =>
            {
                node = expression(b, node);
            }
            _ => return false,
        }
    }
}

// ast.GetAssignmentDeclarationKind of a binary expression, the one kind of node that the reparser asks about.
pub(crate) fn get_assignment_declaration_kind(b: &FileBuilder, node: NodeId) -> JSDeclarationKind {
    if b.kind(node) != Kind::BinaryExpression {
        return JSDeclarationKind::NONE;
    }
    let left = node_member(b, node, b"Left");
    let right = node_member(b, node, b"Right");
    let operator = b.kind(node_member(b, node, b"OperatorToken"));
    if operator == Kind::EqualsToken && is_access_expression(b, left) {
        let left_expression = expression(b, left);
        if is_in_js_file(b, left) {
            if is_module_exports_access_expression(b, left) && !is_exports_identifier(b, right) {
                return JSDeclarationKind::MODULE_EXPORTS;
            }
            if (is_module_exports_access_expression(b, left_expression)
                || is_exports_identifier(b, left_expression))
                && !get_element_or_property_access_name(b, left).is_nil()
            {
                return JSDeclarationKind::EXPORTS_PROPERTY;
            }
            if b.kind(left_expression) == Kind::ThisKeyword {
                return JSDeclarationKind::THIS_PROPERTY;
            }
        }
        let allow_js = is_in_js_file(b, left);
        if (b.kind(left) == Kind::PropertyAccessExpression
            && is_entity_name_expression_ex(b, left_expression, allow_js)
            && b.kind(name(b, left)) == Kind::Identifier)
            || (b.kind(left) == Kind::ElementAccessExpression
                && is_entity_name_expression_ex(b, left_expression, allow_js))
        {
            return JSDeclarationKind::PROPERTY;
        }
    }
    JSDeclarationKind::NONE
}

// isLeftHandSideExpressionKind
fn is_left_hand_side_expression_kind(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::PropertyAccessExpression
            | Kind::ElementAccessExpression
            | Kind::NewExpression
            | Kind::CallExpression
            | Kind::JsxElement
            | Kind::JsxSelfClosingElement
            | Kind::JsxFragment
            | Kind::TaggedTemplateExpression
            | Kind::ArrayLiteralExpression
            | Kind::ParenthesizedExpression
            | Kind::ObjectLiteralExpression
            | Kind::ClassExpression
            | Kind::FunctionExpression
            | Kind::Identifier
            | Kind::PrivateIdentifier
            | Kind::RegularExpressionLiteral
            | Kind::NumericLiteral
            | Kind::BigIntLiteral
            | Kind::StringLiteral
            | Kind::NoSubstitutionTemplateLiteral
            | Kind::TemplateExpression
            | Kind::FalseKeyword
            | Kind::NullKeyword
            | Kind::ThisKeyword
            | Kind::TrueKeyword
            | Kind::SuperKeyword
            | Kind::NonNullExpression
            | Kind::ExpressionWithTypeArguments
            | Kind::MetaProperty
            | Kind::ImportKeyword
            | Kind::MissingDeclaration
    )
}

// ast.GetRightMostAssignedExpression: IsAssignmentExpression with the compound assignments included.
pub(crate) fn get_right_most_assigned_expression(b: &FileBuilder, node: NodeId) -> NodeId {
    let mut node = node;
    while b.kind(node) == Kind::BinaryExpression
        && is_assignment_operator(b.kind(node_member(b, node, b"OperatorToken")))
        && is_left_hand_side_expression_kind(b.kind(node_member(b, node, b"Left")))
    {
        node = node_member(b, node, b"Right");
    }
    node
}

// ast.HasSamePropertyAccessName, as a loop over the two chains.
pub(crate) fn has_same_property_access_name(b: &FileBuilder, node1: NodeId, node2: NodeId) -> bool {
    let (mut node1, mut node2) = (node1, node2);
    loop {
        let (kind1, kind2) = (b.kind(node1), b.kind(node2));
        if kind1 == Kind::Identifier && kind2 == Kind::Identifier {
            return text(b, node1) == text(b, node2);
        }
        if kind1 != Kind::PropertyAccessExpression || kind2 != Kind::PropertyAccessExpression {
            return false;
        }
        if text(b, name(b, node1)) != text(b, name(b, node2)) {
            return false;
        }
        node1 = expression(b, node1);
        node2 = expression(b, node2);
    }
}

// isAnExternalModuleIndicatorNode
fn is_an_external_module_indicator_node(b: &FileBuilder, node: NodeId) -> bool {
    let has_export_modifier = modifier_nodes(b, node)
        .iter()
        .any(|modifier| b.kind(*modifier) == Kind::ExportKeyword);
    let kind = b.kind(node);
    has_export_modifier
        || (kind == Kind::ImportEqualsDeclaration
            && b.kind(node_member(b, node, b"ModuleReference")) == Kind::ExternalModuleReference)
        || kind == Kind::ImportDeclaration
        || kind == Kind::ExportAssignment
        || kind == Kind::ExportDeclaration
}

// The loop of isFileProbablyExternalModule: the first statement that makes the file a module, nil when there is none.
pub(crate) fn first_external_module_indicator_statement(
    b: &FileBuilder,
    source_file: NodeId,
) -> NodeId {
    b.list_nodes(list_member(b, source_file, b"Statements"))
        .iter()
        .copied()
        .find(|statement| is_an_external_module_indicator_node(b, *statement))
        .unwrap_or(NodeId::NIL)
}

// core.CompareTextRanges of the ranges of two nodes below zero, which is how a sort asks ast.CompareNodePositions.
pub(crate) fn node_position_is_less(b: &FileBuilder, n1: NodeId, n2: NodeId) -> bool {
    let key = |loc: TextRange| (loc.pos(), loc.end());
    key(b.loc(n1)) < key(b.loc(n2))
}

// slices.SortFunc of Go 1.26 (slices/zsortanyfunc.go): a pattern-defeating quicksort, which is not stable, so the order that it leaves equal elements in is part of what upstream computes.
pub(crate) mod slices {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum SortedHint {
        Unknown,
        Increasing,
        Decreasing,
    }

    struct Sorter<'d, E> {
        data: &'d mut [E],
        is_less: &'d mut dyn FnMut(E, E) -> bool,
    }

    impl<E: Copy> Sorter<'_, E> {
        // `cmp(data[i], data[j]) < 0`
        fn less(&mut self, i: isize, j: isize) -> bool {
            let at = |index: isize| usize::try_from(index).ok();
            let (Some(i), Some(j)) = (at(i), at(j)) else {
                return false;
            };
            match (self.data.get(i), self.data.get(j)) {
                (Some(a), Some(b)) => (self.is_less)(*a, *b),
                _ => false,
            }
        }

        // `data[i], data[j] = data[j], data[i]`
        fn swap(&mut self, i: isize, j: isize) {
            if let (Ok(i), Ok(j)) = (usize::try_from(i), usize::try_from(j)) {
                if i < self.data.len() && j < self.data.len() {
                    self.data.swap(i, j);
                }
            }
        }

        // insertionSortCmpFunc sorts data[a:b] using insertion sort.
        fn insertion_sort(&mut self, a: isize, b: isize) {
            for i in a + 1..b {
                let mut j = i;
                while j > a && self.less(j, j - 1) {
                    self.swap(j, j - 1);
                    j -= 1;
                }
            }
        }

        // siftDownCmpFunc implements the heap property on data[lo:hi]. first is an offset into the array where the root of the heap lies.
        fn sift_down(&mut self, lo: isize, hi: isize, first: isize) {
            let mut root = lo;
            loop {
                let mut child = 2 * root + 1;
                if child >= hi {
                    break;
                }
                if child + 1 < hi && self.less(first + child, first + child + 1) {
                    child += 1;
                }
                if !self.less(first + root, first + child) {
                    return;
                }
                self.swap(first + root, first + child);
                root = child;
            }
        }

        fn heap_sort(&mut self, a: isize, b: isize) {
            let first = a;
            let lo = 0;
            let hi = b - a;
            // Build heap with greatest element at top.
            let mut i = (hi - 1) / 2;
            while i >= 0 {
                self.sift_down(i, hi, first);
                i -= 1;
            }
            // Pop elements, largest first, into end of data.
            let mut i = hi - 1;
            while i >= 0 {
                self.swap(first, first + i);
                self.sift_down(lo, i, first);
                i -= 1;
            }
        }

        // pdqsortCmpFunc sorts data[a:b]. limit is the number of allowed bad (very unbalanced) pivots before falling back to heapsort.
        fn pdqsort(&mut self, a: isize, b: isize, limit: isize) {
            const MAX_INSERTION: isize = 12;
            let (mut a, mut b, mut limit) = (a, b, limit);
            // whether the last partitioning was reasonably balanced
            let mut was_balanced = true;
            // whether the slice was already partitioned
            let mut was_partitioned = true;
            loop {
                let length = b - a;
                if length <= MAX_INSERTION {
                    self.insertion_sort(a, b);
                    return;
                }
                // Fall back to heapsort if too many bad choices were made.
                if limit == 0 {
                    self.heap_sort(a, b);
                    return;
                }
                // If the last partitioning was imbalanced, we need to breakPatterns.
                if !was_balanced {
                    self.break_patterns(a, b);
                    limit -= 1;
                }
                let (mut pivot, mut hint) = self.choose_pivot(a, b);
                if hint == SortedHint::Decreasing {
                    self.reverse_range(a, b);
                    // The chosen pivot was pivot-a elements after the start of the array. After reversing it is pivot-a elements before the end of the array.
                    pivot = (b - 1) - (pivot - a);
                    hint = SortedHint::Increasing;
                }
                // The slice is likely already sorted.
                if was_balanced
                    && was_partitioned
                    && hint == SortedHint::Increasing
                    && self.partial_insertion_sort(a, b)
                {
                    return;
                }
                // Probably the slice contains many duplicate elements, partition the slice into elements equal to and elements greater than the pivot.
                if a > 0 && !self.less(a - 1, pivot) {
                    let mid = self.partition_equal(a, b, pivot);
                    a = mid;
                    continue;
                }
                let (mid, already_partitioned) = self.partition(a, b, pivot);
                was_partitioned = already_partitioned;
                let (left_len, right_len) = (mid - a, b - mid);
                let balance_threshold = length / 8;
                if left_len < right_len {
                    was_balanced = left_len >= balance_threshold;
                    self.pdqsort(a, mid, limit);
                    a = mid + 1;
                } else {
                    was_balanced = right_len >= balance_threshold;
                    self.pdqsort(mid + 1, b, limit);
                    b = mid;
                }
            }
        }

        // partitionCmpFunc does one quicksort partition. On return, data[newpivot] = p, data[a:newpivot] < p and data[newpivot+1:b] >= p.
        fn partition(&mut self, a: isize, b: isize, pivot: isize) -> (isize, bool) {
            self.swap(a, pivot);
            // i and j are inclusive of the elements remaining to be partitioned
            let (mut i, mut j) = (a + 1, b - 1);
            while i <= j && self.less(i, a) {
                i += 1;
            }
            while i <= j && !self.less(j, a) {
                j -= 1;
            }
            if i > j {
                self.swap(j, a);
                return (j, true);
            }
            self.swap(i, j);
            i += 1;
            j -= 1;
            loop {
                while i <= j && self.less(i, a) {
                    i += 1;
                }
                while i <= j && !self.less(j, a) {
                    j -= 1;
                }
                if i > j {
                    break;
                }
                self.swap(i, j);
                i += 1;
                j -= 1;
            }
            self.swap(j, a);
            (j, false)
        }

        // partitionEqualCmpFunc partitions data[a:b] into elements equal to data[pivot] followed by elements greater than data[pivot].
        fn partition_equal(&mut self, a: isize, b: isize, pivot: isize) -> isize {
            self.swap(a, pivot);
            // i and j are inclusive of the elements remaining to be partitioned
            let (mut i, mut j) = (a + 1, b - 1);
            loop {
                while i <= j && !self.less(a, i) {
                    i += 1;
                }
                while i <= j && self.less(a, j) {
                    j -= 1;
                }
                if i > j {
                    break;
                }
                self.swap(i, j);
                i += 1;
                j -= 1;
            }
            i
        }

        // partialInsertionSortCmpFunc partially sorts a slice, returns true if the slice is sorted at the end.
        fn partial_insertion_sort(&mut self, a: isize, b: isize) -> bool {
            // maximum number of adjacent out-of-order pairs that will get shifted
            const MAX_STEPS: isize = 5;
            // don't shift any elements on short arrays
            const SHORTEST_SHIFTING: isize = 50;
            let mut i = a + 1;
            for _ in 0..MAX_STEPS {
                while i < b && !self.less(i, i - 1) {
                    i += 1;
                }
                if i == b {
                    return true;
                }
                if b - a < SHORTEST_SHIFTING {
                    return false;
                }
                self.swap(i, i - 1);
                // Shift the smaller one to the left.
                if i - a >= 2 {
                    let mut j = i - 1;
                    while j >= 1 {
                        if !self.less(j, j - 1) {
                            break;
                        }
                        self.swap(j, j - 1);
                        j -= 1;
                    }
                }
                // Shift the greater one to the right.
                if b - i >= 2 {
                    for j in i + 1..b {
                        if !self.less(j, j - 1) {
                            break;
                        }
                        self.swap(j, j - 1);
                    }
                }
            }
            false
        }

        // breakPatternsCmpFunc scatters some elements around in an attempt to break some patterns that might cause imbalanced partitions in quicksort.
        fn break_patterns(&mut self, a: isize, b: isize) {
            let length = b - a;
            if length >= 8 {
                let mut random = length as u64;
                let modulus = 1u64 << bits_len(length);
                let idx_first = a + (length / 4) * 2 - 1;
                for idx in idx_first..=a + (length / 4) * 2 + 1 {
                    // xorshift.Next
                    random ^= random << 13;
                    random ^= random >> 7;
                    random ^= random << 17;
                    let mut other = (random & (modulus - 1)) as isize;
                    if other >= length {
                        other -= length;
                    }
                    self.swap(idx, a + other);
                }
            }
        }

        // choosePivotCmpFunc chooses a pivot in data[a:b]. [0,8): chooses a static pivot. [8,shortestNinther): uses the simple median-of-three method. [shortestNinther,∞): uses the Tukey ninther method.
        fn choose_pivot(&mut self, a: isize, b: isize) -> (isize, SortedHint) {
            const SHORTEST_NINTHER: isize = 50;
            const MAX_SWAPS: isize = 4 * 3;
            let l = b - a;
            let mut swaps = 0;
            let mut i = a + l / 4;
            let mut j = a + l / 4 * 2;
            let mut k = a + l / 4 * 3;
            if l >= 8 {
                if l >= SHORTEST_NINTHER {
                    // Tukey ninther method, the idea came from Rust's implementation.
                    i = self.median_adjacent(i, &mut swaps);
                    j = self.median_adjacent(j, &mut swaps);
                    k = self.median_adjacent(k, &mut swaps);
                }
                // Find the median among i, j, k and stores it into j.
                j = self.median(i, j, k, &mut swaps);
            }
            match swaps {
                0 => (j, SortedHint::Increasing),
                MAX_SWAPS => (j, SortedHint::Decreasing),
                _ => (j, SortedHint::Unknown),
            }
        }

        // order2CmpFunc returns x,y where data[x] <= data[y], where x,y=a,b or x,y=b,a.
        fn order2(&mut self, a: isize, b: isize, swaps: &mut isize) -> (isize, isize) {
            if self.less(b, a) {
                *swaps += 1;
                return (b, a);
            }
            (a, b)
        }

        // medianCmpFunc returns x where data[x] is the median of data[a],data[b],data[c], where x is a, b, or c.
        fn median(&mut self, a: isize, b: isize, c: isize, swaps: &mut isize) -> isize {
            let (a, b) = self.order2(a, b, swaps);
            let (b, _) = self.order2(b, c, swaps);
            let (_, b) = self.order2(a, b, swaps);
            b
        }

        // medianAdjacentCmpFunc finds the median of data[a - 1], data[a], data[a + 1] and stores the index into a.
        fn median_adjacent(&mut self, a: isize, swaps: &mut isize) -> isize {
            self.median(a - 1, a, a + 1, swaps)
        }

        fn reverse_range(&mut self, a: isize, b: isize) {
            let mut i = a;
            let mut j = b - 1;
            while i < j {
                self.swap(i, j);
                i += 1;
                j -= 1;
            }
        }
    }

    // bits.Len
    fn bits_len(n: isize) -> u32 {
        usize::BITS - (n as usize).leading_zeros()
    }

    // slices.SortFunc with `cmp(a, b) < 0` as the comparison.
    pub(crate) fn sort_func<E: Copy>(x: &mut [E], is_less: &mut dyn FnMut(E, E) -> bool) {
        let n = x.len() as isize;
        let mut sorter = Sorter { data: x, is_less };
        sorter.pdqsort(0, n, bits_len(n) as isize);
    }
}

#[cfg(test)]
mod tests {
    use super::slices::sort_func;

    // Each line of the vectors: the length, the number of keys, the shape of the input, and a digest of the order that Go's slices.SortFunc leaves (testdata/go_sort_func.txt, Go 1.26).
    #[test]
    fn sort_func_leaves_the_order_of_go() {
        let mut state: u64 = 12345;
        let mut next = || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            state >> 33
        };
        let vectors = include_bytes!("testdata/go_sort_func.txt");
        let mut lines = 0;
        for line in vectors.split(|byte| *byte == b'\n') {
            let mut fields = line.split(|byte| *byte == b' ').map(|field| {
                field
                    .iter()
                    .fold(0u64, |value, digit| value * 10 + u64::from(digit - b'0'))
            });
            let (Some(n), Some(keys), Some(shape), Some(digest)) =
                (fields.next(), fields.next(), fields.next(), fields.next())
            else {
                continue;
            };
            lines += 1;
            let mut data: Vec<(u64, u64)> = Vec::new();
            for i in 0..n {
                let mut key = next() % keys;
                if shape == 1 {
                    key = i * keys / (n + 1);
                } else if shape == 2 {
                    key = (n - i) * keys / (n + 1);
                }
                data.push((key, i));
            }
            sort_func(&mut data, &mut |a, b| a.0 < b.0);
            let mut sum: u64 = 1469598103934665603;
            for element in &data {
                sum = (sum ^ element.1).wrapping_mul(1099511628211);
            }
            assert_eq!(sum, digest, "n={n} keys={keys} shape={shape}");
        }
        assert_eq!(lines, 210);
    }
}
