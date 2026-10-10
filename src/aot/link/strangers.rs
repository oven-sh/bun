//! `--aot-explain=strangers`: how far the objects that are not laid out get, BY PLACE, from where they come into being. Nothing is applied: a count (design/GIVEN.md 12).
//!
//! `bun_sema::check::given::kinds_reaching` says what gets where. Here it is told where an object that is not laid out may be born, by kind, and how values get from place to place.

use super::nil::{Nodes, before_casts, fields_named, functions_called, targets_of};
use crate::declared::Part;
use crate::id::{LayoutId, TyId, V};
use crate::ir::{Func, LayoutKind, Op, Prediction, Program, Term, Why, func_flags};
use bun_sema::check::given::{KindFlows, kinds_reaching};
use rustc_hash::FxHashSet;

const PARSED: u8 = 0;
const FREE: u8 = 1;
const EXTERNAL: u8 = 2;
const OF_OBJECT: u8 = 3;
const OF_HOST: u8 = 4;
const NEW_OF_HOST: u8 = 5;
const PREDICTED_PROPERTY: u8 = 6;
const PREDICTED_CALL: u8 = 7;
const ORDINARY: u8 = 8;
const CALL: u8 = 9;
const METHOD_OF_ANYTHING: u8 = 10;
const METHOD_OF_RECORD: u8 = 11;
const CONSTRUCT: u8 = 12;
const ELEMENT: u8 = 13;
const ITERATED: u8 = 14;
const AWAITED: u8 = 15;
const SENT: u8 = 16;
const OUT_OF_CONTAINER: u8 = 17;
const HANDED: u8 = 18;
const CAUGHT: u8 = 19;
const APPLIED: u8 = 20;
const MODULE: u8 = 21;
const OPERATION: u8 = 22;
const KINDS: [&str; 23] = [
    "JSON.parse, structuredClone",
    "what the engine or the host has by a name, itself",
    "the namespace of a module that is not compiled",
    "what a function of `Object` or `Reflect` yields",
    "what another function of the engine or the host yields",
    "what `new` of a class of the engine or the host yields",
    "a property that a declaration without a body says is there (a prediction)",
    "what a call yields by a declaration without a body (a prediction)",
    "a NewObject that nobody converts where it is made",
    "CALLS BY VALUE: what a call yields whose callee is no fact",
    "CALLS BY VALUE: what a method yields of a receiver of which nothing is known",
    "CALLS BY VALUE: what a method yields of a receiver that has a layout, and that is no fact",
    "CALLS BY VALUE: what `new` yields of a callee that is no fact",
    "ELEMENTS: an element",
    "ELEMENTS: what an iteration yields",
    "ELEMENTS: what `await` yields",
    "ELEMENTS: what `yield` yields",
    "ELEMENTS: what a method of an array, a container, a string yields",
    "CALLS BY VALUE: a parameter of a function that is used as a value",
    "what is caught",
    "CALLS BY VALUE: what a call with a spread or `apply` yields",
    "what `require`, `import()` and the like yield",
    "what another operation yields",
];
const CALLS_BY_VALUE: u32 = 1 << CALL | 1 << METHOD_OF_ANYTHING | 1 << METHOD_OF_RECORD | 1 << CONSTRUCT | 1 << HANDED | 1 << APPLIED;
const ELEMENTS: u32 = 1 << ELEMENT | 1 << ITERATED | 1 << AWAITED | 1 << SENT | 1 << OUT_OF_CONTAINER;

fn can_hold_an_object(program: &Program, ty: TyId) -> bool {
    ty.is_none() || program.tys.get(ty).has_objects()
}

/// An array, a container or a primitive of the engine's for sure: what its methods yield comes out of it.
fn is_of_the_engine(program: &Program, ty: TyId) -> bool {
    ty.is_some() && ty != program.tys.anything && !program.tys.get(ty).any_object && !program.tys.get(ty).any_function && !program.tys.get(ty).parts.iter().any(|part| matches!(part, Part::Class(_)))
}

/// The type says which layouts, and none of them admits an object that is not laid out: such an object does not belong there.
fn is_strict(program: &Program, ty: TyId) -> bool {
    names_a_layout(program, ty)
        && !program.tys.get(ty).any_object
        && !program.tys.get(ty).parts.iter().any(|part| matches!(part, Part::Class(layout) if layout.is_some() && program.layouts[layout.idx()].admits_foreign))
}

const DOORS: [&str; 16] = [
    "another value",
    "a place whose type is written down (Cast)",
    "`!`",
    "a place whose type nobody has written down (Store)",
    "a claim",
    "a flow",
    "an upcast",
    "a parameter",
    "a join",
    "a property that is read",
    "an element",
    "a call",
    "a result",
    "a variable",
    "a field",
    "`as` (Coerce)",
];

fn names_a_layout(program: &Program, ty: TyId) -> bool {
    ty.is_some() && program.tys.get(ty).parts.iter().any(|part| matches!(part, Part::Class(_)))
}

pub(super) fn explain(program: &Program) -> Vec<String> {
    let nodes = Nodes::of(program);
    let mut flows = KindFlows {
        nodes: nodes.count,
        shared_from: nodes.results,
        accepts: vec![true; nodes.count as usize],
        births: Vec::new(),
        edges: Vec::new(),
        captures: Vec::new(),
        arguments: Vec::new(),
        returns: Vec::new(),
        calls: Vec::new(),
    };
    let mut births: Vec<(u32, u8)> = Vec::new();
    // By node: `is_strict` of its type, and which of `DOORS` it is.
    let mut strict = vec![false; nodes.count as usize];
    let mut door = vec![0u8; nodes.count as usize];
    let mut connected: FxHashSet<(LayoutId, u32)> = FxHashSet::default();
    let names = [&b"JSON"[..], b"parse", b"structuredClone", b"CloneObject", b"CopyDataProperties", b"DefineField", b"Object", b"Reflect"].map(|name| program.strs.find(name));
    for (index, layout) in program.layouts.iter().enumerate() {
        for (number, field) in layout.fields.iter().enumerate() {
            flows.accepts[nodes.field(LayoutId::new(index), number as u32) as usize] = can_hold_an_object(program, field.declared);
            strict[nodes.field(LayoutId::new(index), number as u32) as usize] = is_strict(program, field.declared);
            door[nodes.field(LayoutId::new(index), number as u32) as usize] = 14;
        }
    }
    for (index, global) in program.globals.iter().enumerate() {
        flows.accepts[nodes.globals as usize + index] = can_hold_an_object(program, global.declared);
        strict[nodes.globals as usize + index] = is_strict(program, global.declared);
        door[nodes.globals as usize + index] = 13;
    }
    for (index, func) in program.funcs.iter().enumerate() {
        let node = |v: V| nodes.value(index, v);
        flows.accepts[nodes.result(index) as usize] = can_hold_an_object(program, func.result);
        strict[nodes.result(index) as usize] = is_strict(program, func.result);
        door[nodes.result(index) as usize] = 12;
        for number in 0..func.values.len() {
            let v = V::new(number);
            flows.accepts[node(v) as usize] = can_hold_an_object(program, func.ty(v));
            strict[node(v) as usize] = is_strict(program, func.ty(v));
            door[node(v) as usize] = match func.op(v) {
                Some(Op::Coerce { why: Why::Cast, .. }) => 1,
                Some(Op::Coerce { why: Why::Coerce, .. }) => 15,
                Some(Op::Coerce { why: Why::NonNull(_), .. }) => 2,
                Some(Op::Coerce { why: Why::Store, .. }) => 3,
                Some(Op::Coerce { why: Why::Claim, .. }) => 4,
                Some(Op::Coerce { why: Why::Flow, .. }) => 5,
                Some(Op::Coerce { why: Why::Upcast, .. }) => 6,
                Some(Op::PropGet { .. } | Op::FieldGet { .. }) => 9,
                Some(Op::ElemGet { .. } | Op::IterGet { .. } | Op::Await(_) | Op::Yield(_)) => 10,
                Some(Op::Call { .. } | Op::CallMethod { .. } | Op::CallDirect { .. } | Op::Construct { .. }) => 11,
                _ => 0,
            };
        }
        for (number, block) in func.blocks.iter().enumerate() {
            for &parameter in &block.params {
                door[node(parameter) as usize] = if number == 0 { 7 } else { 8 };
            }
        }
        let entered = |called: &Func| called.blocks.first().map_or(0, |entry| entry.params.len());
        if func.has(func_flags::IS_VALUE)
            && let Some(entry) = func.blocks.first()
        {
            let ahead = entry.params.len().saturating_sub(func.params.len());
            births.extend(entry.params[ahead..].iter().map(|&parameter| (node(parameter), HANDED)));
        }
        // By what the engine or the host has by a name.
        let is_free = |v: V| matches!(func.op(before_casts(func, v)), Some(Op::FreeGet { .. } | Op::ExternalModule(_)));
        let is_named = |v: V, name: usize| matches!(func.op(before_casts(func, v)), Some(&Op::FreeGet { name: free, .. }) if Some(free) == names[name]);
        for block in &func.blocks {
            for target in targets_of(block.term.as_ref()) {
                let taking = &func.blocks[target.block.idx()].params;
                flows.edges.extend(target.args.iter().zip(taking).filter(|(argument, _)| argument.is_some()).map(|(&argument, &parameter)| (node(argument), node(parameter))));
            }
            if let Some(&Term::Return(returned)) = block.term.as_ref()
                && returned.is_some()
            {
                flows.returns.push((node(returned), nodes.result(index)));
            }
            for &v in &block.ops {
                let Some(op) = func.op(v) else { continue };
                let mut field = |flows: &mut KindFlows, layout: LayoutId, number: u32| -> u32 {
                    let place = nodes.field(layout, number);
                    if connected.insert((layout, number)) {
                        let own = &program.layouts[layout.idx()];
                        let name = own.fields[number as usize].name;
                        for &other in own.members.iter().chain(&own.specializations).filter(|&&other| other != layout) {
                            if let Some(same) = program.layouts[other.idx()].field(name) {
                                flows.edges.push((place, nodes.field(other, same)));
                                flows.edges.push((nodes.field(other, same), place));
                            }
                        }
                    }
                    place
                };
                match op {
                    // What has just been made, and nobody else holds, is made what the type says. Anything else stays what it is.
                    &Op::Coerce { value, to, why } => {
                        let is_fresh = match func.op(value) {
                            Some(Op::NewObject) => true,
                            Some(Op::Operation { name, .. }) => Some(*name) == names[3],
                            Some(&Op::CallMethod { obj, name, .. }) => is_named(obj, 0) && Some(name) == names[1],
                            Some(&Op::Call { callee, .. }) => is_named(callee, 2) || matches!(func.op(before_casts(func, callee)), Some(&Op::PropGet { obj, name }) if is_named(obj, 0) && Some(name) == names[1]),
                            _ => false,
                        };
                        if !(is_fresh && matches!(why, Why::Cast | Why::Coerce) && names_a_layout(program, to)) {
                            flows.edges.push((node(value), node(v)));
                        }
                    }
                    Op::NewObject => births.push((node(v), ORDINARY)),
                    Op::FreeGet { .. } => births.push((node(v), FREE)),
                    Op::ExternalModule(_) => births.push((node(v), EXTERNAL)),
                    Op::Caught => births.push((node(v), CAUGHT)),
                    &Op::GlobalGet(global) => flows.edges.push((nodes.globals + global.idx() as u32, node(v))),
                    &Op::GlobalSet(global, value) => flows.edges.push((node(value), nodes.globals + global.idx() as u32)),
                    &Op::FieldGet { layout, field: number, .. } => {
                        let from = field(&mut flows, layout, number);
                        flows.edges.push((from, node(v)));
                    }
                    &Op::FieldSet { layout, field: number, value, .. } => {
                        let to = field(&mut flows, layout, number);
                        flows.edges.push((node(value), to));
                    }
                    &Op::PropGet { obj, name } => {
                        let fields = fields_named(program, func.ty(obj), name);
                        for &(layout, number) in &fields {
                            let from = field(&mut flows, layout, number);
                            flows.edges.push((from, node(v)));
                        }
                        // Out of an object that is not laid out comes what is not.
                        flows.edges.push((node(obj), node(v)));
                        // A read of a field that is only looked at is left `anything` with a prediction too: that comes out of the field.
                        if fields.is_empty() && matches!(func.prediction(v), Prediction::Ty(_)) && func.ty(v) == program.tys.anything {
                            births.push((node(v), PREDICTED_PROPERTY));
                        }
                    }
                    &Op::PropSet { obj, name, value } => {
                        let fields = fields_named(program, func.ty(obj), name);
                        for &(layout, number) in &fields {
                            let to = field(&mut flows, layout, number);
                            flows.edges.push((node(value), to));
                        }
                        if fields.is_empty() {
                            flows.edges.push((node(value), node(obj)));
                        }
                    }
                    &Op::ElemGet { obj, .. } => {
                        flows.edges.push((node(obj), node(v)));
                        births.push((node(v), ELEMENT));
                    }
                    &Op::IterOpen(iterated) => flows.edges.push((node(iterated), node(v))),
                    &Op::IterGet { iter, .. } => {
                        flows.edges.push((node(iter), node(v)));
                        births.push((node(v), ITERATED));
                    }
                    &Op::Await(awaited) | &Op::Yield(awaited) => {
                        if awaited.is_some() {
                            flows.edges.push((node(awaited), node(v)));
                        }
                        births.push((node(v), if matches!(op, Op::Await(_)) { AWAITED } else { SENT }));
                    }
                    &Op::ElemSet { obj, value, .. } => flows.edges.push((node(value), node(obj))),
                    Op::NewArray(elements) => flows.edges.extend(elements.iter().filter(|element| element.is_some()).map(|&element| (node(element), node(v)))),
                    Op::Closure { func: made, captures } | Op::ClosureOnce { func: made, captures, .. } => {
                        if let Some(entry) = program.funcs[made.idx()].blocks.first() {
                            flows.captures.extend(captures.iter().zip(&entry.params).filter(|(capture, _)| capture.is_some()).map(|(&capture, &parameter)| (node(capture), nodes.value(made.idx(), parameter))));
                        }
                    }
                    Op::CallDirect { func: called, args } => {
                        if let Some(entry) = program.funcs[called.idx()].blocks.first() {
                            let result = nodes.result(called.idx());
                            flows.arguments.extend(args.iter().zip(&entry.params).filter(|(argument, _)| argument.is_some()).map(|(&argument, &parameter)| (node(argument), nodes.value(called.idx(), parameter), node(v), result)));
                            flows.calls.push((result, node(v)));
                        }
                    }
                    Op::Operation { name, args } => {
                        let text = program.strs.get(*name);
                        if Some(*name) == names[3] {
                            // The copy of a record is one.
                            flows.edges.extend(args.first().map(|&source| (node(source), node(v))));
                        } else if Some(*name) == names[4] && args.len() == 2 {
                            flows.edges.push((node(args[1]), node(args[0])));
                        } else if Some(*name) == names[5] && args.len() == 3 {
                            flows.edges.push((node(args[2]), node(args[0])));
                        } else if matches!(text, b"PrivateGet" | b"SuperGet" | b"GetInternalField" | b"GetOwnProperty" | b"ToObject" | b"GetIterator" | b"GetAsyncIterator" | b"RequireIteratorResultObject" | b"AppendSpread" | b"AppendHole")
                            || text.starts_with(b"CopyDataProperties")
                        {
                            // Out of its first operand, or that itself.
                            flows.edges.extend(args.first().filter(|first| first.is_some()).map(|&first| (node(first), node(v))));
                            if text == b"AppendSpread" && args.len() == 2 {
                                flows.edges.push((node(args[1]), node(args[0])));
                            }
                            if text.starts_with(b"CopyDataProperties") {
                                births.push((node(v), ORDINARY));
                            }
                        } else if matches!(text, b"PrivateSet" | b"PrivateFieldAdd" | b"PutInternalField" | b"PutByValDirect" | b"DefineMethod" | b"DefineGetter" | b"DefineSetter") {
                            // Into its first operand.
                            if let [first, .., last] = args[..] {
                                flows.edges.push((node(last), node(first)));
                            }
                        } else if text.starts_with(b"Is")
                            || text.starts_with(b"Has")
                            || text.starts_with(b"Put")
                            || matches!(text, b"SetFunctionName" | b"PrivateMethodsAdd" | b"NewPrivateName" | b"ToLength" | b"MakeClass" | b"NewPromise" | b"ForInKeys" | b"GetTemplateObject")
                        {
                            // A boolean, a number, nothing, or what the engine makes of a kind of its own.
                        } else if func.ty(v) == program.tys.anything {
                            let is_call = text == b"Apply" || text.starts_with(b"Call") || text.starts_with(b"Construct") || text.starts_with(b"Super");
                            let is_module = text.starts_with(b"Require") || text.starts_with(b"Import") || text.starts_with(b"Get") || text == b"ToESM";
                            births.push((node(v), if is_call { APPLIED } else if is_module { MODULE } else { OPERATION }));
                        }
                    }
                    Op::Call { .. } | Op::CallMethod { .. } | Op::Construct { .. } => {
                        if let Some((callees, args)) = functions_called(program, func, v) {
                            for callee in callees {
                                let called = &program.funcs[callee.idx()];
                                let Some(entry) = called.blocks.first() else { continue };
                                let (ahead, result) = (entered(called).saturating_sub(called.params.len()), nodes.result(callee.idx()));
                                flows.arguments.extend(args.iter().zip(&entry.params[ahead..]).map(|(&argument, &parameter)| (node(argument), nodes.value(callee.idx(), parameter), node(v), result)));
                                let receiver = match *op {
                                    Op::CallMethod { obj, .. } => obj,
                                    Op::Call { this, .. } => this,
                                    _ => V::NONE,
                                };
                                if called.has(func_flags::HAS_THIS) && receiver.is_some() && ahead > 0 {
                                    flows.arguments.push((node(receiver), nodes.value(callee.idx(), entry.params[called.captures.len().min(ahead - 1)]), node(v), result));
                                }
                                flows.calls.push((result, node(v)));
                            }
                            continue;
                        }
                        // `Object.assign(x, ..)`, `Object.freeze(x)`, `Object.defineProperty(x, ..)` hand back `x`; `Object.values(x)`, `Object.entries(x)` what it holds.
                        let of_object = match *op {
                            Op::CallMethod { obj, name, ref args } if is_named(obj, 6) || is_named(obj, 7) => Some((name, &args[..])),
                            Op::Call { callee, ref args, .. } => match func.op(before_casts(func, callee)) {
                                Some(&Op::PropGet { obj, name }) if is_named(obj, 6) || is_named(obj, 7) => Some((name, &args[..])),
                                _ => None,
                            },
                            _ => None,
                        };
                        if let Some((name, [first, others @ ..])) = of_object
                            && matches!(program.strs.get(name), b"assign" | b"freeze" | b"seal" | b"preventExtensions" | b"defineProperty" | b"defineProperties" | b"setPrototypeOf" | b"values" | b"entries")
                        {
                            flows.edges.push((node(*first), node(v)));
                            if program.strs.get(name) == b"assign" {
                                flows.edges.extend(others.iter().filter(|other| other.is_some()).map(|&other| (node(other), node(*first))));
                            }
                            continue;
                        }
                        let kind = match *op {
                            Op::CallMethod { obj, name, .. } if is_named(obj, 0) && Some(name) == names[1] => PARSED,
                            Op::Call { callee, .. } if is_named(callee, 2) => PARSED,
                            Op::Call { callee, .. } if matches!(func.op(before_casts(func, callee)), Some(&Op::PropGet { obj, name }) if is_named(obj, 0) && Some(name) == names[1]) => PARSED,
                            Op::CallMethod { obj, .. } if is_named(obj, 6) || is_named(obj, 7) => OF_OBJECT,
                            Op::Call { callee, .. } if matches!(func.op(before_casts(func, callee)), Some(&Op::PropGet { obj, .. }) if is_named(obj, 6) || is_named(obj, 7)) => OF_OBJECT,
                            Op::CallMethod { obj, .. } if is_free(obj) => OF_HOST,
                            Op::Call { callee, .. } if is_free(callee) || matches!(func.op(before_casts(func, callee)), Some(&Op::PropGet { obj, .. }) if is_free(obj)) => OF_HOST,
                            Op::Construct { callee, .. } if is_free(callee) || matches!(func.op(before_casts(func, callee)), Some(&Op::PropGet { obj, .. }) if is_free(obj)) => NEW_OF_HOST,
                            Op::CallMethod { obj, ref args, .. } if is_of_the_engine(program, func.ty(obj)) => {
                                // What it is handed it holds from then on, and what it yields comes out of it.
                                flows.edges.extend(args.iter().filter(|argument| argument.is_some()).map(|&argument| (node(argument), node(obj))));
                                flows.edges.push((node(obj), node(v)));
                                OUT_OF_CONTAINER
                            }
                            _ if matches!(func.prediction(v), Prediction::Ty(_)) => PREDICTED_CALL,
                            Op::Construct { .. } => CONSTRUCT,
                            Op::CallMethod { obj, .. } if names_a_layout(program, func.ty(obj)) => METHOD_OF_RECORD,
                            Op::CallMethod { .. } => METHOD_OF_ANYTHING,
                            _ => CALL,
                        };
                        // What is made by `new` of a class of the program says what it is. So does what the engine says is an array, a container, a function of its own: it holds nothing yet.
                        let is_made = matches!(op, Op::Construct { .. }) && names_a_layout(program, func.ty(v)) && !program.tys.get(func.ty(v)).any_object;
                        let is_of_host = matches!(kind, OF_OBJECT | OF_HOST | NEW_OF_HOST) && is_of_the_engine(program, func.ty(v));
                        if !is_made && !is_of_host {
                            births.push((node(v), kind));
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    let mut born = [0usize; KINDS.len()];
    for &(node, kind) in &births {
        born[kind as usize] += usize::from(flows.accepts[node as usize]);
    }
    // Eight kinds a pass.
    let mut reaching: Vec<u32> = vec![0; nodes.count as usize];
    for pass in 0..KINDS.len().div_ceil(8) {
        flows.births = births.iter().filter(|birth| birth.1 as usize / 8 == pass).map(|&(node, kind)| (node, 1 << (kind % 8))).collect();
        for (all, kinds) in reaching.iter_mut().zip(kinds_reaching(&flows)) {
            *all |= u32::from(kinds) << (8 * pass);
        }
    }

    // d-integers' metric, count for count (`explain_given`: the line "today" is its `given:` lines): in the functions that are written in TypeScript, a place or a value is a fact where its type says something. Here: and nothing of the kinds gets there that does not
    // belong there: a place for any object, or for a view that admits strangers, loses nothing.
    let is_fact = |ty: TyId| ty.is_some() && ty != program.tys.anything;
    let counted = |kinds: u32| -> [(usize, usize); 5] {
        let (mut places, mut reads, mut receivers, mut fields, mut references) = ((0, 0), (0, 0), (0, 0), (0, 0), (0, 0));
        let count = |counter: &mut (usize, usize), ty: TyId, node: u32| {
            counter.0 += usize::from(is_fact(ty) && !(strict[node as usize] && reaching[node as usize] & kinds != 0));
            counter.1 += 1;
        };
        for (index, func) in program.funcs.iter().enumerate().filter(|(_, func)| func.has(func_flags::IS_TYPED)) {
            count(&mut places, func.result, nodes.result(index));
            for (number, block) in func.blocks.iter().enumerate() {
                // Of the entry: the parameters that are declared, which come last.
                let ahead = if number == 0 { block.params.len().saturating_sub(func.params.len()) } else { 0 };
                for &parameter in &block.params[ahead..] {
                    count(&mut places, func.ty(parameter), nodes.value(index, parameter));
                }
                for &v in &block.ops {
                    match func.op(v) {
                        Some(&Op::PropGet { obj, .. }) => {
                            count(&mut receivers, func.ty(obj), nodes.value(index, obj));
                            count(&mut reads, func.ty(v), nodes.value(index, v));
                        }
                        Some(Op::ElemGet { .. }) => count(&mut reads, func.ty(v), nodes.value(index, v)),
                        _ => {}
                    }
                }
            }
        }
        for (index, layout) in program.layouts.iter().enumerate().filter(|(_, layout)| layout.kind != LayoutKind::Environment && layout.is_allocated) {
            for (number, field) in layout.fields.iter().enumerate() {
                let node = nodes.field(LayoutId::new(index), number as u32);
                count(&mut places, field.declared, node);
                count(&mut fields, field.declared, node);
                if is_fact(field.declared) && program.tys.get(field.declared).has_objects() {
                    count(&mut references, field.declared, node);
                }
            }
        }
        [places, reads, receivers, fields, references]
    };
    let share = |(part, whole): (usize, usize)| if whole == 0 { "-".to_string() } else { format!("{:.1}%", 100.0 * part as f64 / whole as f64) };
    let line = |what: String, kinds: u32| {
        let [places, reads, receivers, fields, references] = counted(kinds);
        format!("strangers: {what}: facts: places {}, reads {}, receivers {}, fields {}, fields that hold references {}", share(places), share(reads), share(receivers), share(fields), share(references))
    };
    let mut lines = vec![format!("strangers: {} nodes, {} edges, {} arguments; nothing is applied: what would stay a fact if an object that is not laid out stayed what it is wherever it gets", nodes.count, flows.edges.len(), flows.arguments.len())];
    lines.push(line("today, nothing taken away".to_string(), 0));
    for (calls, elements) in [(true, true), (true, false), (false, true), (false, false)] {
        let kinds = !(if calls { CALLS_BY_VALUE } else { 0 } | if elements { ELEMENTS } else { 0 });
        lines.push(line(format!("calls by value {}, elements {}", if calls { "trusted" } else { "NOT trusted" }, if elements { "trusted" } else { "NOT trusted" }), kinds));
    }
    for (number, kind) in KINDS.iter().enumerate() {
        lines.push(line(format!("{:>7} births of: {kind}: alone", born[number]), 1 << number));
    }
    // Where such an object first meets a place in which it does not belong: it is born there, or it gets there from a place that may hold it.
    let mut born_at = [[0usize; DOORS.len()]; KINDS.len()];
    let mut enters_at = [[0usize; DOORS.len()]; KINDS.len()];
    for &(node, kind) in &births {
        born_at[kind as usize][door[node as usize] as usize] += usize::from(strict[node as usize]);
    }
    let crossings = flows.edges.iter().chain(&flows.captures).chain(&flows.returns).chain(&flows.calls).copied().chain(flows.arguments.iter().map(|argument| (argument.0, argument.1)));
    for (from, to) in crossings {
        if strict[to as usize] && !strict[from as usize] {
            let mut kinds = reaching[from as usize];
            while kinds != 0 {
                enters_at[kinds.trailing_zeros() as usize][door[to as usize] as usize] += 1;
                kinds &= kinds - 1;
            }
        }
    }
    let listed = |counts: &[usize; DOORS.len()]| {
        let mut sorted: Vec<(usize, &str)> = counts.iter().copied().zip(DOORS).filter(|counted| counted.0 != 0).collect();
        sorted.sort_by(|a, b| b.0.cmp(&a.0));
        if sorted.is_empty() { "nowhere".to_string() } else { sorted.iter().map(|(count, door)| format!("{door} {count}")).collect::<Vec<_>>().join(", ") }
    };
    for (number, kind) in KINDS.iter().enumerate() {
        lines.push(format!("strangers: doors: {kind}: born where it does not belong: {}; gets there at: {}", listed(&born_at[number]), listed(&enters_at[number])));
    }
    lines
}
