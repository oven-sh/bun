//! What the library reports, until it is handled.

use core::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::Rc;
use std::time::Instant;

use bun_jsc::js_promise::Strong as Promise;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use crate::later::{self, Timer};
use crate::protocol::{
    Command, Event, Input, Mouse, MouseAction, Reply, Request, SurfaceCommand, SystemRequest,
};

/// The `source` of a `pump` that only waits for the UI.
const NO_SOURCE: isize = -1;
const FOREVER: i64 = -1;

type Settle = Box<dyn FnOnce(&JSGlobalObject, Reply) -> JsResult<()>>;

struct Queue {
    /// `None` was handled out of turn.
    events: RefCell<VecDeque<Option<Event>>>,
    is_dispatching: Cell<bool>,
    waits: Cell<u32>,
    last_reply: Cell<u32>,
    replies: RefCell<Vec<(u32, Settle)>>,
    frames: RefCell<Vec<u32>>,
    frame_interval: Cell<f64>,
    /// Moves of the mouse are reported about once a frame.
    held: Cell<Option<(u32, Mouse)>>,
    last_move: Cell<Option<Instant>>,
    hold_timer: Cell<Option<Timer>>,
}

impl Default for Queue {
    fn default() -> Self {
        Queue {
            events: RefCell::default(),
            is_dispatching: Cell::default(),
            waits: Cell::default(),
            last_reply: Cell::default(),
            replies: RefCell::default(),
            frames: RefCell::default(),
            frame_interval: Cell::new(1000. / 60.),
            held: Cell::default(),
            last_move: Cell::default(),
            hold_timer: Cell::default(),
        }
    }
}

crate::state!(fn queue() -> Queue);

impl Queue {
    fn receive(&self) {
        const BATCH: usize = 32;
        let Some(ui) = crate::loaded() else { return };
        let mut batch = Vec::with_capacity(BATCH);
        loop {
            // SAFETY: it has room for that many, and `drain` has written as many as it says.
            unsafe {
                let length = (ui.drain)(batch.as_mut_ptr(), BATCH);
                batch.set_len(length);
            }
            if batch.is_empty() {
                return;
            }
            self.events.borrow_mut().extend(batch.drain(..).map(Some));
        }
    }

    fn is_busy(&self) -> bool {
        self.is_dispatching.get() || self.waits.get() > 0
    }

    /// After each event: the next one has to reach the handlers that close over the new state.
    fn render(&self, global: &JSGlobalObject) -> JsResult<()> {
        unsafe extern "C" {
            safe fn Bun__Render__flush(global: &JSGlobalObject) -> bool;
        }
        bun_jsc::call_false_is_throw(global, || Bun__Render__flush(global))
    }

    fn forget_frame(&self, surface: u32) {
        let mut frames = self.frames.borrow_mut();
        if let Some(index) = frames.iter().position(|it| *it == surface) {
            frames.swap_remove(index);
            crate::release();
        }
    }

    fn deliver(&self, global: &JSGlobalObject, event: Event) -> JsResult<()> {
        match event {
            Event::Surface { id, input } => {
                if let Input::Frame { interval, .. } = input {
                    self.forget_frame(id);
                    self.frame_interval.set(interval);
                }
                crate::surfaces::deliver(global, id, input)
            }
            Event::Window { id, event } => {
                (crate::session().listeners.get()).map_or(Ok(()), |it| (it.window)(id, event))
            }
            Event::System(event) => {
                (crate::session().listeners.get()).map_or(Ok(()), |it| (it.system)(event))
            }
            Event::Reply { id, reply } => {
                let index = self.replies.borrow().iter().position(|it| it.0 == id);
                let Some(index) = index else { return Ok(()) };
                let (_, settle) = self.replies.borrow_mut().swap_remove(index);
                crate::release();
                settle(global, reply)
            }
            Event::Warning(message) => crate::warn(global, &message),
            Event::Fatal(message) => {
                crate::session().keep_alive.unref(bun_io::js_vm_ctx());
                Err(global.throw(format_args!("{}", &*message)))
            }
        }
    }

    /// Puts it in front of what has not been handled.
    fn stop_holding(&self) {
        self.hold_timer.take();
        self.last_move.set(None);
        if let Some((id, mouse)) = self.held.take() {
            let input = Input::Mouse(mouse);
            (self.events.borrow_mut()).push_front(Some(Event::Surface { id, input }));
        }
    }

    fn release_held_after(&'static self, delay: f64) {
        self.hold_timer.set(Some(later::after(delay, move |global| {
            if self.is_busy() {
                self.release_held_after(delay);
                return Ok(());
            }
            self.stop_holding();
            self.handle(global, false)
        })));
    }

    /// Whether the first one was taken out, to wait.
    fn defers(&'static self) -> bool {
        let first = match self.events.borrow().front() {
            Some(
                None
                | Some(Event::Surface {
                    input: Input::Scroll { .. },
                    ..
                }),
            ) => return false,
            Some(Some(Event::Surface {
                id,
                input: Input::Mouse(mouse),
            })) => (mouse.action == MouseAction::Move).then_some((*id, *mouse)),
            _ => None,
        };
        let kind = |(id, it): (u32, Mouse)| (id, it.at.modifiers, it.at.is_handled, it.buttons);
        if self
            .held
            .get()
            .is_some_and(|held| first.map(kind) != Some(kind(held)))
        {
            self.stop_holding();
            return self.defers();
        }
        if first.is_none() {
            return false;
        }
        let (now, interval) = (Instant::now(), self.frame_interval.get());
        let since = |last: Instant| (now - last).as_secs_f64() * 1000.;
        let left = self
            .last_move
            .get()
            .map_or(0., |it| interval * 0.75 - since(it));
        if left <= 0. {
            self.last_move.set(Some(now));
            self.hold_timer.take();
            self.held.set(None);
            return false;
        }
        self.events.borrow_mut().pop_front();
        if self.held.replace(first).is_none() {
            self.release_held_after(left + interval * 0.5);
        }
        true
    }

    fn dispatch_all(&'static self, global: &JSGlobalObject, inside_script: bool) -> JsResult<()> {
        // A handler that blocks in `wait_until` adds to the queue.
        while !self.events.borrow().is_empty() {
            if self.defers() {
                continue;
            }
            let Some(event) = self.events.borrow_mut().pop_front().flatten() else {
                continue;
            };
            crate::report(global, self.deliver(global, event))?;
            if !inside_script {
                global.bun_vm().drain_microtasks();
            }
            self.render(global)?;
        }
        Ok(())
    }

    fn handle(&'static self, global: &JSGlobalObject, inside_script: bool) -> JsResult<()> {
        self.receive();
        if self.is_busy() {
            return Ok(());
        }
        self.is_dispatching.set(true);
        let result = self.dispatch_all(global, inside_script);
        self.is_dispatching.set(false);
        if let Some(ui) = crate::loaded() {
            (ui.present)();
        }
        result
    }

    fn wait(
        &self,
        global: &JSGlobalObject,
        is_done: &dyn Fn() -> JsResult<bool>,
        accepts: &dyn Fn(&Event) -> bool,
    ) -> JsResult<()> {
        let ui = crate::renderer(global)?;
        let mut at = self.events.borrow().len();
        loop {
            self.render(global)?;
            if is_done()? {
                return Ok(());
            }
            while !(ui.pump)(NO_SOURCE, FOREVER, false) {}
            self.receive();
            while at < self.events.borrow().len() {
                let accepted = match &mut self.events.borrow_mut()[at] {
                    Some(Event::Fatal(message)) => {
                        return Err(global.throw(format_args!("{}", &**message)));
                    }
                    event => event.take_if(|it| accepts(it)),
                };
                at += 1;
                if let Some(event) = accepted {
                    crate::report(global, self.deliver(global, event))?;
                }
            }
            (ui.present)();
        }
    }
}

pub(crate) fn handle_events(global: &JSGlobalObject) -> JsResult<()> {
    queue().handle(global, false)
}

pub fn render(global: &JSGlobalObject) -> JsResult<()> {
    queue().render(global)
}

/// False if it has thrown.
#[unsafe(no_mangle)]
extern "C" fn Bun__UI__settleIfStarted(global: &JSGlobalObject) -> bool {
    !crate::is_started() || settle(global).is_ok()
}

/// Handles what has happened up to now, as far as the UI thread knows.
pub fn settle(global: &JSGlobalObject) -> JsResult<()> {
    let queue = queue();
    queue.render(global)?;
    loop {
        if queue.held.get().is_some() && queue.waits.get() == 0 {
            queue.stop_holding();
        }
        queue.handle(global, true)?;
        if queue.held.get().is_none() || queue.waits.get() != 0 {
            return Ok(());
        }
    }
}

/// Blocks the thread, and handles the events that it `accepts`. The others are left for the event loop.
pub fn wait_until(
    global: &JSGlobalObject,
    is_done: &dyn Fn() -> JsResult<bool>,
    accepts: &dyn Fn(&Event) -> bool,
) -> JsResult<()> {
    let queue = queue();
    queue.waits.update(|it| it + 1);
    let result = queue.wait(global, is_done, accepts);
    queue.waits.update(|it| it - 1);
    if !queue.events.borrow().is_empty() && !queue.is_dispatching.get() {
        later::handle_events_soon();
    }
    result
}

pub fn is_input_pending(includes_continuous: bool) -> bool {
    if !crate::is_started() {
        return false;
    }
    let queue = queue();
    let before = queue.events.borrow().len();
    queue.receive();
    let events = queue.events.borrow();
    if events.len() > before && !queue.is_busy() {
        later::handle_events_soon();
    }
    events.iter().flatten().any(|event| match event {
        Event::Surface { input, .. } => match input {
            Input::Key(_) | Input::Text { .. } => true,
            Input::Mouse(mouse) => includes_continuous || mouse.action != MouseAction::Move,
            Input::Wheel(_) => includes_continuous,
            _ => false,
        },
        _ => false,
    })
}

/// Whether an input method has done something that the page has not seen.
pub fn are_edits_waiting() -> bool {
    let is_edit = |input: &Input| {
        matches!(
            input,
            Input::Text { .. } | Input::Compose { .. } | Input::EndComposition
        )
    };
    (queue().events.borrow().iter().flatten())
        .any(|event| matches!(event, Event::Surface { input, .. } if is_edit(input)))
}

/// In milliseconds.
pub fn frame_interval() -> f64 {
    queue().frame_interval.get()
}

/// One [`Input::Frame`] before the surface is next drawn.
pub fn request_frame(id: u32) {
    let (Some(ui), queue) = (crate::loaded(), queue()) else {
        return;
    };
    if !queue.frames.borrow().contains(&id) {
        (ui.tell)(Command::Surface {
            id,
            command: SurfaceCommand::RequestFrame,
        });
        queue.frames.borrow_mut().push(id);
        crate::hold();
    }
}

pub fn destroy_surface(global: &JSGlobalObject, id: u32) -> JsResult<()> {
    queue().forget_frame(id);
    crate::surfaces::forget_page(id);
    crate::tell(
        global,
        Command::Surface {
            id,
            command: SurfaceCommand::Destroy,
        },
    )
}

pub(crate) fn next_reply() -> u32 {
    let last = &queue().last_reply;
    last.update(|it| it.wrapping_add(1));
    last.get()
}

pub(crate) fn expect_reply(id: u32, settle: Settle) {
    queue().replies.borrow_mut().push((id, settle));
    crate::hold();
}

/// `settle` is called once, and at once if it cannot be asked for.
pub fn request(
    global: &JSGlobalObject,
    request: Request,
    settle: impl FnOnce(&JSGlobalObject, Reply) -> JsResult<()> + 'static,
) -> JsResult<()> {
    let ui = match request {
        Request::DecodeFont(_) | Request::System(SystemRequest::ReadKeychain { .. }) => {
            crate::renderer(global)?
        }
        _ => crate::start(global)?,
    };
    let id = next_reply();
    match (ui.request)(id, request).get() {
        Some(reason) => settle(global, Reply::Failed(reason)),
        None => {
            expect_reply(id, Box::new(settle));
            Ok(())
        }
    }
}

/// What settles `promise` with what `convert` makes of a reply. It gets no [`Reply::Failed`].
pub(crate) fn settling(
    mut promise: Promise,
    convert: impl FnOnce(&JSGlobalObject, Reply) -> JsResult<JSValue> + 'static,
) -> impl FnOnce(&JSGlobalObject, Reply) -> JsResult<()> + 'static {
    move |global, reply| match reply {
        Reply::Failed(reason) => {
            let error = global.create_error_instance(format_args!("{}", &*reason));
            promise.reject(global, Ok(error))
        }
        reply => promise.settle(global, convert(global, reply)),
    }
}

pub fn promise_of(
    global: &JSGlobalObject,
    it: Request,
    convert: impl FnOnce(&JSGlobalObject, Reply) -> JsResult<JSValue> + 'static,
) -> JsResult<JSValue> {
    let promise = Promise::init(global);
    let value = promise.value();
    request(global, it, settling(promise, convert))?;
    Ok(value)
}

/// Does not return a [`Reply::Failed`].
pub fn request_and_wait(global: &JSGlobalObject, it: Request) -> JsResult<Reply> {
    let answer = Rc::new(RefCell::new(None));
    let slot = Rc::clone(&answer);
    request(global, it, move |_, reply| {
        slot.replace(Some(reply));
        Ok(())
    })?;
    let is_done = || Ok(answer.borrow().is_some());
    wait_until(global, &is_done, &|event| {
        matches!(event, Event::Reply { .. })
    })?;
    match answer.take().expect("it is done") {
        Reply::Failed(reason) => Err(global.throw(format_args!("{}", &*reason))),
        reply => Ok(reply),
    }
}
