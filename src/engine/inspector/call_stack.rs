//! Stack traces as the `Console` domain describes them, and their continuation in the code that scheduled a call.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_engine_number::NumberText;
use bun_engine_text::StringRef;
use bun_engine_vm::{FastHashMap, LineColumn, StackFrame, StackVisitor, Vm};

use crate::protocol::{Object, object};

pub(crate) struct Frame {
    function_name: StringRef,
    pub(crate) url: StringRef,
    script_id: usize,
    pub(crate) position: LineColumn,
}

pub(crate) fn script_id_text(id: usize) -> StringRef {
    StringRef::from_text(NumberText::from(id as u64).text())
}

impl Frame {
    fn new(vm: &Vm, frame: &StackFrame) -> Frame {
        Frame {
            function_name: match frame.wasm_names(vm) {
                Some(names) => names.qualified(frame.bytecode_offset),
                None => frame.function_name(vm),
            },
            url: match frame.is_wasm {
                true => StringRef::from_literal("[wasm code]"),
                false => frame.source_url(vm),
            },
            script_id: frame.source_provider().map_or(0, |it| it.id()),
            position: frame.line_column().unwrap_or_default(),
        }
    }

    fn is_native(&self) -> bool {
        self.url.text().eq_ascii("[native code]")
    }

    fn to_json(&self) -> Object {
        object! {
            "functionName": &self.function_name,
            "url": &self.url,
            "scriptId": script_id_text(self.script_id),
            "lineNumber": self.position.line,
            "columnNumber": self.position.column,
        }
    }
}

/// A script that is run again has another id.
impl PartialEq for Frame {
    fn eq(&self, other: &Frame) -> bool {
        self.function_name == other.function_name
            && self.url == other.url
            && self.position == other.position
    }
}

#[derive(Default)]
pub(crate) struct CallStack {
    frames: Vec<Frame>,
    is_truncated: bool,
}

impl CallStack {
    pub(crate) const MAX_FRAMES: usize = 200;

    pub(crate) fn capture(vm: &Vm, skip: usize, limit: usize) -> CallStack {
        let frames = StackVisitor::frames(vm).skip(skip);
        let mut frames = frames.filter(|frame| !frame.is_private());
        let kept = frames.by_ref().take(limit);
        CallStack {
            frames: kept.map(|it| Frame::new(vm, &(&it).into())).collect(),
            is_truncated: frames.next().is_some(),
        }
    }

    /// Without the function of `console`, unless that is all.
    pub(crate) fn capture_for_console(vm: &Vm) -> CallStack {
        let stack = Self::capture(vm, 1, Self::MAX_FRAMES);
        if stack.frames.is_empty() {
            return Self::capture(vm, 0, Self::MAX_FRAMES);
        }
        stack
    }

    pub(crate) fn first_script_frame(&self) -> Option<&Frame> {
        self.frames.iter().find(|frame| !frame.is_native())
    }

    pub(crate) fn has_same_frames(&self, other: &CallStack) -> bool {
        self.frames == other.frames
    }

    fn frames_to_json(&self) -> Vec<Object> {
        self.frames.iter().map(Frame::to_json).collect()
    }

    pub(crate) fn to_json(&self, parent: Option<&AsyncTrace>) -> Object {
        object! {
            "callFrames": self.frames_to_json(),
            "truncated" => self.is_truncated.then_some(true),
            "parentStackTrace" => parent.and_then(AsyncTrace::to_json),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum AsyncCallType {
    DomTimer,
    EventListener,
    PostMessage,
    RequestAnimationFrame,
    Microtask,
}

/// Where a call was scheduled, where the call that did so was, and so on.
struct Link {
    stack: Rc<CallStack>,
    parent: Option<Rc<Link>>,
    /// With this one.
    length: usize,
    has_lost_parent: bool,
}

impl Link {
    fn new(stack: Rc<CallStack>, parent: Option<Rc<Link>>, has_lost_parent: bool) -> Rc<Link> {
        Rc::new(Link {
            stack,
            length: parent.as_ref().map_or(0, |it| it.length) + 1,
            parent,
            has_lost_parent,
        })
    }

    /// Up to the one that brings the number of frames to `depth`.
    fn chain(&self, depth: usize) -> Vec<&Link> {
        let mut frames = 0;
        core::iter::successors(Some(self), |link| link.parent.as_deref())
            .take_while(|link| {
                let before = frames;
                frames += link.stack.frames.len();
                before < depth
            })
            .collect()
    }

    fn truncated(&self, depth: usize) -> Option<Rc<Link>> {
        self.chain(depth).iter().rfold(None, |parent, link| {
            let is_last = parent.is_none();
            Some(Link::new(Rc::clone(&link.stack), parent, is_last))
        })
    }
}

#[derive(Clone)]
pub(crate) struct AsyncTrace {
    first: Rc<Link>,
    depth: usize,
}

impl AsyncTrace {
    /// `None` if there is nothing to see but the functions that schedule.
    pub(crate) fn to_json(&self) -> Option<Object> {
        let chain = self.first.chain(self.depth);
        let links = chain.iter().enumerate();
        links.rfold(None, |parent, (index, link)| {
            let is_truncated =
                link.has_lost_parent || (index + 1 == chain.len() && link.parent.is_some());
            let starts_with_scheduler = link.stack.frames[0].is_native();
            if starts_with_scheduler && !is_truncated && link.stack.frames.len() == 1 {
                return parent;
            }
            Some(object! {
                "callFrames": link.stack.frames_to_json(),
                "truncated" => is_truncated.then_some(true),
                "topCallFrameIsBoundary" => starts_with_scheduler.then_some(true),
                "parentStackTrace" => parent,
            })
        })
    }
}

type CallId = (AsyncCallType, u64);

struct ScheduledCall {
    link: Rc<Link>,
    will_repeat: bool,
}

#[derive(Default)]
pub(crate) struct AsyncCalls {
    /// Zero if nothing is tracked.
    depth: Cell<usize>,
    scheduled: RefCell<FastHashMap<CallId, ScheduledCall>>,
    running: RefCell<Vec<CallId>>,
}

impl AsyncCalls {
    pub(crate) fn set_depth(&self, depth: usize) {
        self.depth.set(depth.min(CallStack::MAX_FRAMES));
        if depth == 0 {
            self.clear();
        }
    }

    pub(crate) fn clear(&self) {
        self.scheduled.take();
        self.running.take();
    }

    /// Of the call that is running.
    pub(crate) fn current_trace(&self) -> Option<AsyncTrace> {
        let scheduled = self.scheduled.borrow();
        Some(AsyncTrace {
            first: Rc::clone(&scheduled.get(self.running.borrow().last()?)?.link),
            depth: self.depth.get(),
        })
    }

    pub(crate) fn did_schedule(&self, vm: &Vm, id: CallId, is_single_shot: bool) {
        if self.depth.get() == 0 {
            return;
        }
        let stack = CallStack::capture(vm, 0, self.depth.get());
        if stack.frames.is_empty() {
            return;
        }
        let mut parent = self.current_trace().map(|it| it.first);
        if let Some(long) = parent.take_if(|it| it.length > 2 * self.depth.get()) {
            parent = long.truncated(self.depth.get());
        }
        let call = ScheduledCall {
            link: Link::new(Rc::new(stack), parent, false),
            will_repeat: !is_single_shot,
        };
        self.scheduled.borrow_mut().insert(id, call);
    }

    pub(crate) fn did_cancel(&self, id: CallId) {
        if let Some(call) = self.scheduled.borrow_mut().get_mut(&id) {
            call.will_repeat = false;
        }
        self.forget_if_done(id);
    }

    pub(crate) fn will_dispatch(&self, id: CallId) {
        if self.scheduled.borrow().contains_key(&id) {
            self.running.borrow_mut().push(id);
        }
    }

    pub(crate) fn did_dispatch(&self, id: CallId) {
        let last = self.running.borrow().iter().rposition(|&it| it == id);
        if let Some(last) = last {
            self.running.borrow_mut().remove(last);
        }
        self.forget_if_done(id);
    }

    fn forget_if_done(&self, id: CallId) {
        let mut scheduled = self.scheduled.borrow_mut();
        if scheduled.get(&id).is_some_and(|call| !call.will_repeat)
            && !self.running.borrow().contains(&id)
        {
            scheduled.remove(&id);
        }
    }
}
