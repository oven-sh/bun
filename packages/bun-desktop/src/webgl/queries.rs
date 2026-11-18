//! Queries, fences and transform feedback.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use super::buffers::Range;
use super::context::{Context, Extension, dirty};
use super::decoder::{Answer, Result, bad_enum, bad_state, check_enum, check_state, check_value};
use super::gl::*;
use super::native::{self, Kind, Name};
use super::objects::{Handle, id_of, is};
use super::programs::Program;

/// What the GPU has come to does not change during a task.
#[derive(Default)]
struct Poll {
    task: Cell<u64>,
    is_done: Cell<bool>,
}

impl Poll {
    fn restart(&self, task: u64) {
        self.task.set(task);
        self.is_done.set(false);
    }

    fn is_done(&self, task: u64, ask: impl FnOnce() -> bool) -> bool {
        if !self.is_done.get() && self.task.replace(task) != task {
            self.is_done.set(ask());
        }
        self.is_done.get()
    }
}

pub struct Query {
    pub handle: Handle,
    name: Name,
    target: Cell<u32>,
    poll: Poll,
}

impl Query {
    pub fn new(handle: Handle, _: u32, _: &Context) -> Query {
        Query {
            handle,
            name: Name::new(Kind::Query),
            target: 0.into(),
            poll: Poll::default(),
        }
    }
}

pub struct Fence {
    pub handle: Handle,
    sync: native::Sync,
    poll: Poll,
}

impl Fence {
    pub fn new(handle: Handle, _: u32, context: &Context) -> Fence {
        let poll = Poll {
            task: context.task.into(),
            is_done: false.into(),
        };
        handle.was_bound.set(true);
        Fence {
            handle,
            sync: context.gl.fence_sync(SYNC_GPU_COMMANDS_COMPLETE, 0),
            poll,
        }
    }

    fn is_signaled(&self, context: &Context) -> bool {
        // SAFETY: it has not been deleted.
        self.poll.is_done(
            context.task,
            || unsafe { (context.gl.client_wait_sync)(self.sync, 0, 0) } != TIMEOUT_EXPIRED,
        )
    }
}

impl Drop for Fence {
    fn drop(&mut self) {
        // SAFETY: as above.
        unsafe { (native::gl().delete_sync)(self.sync) };
    }
}

pub struct Capture {
    pub program: Rc<Program>,
    pub mode: u32,
    pub is_paused: bool,
    pub vertices: u64,
    /// For each buffer that is written to, the bytes of a vertex.
    pub targets: Vec<(Range, u64)>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.program.captures.update(|it| it - 1);
        self.targets
            .iter()
            .for_each(|it| it.0.buffer.captures.update(|it| it - 1));
    }
}

pub struct TransformFeedback {
    pub handle: Handle,
    pub name: Name,
    pub buffers: RefCell<[Option<Range>; 4]>,
    pub capture: RefCell<Option<Capture>>,
}

impl TransformFeedback {
    pub fn of(handle: Handle) -> TransformFeedback {
        TransformFeedback {
            handle,
            name: Name::new(Kind::TransformFeedback),
            buffers: RefCell::default(),
            capture: RefCell::default(),
        }
    }

    pub fn new(handle: Handle, _: u32, _: &Context) -> TransformFeedback {
        TransformFeedback::of(handle)
    }

    pub fn is_active(&self) -> bool {
        self.capture.borrow().is_some()
    }

    pub fn is_capturing(&self) -> bool {
        self.capture
            .borrow()
            .as_ref()
            .is_some_and(|it| !it.is_paused)
    }
}

impl Context {
    fn has_timers(&self) -> bool {
        self.has(Extension::TimerQuery) || self.has(Extension::TimerQuery2)
    }

    fn query_slot(&self, target: u32) -> Result<usize> {
        match target {
            ANY_SAMPLES_PASSED | ANY_SAMPLES_PASSED_CONSERVATIVE if self.is_webgl2() => Ok(0),
            TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN if self.is_webgl2() => Ok(1),
            TIME_ELAPSED_EXT if self.has_timers() => Ok(2),
            _ => bad_enum("unknown target"),
        }
    }

    fn check_idle(&self, query: &Rc<Query>, target: u32) -> Result {
        check_state(
            !self.queries.iter().any(|it| is(it, query))
                && [0, target].contains(&query.target.get()),
            "the query is running, or was used with another target",
        )
    }

    pub fn begin_query(&mut self, target: u32, query: Rc<Query>) -> Result {
        let slot = self.query_slot(target)?;
        check_state(self.queries[slot].is_none(), "another query is running")?;
        self.check_idle(&query, target)?;
        query.target.set(target);
        query.handle.was_bound.set(true);
        _ = self.prepare_target();
        self.gl.begin_query(target, query.name.0);
        self.queries[slot] = Some(query);
        Ok(())
    }

    pub fn end_query(&mut self, target: u32) -> Result {
        let slot = self.query_slot(target)?;
        let Some(query) = self.queries[slot].take_if(|it| it.target.get() == target) else {
            return bad_state("no query is running");
        };
        query.poll.restart(self.task);
        self.gl.end_query(target);
        Ok(())
    }

    pub fn forget_query(&mut self, query: &Rc<Query>) {
        if self.queries.iter().any(|it| is(it, query)) {
            _ = self.end_query(query.target.get());
        }
    }

    pub fn query_counter(&mut self, query: Rc<Query>, target: u32) -> Result {
        check_enum(
            target == TIMESTAMP_EXT && self.has_timers(),
            "unknown target",
        )?;
        self.check_idle(&query, target)?;
        query.target.set(target);
        query.handle.was_bound.set(true);
        query.poll.restart(self.task);
        self.gl.query_counter(query.name.0, target);
        Ok(())
    }

    pub fn get_query(&mut self, target: u32, name: u32) -> Result<Answer> {
        match (target, name) {
            (TIME_ELAPSED_EXT | TIMESTAMP_EXT, QUERY_COUNTER_BITS_EXT) if self.has_timers() => {
                let mut bits = 0;
                self.gl.get_queryiv(target, name, &mut bits);
                Ok(Answer::Int(bits))
            }
            (TIMESTAMP_EXT, CURRENT_QUERY) if self.has_timers() => Ok(Answer::Null),
            (_, CURRENT_QUERY) => Ok(Answer::Object(id_of(
                self.queries[self.query_slot(target)?]
                    .as_ref()
                    .filter(|it| it.target.get() == target),
            ))),
            _ => bad_enum("unknown pname"),
        }
    }

    pub fn get_query_parameter(&mut self, query: Rc<Query>, name: u32) -> Result<Answer> {
        check_state(
            query.target.get() != 0 && !self.queries.iter().any(|it| is(it, &query)),
            "the query is running, or has never run",
        )?;
        check_enum(
            matches!(name, QUERY_RESULT | QUERY_RESULT_AVAILABLE),
            "unknown pname",
        )?;
        let get = |name| {
            let mut value = 0;
            self.gl.get_query_objectuiv(query.name.0, name, &mut value);
            value
        };
        let (is_available, mut time) = (
            query
                .poll
                .is_done(self.task, || get(QUERY_RESULT_AVAILABLE) != 0),
            0,
        );
        Ok(match query.target.get() {
            _ if name == QUERY_RESULT_AVAILABLE => Answer::Boolean(is_available),
            _ if !is_available => Answer::Uint(0),
            TIME_ELAPSED_EXT | TIMESTAMP_EXT => {
                self.gl.get_query_objectui64v(query.name.0, name, &mut time);
                Answer::Double(time as f64)
            }
            _ => Answer::Uint(get(name)),
        })
    }

    pub fn client_wait_sync(
        &mut self,
        fence: Rc<Fence>,
        flags: u32,
        waits: bool,
    ) -> Result<Answer> {
        check_state(!waits, "the timeout has to be 0")?;
        check_value(flags & !SYNC_FLUSH_COMMANDS_BIT == 0, "unknown flags")?;
        let was_signaled = fence.poll.is_done.get();
        Ok(Answer::Uint(if was_signaled {
            ALREADY_SIGNALED
        } else if fence.is_signaled(self) {
            CONDITION_SATISFIED
        } else {
            TIMEOUT_EXPIRED
        }))
    }

    pub fn wait_sync(&mut self, _: Rc<Fence>, flags: u32, is_timeout_ignored: bool) -> Result {
        check_value(flags == 0 && is_timeout_ignored, "unknown flags or timeout")
    }

    pub fn get_sync_parameter(&mut self, fence: Rc<Fence>, name: u32) -> Result<Answer> {
        Ok(Answer::Uint(match name {
            OBJECT_TYPE => SYNC_FENCE,
            SYNC_STATUS if fence.is_signaled(self) => SIGNALED,
            SYNC_STATUS => UNSIGNALED,
            SYNC_CONDITION => SYNC_GPU_COMMANDS_COMPLETE,
            SYNC_FLAGS => 0,
            _ => return bad_enum("unknown pname"),
        }))
    }

    pub fn bind_transform_feedback(
        &mut self,
        target: u32,
        feedback: Option<Rc<TransformFeedback>>,
    ) -> Result {
        check_enum(target == TRANSFORM_FEEDBACK, "unknown target")?;
        check_state(
            !self.feedback.is_capturing(),
            "not while transform feedback is capturing",
        )?;
        self.feedback = feedback.unwrap_or_else(|| self.default_feedback.clone());
        self.feedback.handle.was_bound.set(true);
        self.gl
            .bind_transform_feedback(target, self.feedback.name.0);
        self.dirty |= dirty::BUFFERS;
        Ok(())
    }

    /// Some drivers do not want to hear of what another program captures while it is active.
    pub fn without_feedback<R>(&self, link: impl FnOnce() -> R) -> R {
        if !self.feedback.is_active() {
            return link();
        }
        let is_capturing = self.feedback.is_capturing();
        is_capturing.then(|| self.gl.pause_transform_feedback());
        self.gl.bind_transform_feedback(TRANSFORM_FEEDBACK, 0);
        let result = link();
        self.gl
            .bind_transform_feedback(TRANSFORM_FEEDBACK, self.feedback.name.0);
        is_capturing.then(|| self.gl.resume_transform_feedback());
        result
    }

    pub fn forget_transform_feedback(&mut self, feedback: &Rc<TransformFeedback>) {
        if Rc::ptr_eq(feedback, &self.feedback) {
            _ = self.bind_transform_feedback(TRANSFORM_FEEDBACK, None);
        }
    }

    pub fn begin_transform_feedback(&mut self, mode: u32) -> Result {
        check_enum(
            matches!(mode, POINTS | LINES | TRIANGLES),
            "only POINTS, LINES and TRIANGLES can be captured",
        )?;
        check_state(!self.feedback.is_active(), "it has begun")?;
        let Some((program, executable)) = self
            .program
            .clone()
            .and_then(|it| Some((it.clone(), it.executable()?)))
        else {
            return bad_state("there is no current program");
        };
        let (sizes, buffers) = (&executable.captured_bytes, self.feedback.buffers.borrow());
        let targets: Option<Vec<_>> = sizes
            .iter()
            .zip(&*buffers)
            .map(|(size, range)| Some((range.clone()?, *size)))
            .collect();
        let Some(targets) = targets.filter(|it| !it.is_empty()) else {
            return bad_state("there is nothing to capture, or a buffer is missing");
        };
        let is_unique = |it: &Range| {
            buffers
                .iter()
                .flatten()
                .filter(|other| Rc::ptr_eq(&other.buffer, &it.buffer))
                .count()
                == 1
        };
        check_state(
            buffers.iter().flatten().all(is_unique),
            "a buffer is bound twice",
        )?;
        (0..)
            .zip(buffers.iter().take(targets.len()).flatten())
            .for_each(|(index, it)| it.bind(self.gl, TRANSFORM_FEEDBACK_BUFFER, index));
        program.captures.update(|it| it + 1);
        targets
            .iter()
            .for_each(|it| it.0.buffer.captures.update(|it| it + 1));
        self.feedback.capture.replace(Some(Capture {
            program,
            mode,
            is_paused: false,
            vertices: 0,
            targets,
        }));
        self.active_feedback.push(self.feedback.clone());
        self.gl.begin_transform_feedback(mode);
        self.dirty |= dirty::BUFFERS;
        Ok(())
    }

    pub fn end_transform_feedback(&mut self) -> Result {
        let Some(capture) = self.feedback.capture.take() else {
            return bad_state("it has not begun");
        };
        self.active_feedback.retain(|it| it.is_active());
        // Not all drivers can end with another program.
        let [began_with, now] = [capture.program.executable(), self.executable.clone()]
            .map(|it| it.map_or(0, |it| it.name));
        (began_with != now).then(|| self.gl.use_program(began_with));
        self.gl.end_transform_feedback();
        (began_with != now).then(|| self.gl.use_program(now));
        Ok(())
    }

    pub fn pause_transform_feedback(&mut self) -> Result {
        check_state(self.feedback.is_capturing(), "it is not capturing")?;
        self.feedback
            .capture
            .borrow_mut()
            .iter_mut()
            .for_each(|it| it.is_paused = true);
        self.gl.pause_transform_feedback();
        Ok(())
    }

    pub fn resume_transform_feedback(&mut self) -> Result {
        let mut capture = self.feedback.capture.borrow_mut();
        let Some(capture) = capture
            .as_mut()
            .filter(|it| it.is_paused && is(&self.program, &it.program))
        else {
            return bad_state("it is not paused, or began with another program");
        };
        capture.is_paused = false;
        self.gl.resume_transform_feedback();
        self.dirty |= dirty::BUFFERS;
        Ok(())
    }
}
