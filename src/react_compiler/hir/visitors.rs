/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
use crate::collections::FxHashMap as HashMap;
use core::slice;
use smallvec::SmallVec;

use crate::hir::environment::Environment;
use crate::hir::{
    ArrayElement, ArrayPatternElement, AstAlloc, BasicBlock, BlockId, Case, HirFunction,
    IdentifierId, Instruction, InstructionValue, JsxAttribute, JsxTag, ManualMemoDependency,
    ManualMemoDependencyRoot, ObjectPropertyKey, ObjectPropertyOrSpread, Pattern, Place,
    PlaceOrSpread, ScopeId, Terminal,
};

// =============================================================================
// Borrowing iterators (no allocation, no clone)
// =============================================================================

/// Places of an instruction, a pattern or a terminal, in upstream's order.
pub struct PlaceIter<'a> {
    first: [Option<&'a Place>; 3],
    at: usize,
    rest: Rest<'a>,
}

enum Rest<'a> {
    None,
    Places(slice::Iter<'a, Place>),
    Arguments(slice::Iter<'a, PlaceOrSpread>),
    Jsx(slice::Iter<'a, JsxAttribute>, slice::Iter<'a, Place>),
    /// The place of a property whose computed key was yielded last comes first.
    Properties(slice::Iter<'a, ObjectPropertyOrSpread>, Option<&'a Place>),
    Elements(slice::Iter<'a, ArrayElement>),
    Dependencies(slice::Iter<'a, ManualMemoDependency>),
    ArrayPattern(slice::Iter<'a, ArrayPatternElement>),
    ObjectPattern(slice::Iter<'a, ObjectPropertyOrSpread>),
    Cases(slice::Iter<'a, Case>),
}

impl<'a> PlaceIter<'a> {
    #[inline]
    fn new<const N: usize>(first: [&'a Place; N], rest: Rest<'a>) -> Self {
        let mut slots = [None; 3];
        for (slot, place) in slots[3 - N..].iter_mut().zip(first) {
            *slot = Some(place);
        }
        PlaceIter {
            first: slots,
            at: 3 - N,
            rest,
        }
    }

    #[inline]
    fn of_pattern<const N: usize>(first: [&'a Place; N], pattern: &'a Pattern) -> Self {
        Self::new(
            first,
            match pattern {
                Pattern::Array(array) => Rest::ArrayPattern(array.items.iter()),
                Pattern::Object(object) => Rest::ObjectPattern(object.properties.iter()),
            },
        )
    }
}

impl<'a> Iterator for PlaceIter<'a> {
    type Item = &'a Place;

    #[inline]
    fn next(&mut self) -> Option<&'a Place> {
        if self.at < 3 {
            self.at += 1;
            return self.first[self.at - 1];
        }
        match &mut self.rest {
            Rest::None => None,
            Rest::Places(places) => places.next(),
            Rest::Arguments(arguments) => arguments.next().map(PlaceOrSpread::place),
            Rest::Jsx(attributes, children) => match attributes.next() {
                Some(JsxAttribute::Attribute { place, .. }) => Some(place),
                Some(JsxAttribute::SpreadAttribute { argument }) => Some(argument),
                None => children.next(),
            },
            Rest::Properties(properties, value) => {
                if let Some(value) = value.take() {
                    return Some(value);
                }
                match properties.next()? {
                    ObjectPropertyOrSpread::Property(property) => match &property.key {
                        ObjectPropertyKey::Computed { name } => {
                            *value = Some(&property.place);
                            Some(name)
                        }
                        _ => Some(&property.place),
                    },
                    ObjectPropertyOrSpread::Spread(spread) => Some(&spread.place),
                }
            }
            Rest::Elements(elements) => elements.find_map(ArrayElement::place),
            Rest::Dependencies(dependencies) => {
                dependencies.find_map(|dependency| match &dependency.root {
                    ManualMemoDependencyRoot::NamedLocal { value, .. } => Some(value),
                    ManualMemoDependencyRoot::Global { .. } => None,
                })
            }
            Rest::ArrayPattern(items) => items.find_map(ArrayPatternElement::place),
            Rest::ObjectPattern(properties) => properties.next().map(ObjectPropertyOrSpread::place),
            Rest::Cases(cases) => cases.find_map(|case| case.test.as_ref()),
        }
    }
}

/// `instr.lvalue`, then the value's lvalues.
/// Equivalent to TS `eachInstructionLValue`.
pub fn lvalues(instr: &Instruction) -> PlaceIter<'_> {
    match &instr.value {
        InstructionValue::DeclareContext { lvalue, .. }
        | InstructionValue::StoreContext { lvalue, .. }
        | InstructionValue::DeclareLocal { lvalue, .. }
        | InstructionValue::StoreLocal { lvalue, .. } => {
            PlaceIter::new([&instr.lvalue, &lvalue.place], Rest::None)
        }
        InstructionValue::Destructure { lvalue, .. } => {
            PlaceIter::of_pattern([&instr.lvalue], &lvalue.pattern)
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => {
            PlaceIter::new([&instr.lvalue, lvalue], Rest::None)
        }
        _ => PlaceIter::new([&instr.lvalue], Rest::None),
    }
}

/// The lvalues of DeclareLocal/StoreLocal/DeclareContext/StoreContext/Destructure/PostfixUpdate/PrefixUpdate.
/// Equivalent to TS `eachInstructionValueLValue`.
pub fn value_lvalues(value: &InstructionValue) -> PlaceIter<'_> {
    match value {
        InstructionValue::DeclareContext { lvalue, .. }
        | InstructionValue::StoreContext { lvalue, .. }
        | InstructionValue::DeclareLocal { lvalue, .. }
        | InstructionValue::StoreLocal { lvalue, .. } => {
            PlaceIter::new([&lvalue.place], Rest::None)
        }
        InstructionValue::Destructure { lvalue, .. } => PlaceIter::of_pattern([], &lvalue.pattern),
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => PlaceIter::new([lvalue], Rest::None),
        // All other variants have no lvalues
        InstructionValue::LoadLocal { .. }
        | InstructionValue::LoadContext { .. }
        | InstructionValue::Primitive { .. }
        | InstructionValue::JSXText { .. }
        | InstructionValue::BinaryExpression { .. }
        | InstructionValue::NewExpression { .. }
        | InstructionValue::CallExpression { .. }
        | InstructionValue::MethodCall { .. }
        | InstructionValue::UnaryExpression { .. }
        | InstructionValue::TypeCastExpression { .. }
        | InstructionValue::JsxExpression { .. }
        | InstructionValue::ObjectExpression { .. }
        | InstructionValue::ObjectMethod { .. }
        | InstructionValue::ArrayExpression { .. }
        | InstructionValue::JsxFragment { .. }
        | InstructionValue::RegExpLiteral { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::PropertyStore { .. }
        | InstructionValue::PropertyLoad { .. }
        | InstructionValue::PropertyDelete { .. }
        | InstructionValue::ComputedStore { .. }
        | InstructionValue::ComputedLoad { .. }
        | InstructionValue::ComputedDelete { .. }
        | InstructionValue::LoadGlobal { .. }
        | InstructionValue::StoreGlobal { .. }
        | InstructionValue::FunctionExpression { .. }
        | InstructionValue::TaggedTemplateExpression { .. }
        | InstructionValue::TemplateLiteral { .. }
        | InstructionValue::Await { .. }
        | InstructionValue::GetIterator { .. }
        | InstructionValue::IteratorNext { .. }
        | InstructionValue::NextPropertyOf { .. }
        | InstructionValue::Debugger { .. }
        | InstructionValue::StartMemoize { .. }
        | InstructionValue::FinishMemoize { .. }
        | InstructionValue::UnsupportedNode { .. } => PlaceIter::new([], Rest::None),
    }
}

/// The operands of a value. Those of a function are what it captures.
/// Equivalent to TS `eachInstructionValueOperand`.
pub fn operands<'a>(value: &'a InstructionValue, functions: &'a [HirFunction]) -> PlaceIter<'a> {
    match value {
        InstructionValue::NewExpression { callee, args, .. }
        | InstructionValue::CallExpression { callee, args, .. } => {
            PlaceIter::new([callee], Rest::Arguments(args.iter()))
        }
        InstructionValue::BinaryExpression { left, right, .. } => {
            PlaceIter::new([left, right], Rest::None)
        }
        InstructionValue::MethodCall {
            receiver,
            property,
            args,
            ..
        } => PlaceIter::new([receiver, property], Rest::Arguments(args.iter())),
        InstructionValue::LoadLocal { place, .. } | InstructionValue::LoadContext { place, .. } => {
            PlaceIter::new([place], Rest::None)
        }
        InstructionValue::StoreContext { lvalue, value, .. } => {
            PlaceIter::new([&lvalue.place, value], Rest::None)
        }
        InstructionValue::StoreLocal { value, .. }
        | InstructionValue::StoreGlobal { value, .. }
        | InstructionValue::Destructure { value, .. }
        | InstructionValue::UnaryExpression { value, .. }
        | InstructionValue::TypeCastExpression { value, .. }
        | InstructionValue::Await { value, .. }
        | InstructionValue::NextPropertyOf { value, .. }
        | InstructionValue::PostfixUpdate { value, .. }
        | InstructionValue::PrefixUpdate { value, .. } => PlaceIter::new([value], Rest::None),
        InstructionValue::PropertyLoad { object, .. }
        | InstructionValue::PropertyDelete { object, .. } => PlaceIter::new([object], Rest::None),
        InstructionValue::PropertyStore { object, value, .. } => {
            PlaceIter::new([object, value], Rest::None)
        }
        InstructionValue::ComputedLoad {
            object, property, ..
        }
        | InstructionValue::ComputedDelete {
            object, property, ..
        } => PlaceIter::new([object, property], Rest::None),
        InstructionValue::ComputedStore {
            object,
            property,
            value,
            ..
        } => PlaceIter::new([object, property, value], Rest::None),
        InstructionValue::JsxExpression {
            tag,
            props,
            children,
            ..
        } => {
            let children = children.as_ref().map_or(&[][..], |children| &children[..]);
            let rest = Rest::Jsx(props.iter(), children.iter());
            match tag {
                JsxTag::Place(place) => PlaceIter::new([place], rest),
                JsxTag::Builtin(_) => PlaceIter::new([], rest),
            }
        }
        InstructionValue::JsxFragment { children, .. } => {
            PlaceIter::new([], Rest::Places(children.iter()))
        }
        InstructionValue::ObjectExpression { properties, .. } => {
            PlaceIter::new([], Rest::Properties(properties.iter(), None))
        }
        InstructionValue::ArrayExpression { elements, .. } => {
            PlaceIter::new([], Rest::Elements(elements.iter()))
        }
        InstructionValue::ObjectMethod { lowered_func, .. }
        | InstructionValue::FunctionExpression { lowered_func, .. } => {
            let func = &functions[lowered_func.func.0 as usize];
            PlaceIter::new([], Rest::Places(func.context.iter()))
        }
        InstructionValue::TaggedTemplateExpression { tag, .. } => PlaceIter::new([tag], Rest::None),
        InstructionValue::TemplateLiteral { subexprs, .. } => {
            PlaceIter::new([], Rest::Places(subexprs.iter()))
        }
        InstructionValue::GetIterator { collection, .. } => {
            PlaceIter::new([collection], Rest::None)
        }
        InstructionValue::IteratorNext {
            iterator,
            collection,
            ..
        } => PlaceIter::new([iterator, collection], Rest::None),
        InstructionValue::StartMemoize { deps, .. } => {
            let deps = deps.as_ref().map_or(&[][..], |deps| &deps[..]);
            PlaceIter::new([], Rest::Dependencies(deps.iter()))
        }
        InstructionValue::FinishMemoize { decl, .. } => PlaceIter::new([decl], Rest::None),
        InstructionValue::DeclareContext { .. }
        | InstructionValue::DeclareLocal { .. }
        | InstructionValue::Debugger { .. }
        | InstructionValue::RegExpLiteral { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::LoadGlobal { .. }
        | InstructionValue::UnsupportedNode { .. }
        | InstructionValue::Primitive { .. }
        | InstructionValue::JSXText { .. } => PlaceIter::new([], Rest::None),
    }
}

/// The places of array/object patterns.
/// Equivalent to TS `eachPatternOperand`.
pub fn pattern_operands(pattern: &Pattern) -> PlaceIter<'_> {
    PlaceIter::of_pattern([], pattern)
}

/// The places used by a terminal.
/// Equivalent to TS `eachTerminalOperand`.
pub fn terminal_operands(terminal: &Terminal) -> PlaceIter<'_> {
    match terminal {
        Terminal::If { test, .. } | Terminal::Branch { test, .. } => {
            PlaceIter::new([test], Rest::None)
        }
        Terminal::Switch { test, cases, .. } => PlaceIter::new([test], Rest::Cases(cases.iter())),
        Terminal::Return { value, .. } | Terminal::Throw { value, .. } => {
            PlaceIter::new([value], Rest::None)
        }
        Terminal::Try {
            handler_binding: Some(binding),
            ..
        } => PlaceIter::new([binding], Rest::None),
        Terminal::Try { .. }
        | Terminal::MaybeThrow { .. }
        | Terminal::Sequence { .. }
        | Terminal::Label { .. }
        | Terminal::Optional { .. }
        | Terminal::Ternary { .. }
        | Terminal::Logical { .. }
        | Terminal::DoWhile { .. }
        | Terminal::While { .. }
        | Terminal::For { .. }
        | Terminal::ForOf { .. }
        | Terminal::ForIn { .. }
        | Terminal::Goto { .. }
        | Terminal::Unreachable { .. }
        | Terminal::Unsupported { .. }
        | Terminal::Scope { .. }
        | Terminal::PrunedScope { .. } => PlaceIter::new([], Rest::None),
    }
}

// =============================================================================
// Iterator functions (return Vec instead of generators)
// =============================================================================

/// An instruction seldom has more.
pub type Places = SmallVec<[Place; 4]>;
pub type Ids = SmallVec<[IdentifierId; 4]>;
pub type Blocks = SmallVec<[BlockId; 4]>;

/// [`operands`], cloned.
pub fn each_instruction_value_operand(value: &InstructionValue, env: &Environment) -> Places {
    operands(value, &env.functions).cloned().collect()
}

/// Returns true if the pattern contains a spread element.
/// Equivalent to TS `doesPatternContainSpreadElement`.
pub fn does_pattern_contain_spread_element(pattern: &Pattern) -> bool {
    match pattern {
        Pattern::Array(arr) => {
            for item in &arr.items {
                if matches!(item, ArrayPatternElement::Spread(_)) {
                    return true;
                }
            }
        }
        Pattern::Object(obj) => {
            for property in &obj.properties {
                if matches!(property, ObjectPropertyOrSpread::Spread(_)) {
                    return true;
                }
            }
        }
    }
    false
}

/// Yields successor block IDs (NOT fallthroughs, this is intentional).
/// Equivalent to TS `eachTerminalSuccessor`.
pub fn each_terminal_successor(terminal: &Terminal) -> Blocks {
    let mut result = SmallVec::new();
    match terminal {
        Terminal::Goto { block, .. } => {
            result.push(*block);
        }
        Terminal::If {
            consequent,
            alternate,
            ..
        } => {
            result.push(*consequent);
            result.push(*alternate);
        }
        Terminal::Branch {
            consequent,
            alternate,
            ..
        } => {
            result.push(*consequent);
            result.push(*alternate);
        }
        Terminal::Switch { cases, .. } => {
            for case in cases {
                result.push(case.block);
            }
        }
        Terminal::Optional { test, .. }
        | Terminal::Ternary { test, .. }
        | Terminal::Logical { test, .. } => {
            result.push(*test);
        }
        Terminal::Return { .. } => {}
        Terminal::Throw { .. } => {}
        Terminal::DoWhile { loop_block, .. } => {
            result.push(*loop_block);
        }
        Terminal::While { test, .. } => {
            result.push(*test);
        }
        Terminal::For { init, .. } => {
            result.push(*init);
        }
        Terminal::ForOf { init, .. } => {
            result.push(*init);
        }
        Terminal::ForIn { init, .. } => {
            result.push(*init);
        }
        Terminal::Label { block, .. } => {
            result.push(*block);
        }
        Terminal::Sequence { block, .. } => {
            result.push(*block);
        }
        Terminal::MaybeThrow {
            continuation,
            handler,
            ..
        } => {
            result.push(*continuation);
            if let Some(handler) = handler {
                result.push(*handler);
            }
        }
        Terminal::Try { block, .. } => {
            result.push(*block);
        }
        Terminal::Scope { block, .. } | Terminal::PrunedScope { block, .. } => {
            result.push(*block);
        }
        Terminal::Unreachable { .. } | Terminal::Unsupported { .. } => {}
    }
    result
}

// =============================================================================
// Mapping functions (mutate in place)
// =============================================================================

/// Maps pattern operands in place.
/// Equivalent to TS `mapPatternOperands`.
pub fn map_pattern_operands(pattern: &mut Pattern, f: &mut impl FnMut(Place) -> Place) {
    match pattern {
        Pattern::Array(arr) => {
            arr.items = AstAlloc::vec_from_iter(arr.items.iter().map(|item| match item {
                ArrayPatternElement::Place(place) => ArrayPatternElement::Place(f(place.clone())),
                ArrayPatternElement::Spread(spread) => {
                    let mut spread = spread.clone();
                    spread.place = f(spread.place.clone());
                    ArrayPatternElement::Spread(spread)
                }
                ArrayPatternElement::Hole => ArrayPatternElement::Hole,
            }));
        }
        Pattern::Object(obj) => {
            for property in obj.properties.iter_mut() {
                match property {
                    ObjectPropertyOrSpread::Property(prop) => {
                        prop.place = f(prop.place.clone());
                    }
                    ObjectPropertyOrSpread::Spread(spread) => {
                        spread.place = f(spread.place.clone());
                    }
                }
            }
        }
    }
}

/// Maps a terminal node's block assignments in place.
/// Equivalent to TS `mapTerminalSuccessors` — but mutates in place instead of returning a new terminal.
pub fn map_terminal_successors(terminal: &mut Terminal, f: &mut impl FnMut(BlockId) -> BlockId) {
    match terminal {
        Terminal::Goto { block, .. } => {
            *block = f(*block);
        }
        Terminal::If {
            consequent,
            alternate,
            fallthrough,
            ..
        } => {
            *consequent = f(*consequent);
            *alternate = f(*alternate);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Branch {
            consequent,
            alternate,
            fallthrough,
            ..
        } => {
            *consequent = f(*consequent);
            *alternate = f(*alternate);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Switch {
            cases, fallthrough, ..
        } => {
            for case in cases.iter_mut() {
                case.block = f(case.block);
            }
            *fallthrough = f(*fallthrough);
        }
        Terminal::Logical {
            test, fallthrough, ..
        } => {
            *test = f(*test);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Ternary {
            test, fallthrough, ..
        } => {
            *test = f(*test);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Optional {
            test, fallthrough, ..
        } => {
            *test = f(*test);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Return { .. } => {}
        Terminal::Throw { .. } => {}
        Terminal::DoWhile {
            loop_block,
            test,
            fallthrough,
            ..
        } => {
            *loop_block = f(*loop_block);
            *test = f(*test);
            *fallthrough = f(*fallthrough);
        }
        Terminal::While {
            test,
            loop_block,
            fallthrough,
            ..
        } => {
            *test = f(*test);
            *loop_block = f(*loop_block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::For {
            init,
            test,
            update,
            loop_block,
            fallthrough,
            ..
        } => {
            *init = f(*init);
            *test = f(*test);
            if let Some(update) = update {
                *update = f(*update);
            }
            *loop_block = f(*loop_block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::ForOf {
            init,
            test,
            loop_block,
            fallthrough,
            ..
        } => {
            *init = f(*init);
            *test = f(*test);
            *loop_block = f(*loop_block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::ForIn {
            init,
            loop_block,
            fallthrough,
            ..
        } => {
            *init = f(*init);
            *loop_block = f(*loop_block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Label {
            block, fallthrough, ..
        } => {
            *block = f(*block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Sequence {
            block, fallthrough, ..
        } => {
            *block = f(*block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::MaybeThrow {
            continuation,
            handler,
            ..
        } => {
            *continuation = f(*continuation);
            if let Some(handler) = handler {
                *handler = f(*handler);
            }
        }
        Terminal::Try {
            block,
            handler,
            fallthrough,
            ..
        } => {
            *block = f(*block);
            *handler = f(*handler);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Scope {
            block, fallthrough, ..
        }
        | Terminal::PrunedScope {
            block, fallthrough, ..
        } => {
            *block = f(*block);
            *fallthrough = f(*fallthrough);
        }
        Terminal::Unreachable { .. } | Terminal::Unsupported { .. } => {}
    }
}

/// Yields ALL block IDs referenced by a terminal (successors + fallthroughs + internal blocks).
/// Unlike `each_terminal_successor` which yields only standard control flow successors,
/// this function yields every block ID that `map_terminal_successors` would visit.
pub fn each_terminal_all_successors(terminal: &Terminal) -> Blocks {
    let mut result = SmallVec::new();
    for_each_terminal_all_successor(terminal, &mut |block| result.push(block));
    result
}

pub fn for_each_terminal_all_successor(terminal: &Terminal, f: &mut impl FnMut(BlockId)) {
    match terminal {
        Terminal::Goto { block, .. } => {
            f(*block);
        }
        Terminal::If {
            consequent,
            alternate,
            fallthrough,
            ..
        } => {
            f(*consequent);
            f(*alternate);
            f(*fallthrough);
        }
        Terminal::Branch {
            consequent,
            alternate,
            fallthrough,
            ..
        } => {
            f(*consequent);
            f(*alternate);
            f(*fallthrough);
        }
        Terminal::Switch {
            cases, fallthrough, ..
        } => {
            for case in cases {
                f(case.block);
            }
            f(*fallthrough);
        }
        Terminal::Logical {
            test, fallthrough, ..
        }
        | Terminal::Ternary {
            test, fallthrough, ..
        }
        | Terminal::Optional {
            test, fallthrough, ..
        } => {
            f(*test);
            f(*fallthrough);
        }
        Terminal::Return { .. } | Terminal::Throw { .. } => {}
        Terminal::DoWhile {
            loop_block,
            test,
            fallthrough,
            ..
        } => {
            f(*loop_block);
            f(*test);
            f(*fallthrough);
        }
        Terminal::While {
            test,
            loop_block,
            fallthrough,
            ..
        } => {
            f(*test);
            f(*loop_block);
            f(*fallthrough);
        }
        Terminal::For {
            init,
            test,
            update,
            loop_block,
            fallthrough,
            ..
        } => {
            f(*init);
            f(*test);
            if let Some(update) = update {
                f(*update);
            }
            f(*loop_block);
            f(*fallthrough);
        }
        Terminal::ForOf {
            init,
            test,
            loop_block,
            fallthrough,
            ..
        } => {
            f(*init);
            f(*test);
            f(*loop_block);
            f(*fallthrough);
        }
        Terminal::ForIn {
            init,
            loop_block,
            fallthrough,
            ..
        } => {
            f(*init);
            f(*loop_block);
            f(*fallthrough);
        }
        Terminal::Label {
            block, fallthrough, ..
        }
        | Terminal::Sequence {
            block, fallthrough, ..
        } => {
            f(*block);
            f(*fallthrough);
        }
        Terminal::MaybeThrow {
            continuation,
            handler,
            ..
        } => {
            f(*continuation);
            if let Some(handler) = handler {
                f(*handler);
            }
        }
        Terminal::Try {
            block,
            handler,
            fallthrough,
            ..
        } => {
            f(*block);
            f(*handler);
            f(*fallthrough);
        }
        Terminal::Scope {
            block, fallthrough, ..
        }
        | Terminal::PrunedScope {
            block, fallthrough, ..
        } => {
            f(*block);
            f(*fallthrough);
        }
        Terminal::Unreachable { .. } | Terminal::Unsupported { .. } => {}
    }
}

// =============================================================================
// Terminal fallthrough functions
// =============================================================================

/// Returns the fallthrough block ID for terminals that have one.
/// Equivalent to TS `terminalFallthrough`.
pub fn terminal_fallthrough(terminal: &Terminal) -> Option<BlockId> {
    match terminal {
        // These terminals do NOT have a fallthrough
        Terminal::MaybeThrow { .. }
        | Terminal::Goto { .. }
        | Terminal::Return { .. }
        | Terminal::Throw { .. }
        | Terminal::Unreachable { .. }
        | Terminal::Unsupported { .. } => None,

        // These terminals DO have a fallthrough
        Terminal::Branch { fallthrough, .. }
        | Terminal::Try { fallthrough, .. }
        | Terminal::DoWhile { fallthrough, .. }
        | Terminal::ForOf { fallthrough, .. }
        | Terminal::ForIn { fallthrough, .. }
        | Terminal::For { fallthrough, .. }
        | Terminal::If { fallthrough, .. }
        | Terminal::Label { fallthrough, .. }
        | Terminal::Logical { fallthrough, .. }
        | Terminal::Optional { fallthrough, .. }
        | Terminal::Sequence { fallthrough, .. }
        | Terminal::Switch { fallthrough, .. }
        | Terminal::Ternary { fallthrough, .. }
        | Terminal::While { fallthrough, .. }
        | Terminal::Scope { fallthrough, .. }
        | Terminal::PrunedScope { fallthrough, .. } => Some(*fallthrough),
    }
}

// =============================================================================
// ScopeBlockTraversal
// =============================================================================

/// Block info entry for ScopeBlockTraversal.
#[derive(Debug, Clone)]
pub enum ScopeBlockInfo {
    Begin {
        scope: ScopeId,
        pruned: bool,
        fallthrough: BlockId,
    },
    End {
        scope: ScopeId,
        pruned: bool,
    },
}

/// Helper struct for traversing scope blocks in HIR-form.
/// Equivalent to TS `ScopeBlockTraversal` class.
pub struct ScopeBlockTraversal {
    /// Live stack of active scopes
    active_scopes: Vec<ScopeId>,
    /// Map from block ID to scope block info
    pub block_infos: HashMap<BlockId, ScopeBlockInfo>,
}

impl ScopeBlockTraversal {
    pub fn new() -> Self {
        ScopeBlockTraversal {
            active_scopes: Vec::new(),
            block_infos: HashMap::default(),
        }
    }

    /// Record scope information for a block's terminal.
    /// Equivalent to TS `recordScopes`.
    pub fn record_scopes(
        &mut self,
        block: &BasicBlock,
    ) -> Result<(), crate::diagnostics::CompilerDiagnostic> {
        if let Some(block_info) = self.block_infos.get(&block.id) {
            match block_info {
                ScopeBlockInfo::Begin { scope, .. } => {
                    self.active_scopes.push(*scope);
                }
                ScopeBlockInfo::End { scope, .. } => {
                    let top = self.active_scopes.last();
                    crate::diagnostics::invariant(
                        Some(scope) == top,
                        "Expected traversed block fallthrough to match top-most active scope",
                    )?;
                    self.active_scopes.pop();
                }
            }
        }

        match &block.terminal {
            Terminal::Scope {
                block: scope_block,
                fallthrough,
                scope,
                ..
            } => {
                crate::diagnostics::invariant(
                    !self.block_infos.contains_key(scope_block)
                        && !self.block_infos.contains_key(fallthrough),
                    "Expected unique scope blocks and fallthroughs",
                )?;
                self.block_infos.insert(
                    *scope_block,
                    ScopeBlockInfo::Begin {
                        scope: *scope,
                        pruned: false,
                        fallthrough: *fallthrough,
                    },
                );
                self.block_infos.insert(
                    *fallthrough,
                    ScopeBlockInfo::End {
                        scope: *scope,
                        pruned: false,
                    },
                );
            }
            Terminal::PrunedScope {
                block: scope_block,
                fallthrough,
                scope,
                ..
            } => {
                crate::diagnostics::invariant(
                    !self.block_infos.contains_key(scope_block)
                        && !self.block_infos.contains_key(fallthrough),
                    "Expected unique scope blocks and fallthroughs",
                )?;
                self.block_infos.insert(
                    *scope_block,
                    ScopeBlockInfo::Begin {
                        scope: *scope,
                        pruned: true,
                        fallthrough: *fallthrough,
                    },
                );
                self.block_infos.insert(
                    *fallthrough,
                    ScopeBlockInfo::End {
                        scope: *scope,
                        pruned: true,
                    },
                );
            }
            _ => {}
        }
        Ok(())
    }

    /// Returns true if the given scope is currently 'active', i.e. if the scope start
    /// block but not the scope fallthrough has been recorded.
    pub fn is_scope_active(&self, scope_id: ScopeId) -> bool {
        self.active_scopes.contains(&scope_id)
    }

    /// The current, innermost active scope.
    pub fn current_scope(&self) -> Option<ScopeId> {
        self.active_scopes.last().copied()
    }
}

// =============================================================================
// Convenience wrappers: extract IdentifierIds from Places
// =============================================================================

/// Collect all operand IdentifierIds from an instruction value.
pub fn each_instruction_value_operand_ids(value: &InstructionValue, env: &Environment) -> Ids {
    operands(value, &env.functions)
        .map(|p| p.identifier)
        .collect()
}

// =============================================================================
// In-place mutation variants (f(&mut Place) callbacks)
// =============================================================================
//
// These variants use `f(&mut Place)` instead of `f(Place) -> Place`, which is
// more natural for Rust in-place mutation patterns. They do NOT handle
// FunctionExpression/ObjectMethod context (since that requires env access).
// Callers that need to process inner function context should handle it
// separately, e.g.:
//
//   for_each_instruction_value_operand_mut(&mut instr.value, &mut |place| { ... });
//   if let InstructionValue::FunctionExpression { lowered_func, .. }
//       | InstructionValue::ObjectMethod { lowered_func, .. } = &mut instr.value {
//       let func = &mut env.functions[lowered_func.func.0 as usize];
//       for ctx in func.context.iter_mut() { ... }
//   }
//

/// In-place mutation of all operand places in an InstructionValue.
/// Does NOT handle FunctionExpression/ObjectMethod context — callers handle those separately.
pub fn for_each_instruction_value_operand_mut(
    value: &mut InstructionValue,
    f: &mut impl FnMut(&mut Place),
) {
    match value {
        InstructionValue::BinaryExpression { left, right, .. } => {
            f(left);
            f(right);
        }
        InstructionValue::PropertyLoad { object, .. }
        | InstructionValue::PropertyDelete { object, .. } => {
            f(object);
        }
        InstructionValue::PropertyStore {
            object, value: val, ..
        } => {
            f(object);
            f(val);
        }
        InstructionValue::ComputedLoad {
            object, property, ..
        }
        | InstructionValue::ComputedDelete {
            object, property, ..
        } => {
            f(object);
            f(property);
        }
        InstructionValue::ComputedStore {
            object,
            property,
            value: val,
            ..
        } => {
            f(object);
            f(property);
            f(val);
        }
        InstructionValue::DeclareContext { .. } | InstructionValue::DeclareLocal { .. } => {}
        InstructionValue::LoadLocal { place, .. } | InstructionValue::LoadContext { place, .. } => {
            f(place);
        }
        InstructionValue::StoreLocal { value: val, .. } => {
            f(val);
        }
        InstructionValue::StoreContext {
            lvalue, value: val, ..
        } => {
            f(&mut lvalue.place);
            f(val);
        }
        InstructionValue::StoreGlobal { value: val, .. } => {
            f(val);
        }
        InstructionValue::Destructure { value: val, .. } => {
            f(val);
        }
        InstructionValue::NewExpression { callee, args, .. }
        | InstructionValue::CallExpression { callee, args, .. } => {
            f(callee);
            for_each_call_argument_mut(args, f);
        }
        InstructionValue::MethodCall {
            receiver,
            property,
            args,
            ..
        } => {
            f(receiver);
            f(property);
            for_each_call_argument_mut(args, f);
        }
        InstructionValue::UnaryExpression { value: val, .. } => {
            f(val);
        }
        InstructionValue::JsxExpression {
            tag,
            props,
            children,
            ..
        } => {
            if let JsxTag::Place(place) = tag {
                f(place);
            }
            for attribute in props.iter_mut() {
                match attribute {
                    JsxAttribute::Attribute { place, .. } => f(place),
                    JsxAttribute::SpreadAttribute { argument, .. } => f(argument),
                }
            }
            if let Some(children) = children {
                for child in children.iter_mut() {
                    f(child);
                }
            }
        }
        InstructionValue::ObjectExpression { properties, .. } => {
            for property in properties.iter_mut() {
                match property {
                    ObjectPropertyOrSpread::Property(prop) => {
                        if let ObjectPropertyKey::Computed { name } = &mut prop.key {
                            f(name);
                        }
                        f(&mut prop.place);
                    }
                    ObjectPropertyOrSpread::Spread(spread) => {
                        f(&mut spread.place);
                    }
                }
            }
        }
        InstructionValue::ArrayExpression { elements, .. } => {
            for elem in elements.iter_mut() {
                match elem {
                    ArrayElement::Place(p) => f(p),
                    ArrayElement::Spread(s) => f(&mut s.place),
                    ArrayElement::Hole => {}
                }
            }
        }
        InstructionValue::JsxFragment { children, .. } => {
            for child in children.iter_mut() {
                f(child);
            }
        }
        InstructionValue::FunctionExpression { .. } | InstructionValue::ObjectMethod { .. } => {
            // Context places require env access — callers handle separately.
        }
        InstructionValue::TaggedTemplateExpression { tag, .. } => {
            f(tag);
        }
        InstructionValue::TypeCastExpression { value: val, .. } => {
            f(val);
        }
        InstructionValue::TemplateLiteral { subexprs, .. } => {
            for expr in subexprs.iter_mut() {
                f(expr);
            }
        }
        InstructionValue::Await { value: val, .. } => {
            f(val);
        }
        InstructionValue::GetIterator { collection, .. } => {
            f(collection);
        }
        InstructionValue::IteratorNext {
            iterator,
            collection,
            ..
        } => {
            f(iterator);
            f(collection);
        }
        InstructionValue::NextPropertyOf { value: val, .. } => {
            f(val);
        }
        InstructionValue::PostfixUpdate { value: val, .. }
        | InstructionValue::PrefixUpdate { value: val, .. } => {
            f(val);
        }
        InstructionValue::StartMemoize { deps, .. } => {
            if let Some(deps) = deps {
                for dep in deps.iter_mut() {
                    if let ManualMemoDependencyRoot::NamedLocal { value, .. } = &mut dep.root {
                        f(value);
                    }
                }
            }
        }
        InstructionValue::FinishMemoize { decl, .. } => {
            f(decl);
        }
        InstructionValue::Debugger { .. }
        | InstructionValue::RegExpLiteral { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::LoadGlobal { .. }
        | InstructionValue::UnsupportedNode { .. }
        | InstructionValue::Primitive { .. }
        | InstructionValue::JSXText { .. } => {}
    }
}

/// In-place mutation of call arguments.
pub fn for_each_call_argument_mut(args: &mut [PlaceOrSpread], f: &mut impl FnMut(&mut Place)) {
    for arg in args.iter_mut() {
        f(arg.place_mut());
    }
}

/// In-place mutation of an InstructionValue's lvalues (DeclareLocal, StoreLocal, DeclareContext,
/// StoreContext, Destructure, PostfixUpdate, PrefixUpdate). Does NOT include the instruction's
/// top-level lvalue — use `for_each_instruction_lvalue_mut` for that.
pub fn for_each_instruction_value_lvalue_mut(
    value: &mut InstructionValue,
    f: &mut impl FnMut(&mut Place),
) {
    match value {
        InstructionValue::DeclareContext { lvalue, .. }
        | InstructionValue::StoreContext { lvalue, .. }
        | InstructionValue::DeclareLocal { lvalue, .. }
        | InstructionValue::StoreLocal { lvalue, .. } => {
            f(&mut lvalue.place);
        }
        InstructionValue::Destructure { lvalue, .. } => {
            for_each_pattern_operand_mut(&mut lvalue.pattern, f);
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => {
            f(lvalue);
        }
        _ => {}
    }
}

/// In-place mutation of the instruction's lvalue and value's lvalues.
/// Matches the same variants as TS `mapInstructionLValues` (skips DeclareContext/StoreContext).
pub fn for_each_instruction_lvalue_mut(instr: &mut Instruction, f: &mut impl FnMut(&mut Place)) {
    match &mut instr.value {
        InstructionValue::DeclareLocal { lvalue, .. }
        | InstructionValue::StoreLocal { lvalue, .. } => {
            f(&mut lvalue.place);
        }
        InstructionValue::Destructure { lvalue, .. } => {
            for_each_pattern_operand_mut(&mut lvalue.pattern, f);
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => {
            f(lvalue);
        }
        _ => {}
    }
    f(&mut instr.lvalue);
}

/// In-place mutation of pattern operands.
pub fn for_each_pattern_operand_mut(pattern: &mut Pattern, f: &mut impl FnMut(&mut Place)) {
    match pattern {
        Pattern::Array(arr) => {
            for item in arr.items.iter_mut() {
                match item {
                    ArrayPatternElement::Place(p) => f(p),
                    ArrayPatternElement::Spread(s) => f(&mut s.place),
                    ArrayPatternElement::Hole => {}
                }
            }
        }
        Pattern::Object(obj) => {
            for property in obj.properties.iter_mut() {
                match property {
                    ObjectPropertyOrSpread::Property(prop) => f(&mut prop.place),
                    ObjectPropertyOrSpread::Spread(spread) => f(&mut spread.place),
                }
            }
        }
    }
}

/// In-place mutation of terminal operand places.
pub fn for_each_terminal_operand_mut(terminal: &mut Terminal, f: &mut impl FnMut(&mut Place)) {
    match terminal {
        Terminal::If { test, .. } | Terminal::Branch { test, .. } => {
            f(test);
        }
        Terminal::Switch { test, cases, .. } => {
            f(test);
            for case in cases.iter_mut() {
                if let Some(t) = &mut case.test {
                    f(t);
                }
            }
        }
        Terminal::Return { value, .. } | Terminal::Throw { value, .. } => {
            f(value);
        }
        Terminal::Try {
            handler_binding, ..
        } => {
            if let Some(binding) = handler_binding {
                f(binding);
            }
        }
        Terminal::MaybeThrow { .. }
        | Terminal::Sequence { .. }
        | Terminal::Label { .. }
        | Terminal::Optional { .. }
        | Terminal::Ternary { .. }
        | Terminal::Logical { .. }
        | Terminal::DoWhile { .. }
        | Terminal::While { .. }
        | Terminal::For { .. }
        | Terminal::ForOf { .. }
        | Terminal::ForIn { .. }
        | Terminal::Goto { .. }
        | Terminal::Unreachable { .. }
        | Terminal::Unsupported { .. }
        | Terminal::Scope { .. }
        | Terminal::PrunedScope { .. } => {}
    }
}
