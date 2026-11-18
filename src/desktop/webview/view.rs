//! A page in the web engine: its pixels, and the input that goes to it.

use core::future::Future;
use std::collections::VecDeque;
use std::rc::{Rc, Weak};

use bun_ui::Region;
use bun_ui::TREE_OF_IMAGE;
use bun_ui::protocol::{
    Clipboard, ClipboardPart, Cursor, DragPhase, FramePixels, Input, InputField, Key, Located,
    Mouse, MouseAction, SurfaceCommand, WebViewCommand,
};
use bun_ui::surfaces::{self, News};

use super::accessibility::Tree;
use super::engine::{Engine, Hold, Kind, Order, Target as Remotely};
use super::keys;
use super::remote::Remote;
use crate::menu::{Menu, MenuItem};
use crate::prelude::*;
use crate::task::{self, Later, LocalFuture, Timer, within};
use crate::text::replace;
use crate::value::{Value, quote};
use crate::{dialog, files};
use bun_ui::protocol::{ALT, CONTROL, META, SHIFT};

/// For so long a page that is busy holds up its input.
const STEP_MS: u64 = 500;
const DRAW_MS: u64 = 30_000;
/// What `print()` alerts. The two are allowed in the same places.
pub(super) const WISH_TO_PRINT: &str = "bun:desktop:print";
const WORLD: &str = "bun:desktop";
/// It runs beside the scripts of the page, which do not see it. What it returns is only as honest as their process.
const AGENT: &str = concat!(
    "{const isMac=",
    cfg!(target_os = "macos"),
    ";",
    include_str!("agent.js"),
    "}"
);

/// The frames of a page that are in one process.
pub(super) struct Target {
    pub(super) session: Rc<str>,
    pub(super) frame: Box<str>,
    parent: Weak<Target>,
    pub(super) children: RefCell<Vec<Rc<Target>>>,
    world: RefCell<Option<Later<Option<i32>>>>,
    is_watched: Cell<bool>,
    /// Where it was last seen, and its scale.
    place: Cell<[f64; 3]>,
}

impl Target {
    fn to_local(&self, at: Located) -> [f64; 2] {
        let [x, y, scale] = self.place.get();
        [(f64::from(at.x) - x) / scale, (f64::from(at.y) - y) / scale]
    }

    fn describe(&self, at: Located, magnified: f64) -> Value {
        let [x, y] = self.to_local(at).map(|it| it * magnified);
        record! { "x": x, "y": y, "modifiers": keys::modifiers(at.modifiers) }
    }

    fn descend(&self, found: &Value) -> Option<Rc<Target>> {
        let child = self
            .children
            .borrow()
            .iter()
            .find(|it| found[0].is(&it.frame))
            .cloned()?;
        let [x, y, scale] = self.place.get();
        child.place.set([
            x + found[1].number() * scale,
            y + found[2].number() * scale,
            scale * found[3].number(),
        ]);
        Some(child)
    }
}

type Slot = RefCell<Option<Rc<Target>>>;

fn holds(slot: &Slot, target: &Rc<Target>) -> bool {
    slot.borrow()
        .as_ref()
        .is_some_and(|it| Rc::ptr_eq(it, target))
}

pub(super) struct Painted {
    pub(super) size: [f64; 2],
    /// What has changed, if that is known.
    pub(super) area: Option<[f64; 4]>,
}

pub(super) struct View {
    pub(super) id: i32,
    pub(super) image: u32,
    pub(super) engine: Rc<Engine>,
    pub(super) surface: u32,
    /// Device pixels for each pixel of `size`.
    pub(super) scale: f64,
    pub(super) zoom: Cell<f64>,
    /// What the engine scales the page by after it has laid it out. Its input is scaled alike.
    pub(super) magnified: Cell<f64>,
    /// Pixels of the image for each unit of the display list that has it.
    pub(super) shown_at: Cell<f64>,
    pub(super) may_rest: Cell<bool>,
    pub(super) frame_rate: Cell<f64>,
    pub(super) target_id: Later<Option<Rc<str>>>,
    is_frame: bool,
    root: Later<Option<Rc<Target>>>,
    hold: Cell<Option<Hold>>,
    size: Cell<[f64; 2]>,
    queue: RefCell<VecDeque<LocalFuture<'static, ()>>>,
    is_busy: Cell<bool>,
    last_is_move: Cell<bool>,
    is_drawn: Cell<bool>,
    until_drawn: RefCell<Option<Later<()>>>,
    with_focus: Slot,
    hovered: Slot,
    captured: Slot,
    has_popup: Cell<bool>,
    popup_watch: Cell<Option<Timer>>,
    awaits_regions: Cell<bool>,
    pressed: RefCell<Option<Key>>,
    drag: RefCell<Option<Value>>,
    composition: RefCell<String>,
    caret: Cell<Option<Rect>>,
    is_in_password: Cell<bool>,
    tooltip: RefCell<Option<Rc<Timer>>>,
    is_visible: Cell<bool>,
    is_resting: Cell<bool>,
    rest: Cell<Option<Timer>>,
    has_mouse: Cell<bool>,
    cursor: Cell<Cursor>,
    tree: Tree,
    tree_cost: Cell<u64>,
    is_tree_stale: Cell<bool>,
    updates_tree: Cell<bool>,
    is_destroyed: Cell<bool>,
}

fn button_name(button: u8) -> Value {
    ["left", "middle", "right", "back", "forward"]
        .get(button as usize)
        .copied()
        .into()
}

impl View {
    pub(super) fn new(
        engine: &Rc<Engine>,
        surface: u32,
        size: [f64; 2],
        scale: f64,
        is_frame: bool,
    ) -> JsResult<Rc<View>> {
        let id = engine.new_id();
        let file = file_of(engine, id);
        if let Some(file) = &file {
            files::or_throw(files::write(file, b"", 0o600))?;
        }
        let image = answer((ui()?.open_web_view)(
            file.as_deref().map(Text::from).into(),
        ))?;
        let view = Rc::new(View {
            id,
            image,
            engine: Rc::clone(engine),
            surface,
            scale,
            zoom: 1.0.into(),
            magnified: 1.0.into(),
            shown_at: scale.into(),
            may_rest: true.into(),
            frame_rate: 60.0.into(),
            target_id: Default::default(),
            is_frame,
            root: Default::default(),
            hold: Some(engine.hold()).into(),
            size: size.into(),
            queue: Default::default(),
            is_busy: Default::default(),
            last_is_move: Default::default(),
            is_drawn: Default::default(),
            until_drawn: Default::default(),
            with_focus: Default::default(),
            hovered: Default::default(),
            captured: Default::default(),
            has_popup: Default::default(),
            popup_watch: Default::default(),
            awaits_regions: Default::default(),
            pressed: Default::default(),
            drag: Default::default(),
            composition: Default::default(),
            caret: Default::default(),
            is_in_password: Default::default(),
            tooltip: Default::default(),
            is_visible: true.into(),
            is_resting: Default::default(),
            rest: Default::default(),
            has_mouse: Default::default(),
            cursor: Cursor::Arrow.into(),
            tree: Default::default(),
            tree_cost: Default::default(),
            is_tree_stale: Default::default(),
            updates_tree: Default::default(),
            is_destroyed: Default::default(),
        });
        let listener = Rc::clone(&view);
        surfaces::listen_with(TREE_OF_IMAGE | image, move |news| match news {
            News::Input(input) => listener.input(input),
            News::AccessibilityChanged => {
                listener.update_tree_after(0);
                Ok(())
            }
        });
        let it = Rc::clone(&view);
        task::spawn(async move {
            let mut root = None;
            if let (Some(session), Some(target)) = (it.attach().await, it.target_id.clone().await) {
                root = Some(it.adopt(session, &target, None));
            }
            it.root.set(root);
        });
        Ok(view)
    }

    /// Returns the id of a new session of the DevTools protocol.
    pub(super) async fn attach(&self) -> Option<Rc<str>> {
        self.engine
            .attach(&self.target_id.clone().await?)
            .await
            .ok()
    }

    fn owner(&self) -> Option<&'static Remote> {
        self.engine.view(self.id)
    }

    /// For `Order::Create`.
    pub(super) fn describe(&self, session: i32, preferences: Value) -> Value {
        let [width, height] = self.size.get();
        record! {
            "id": self.id,
            "scale": self.scale,
            "isFrame": self.is_frame,
            "session": session,
            "preferences": preferences,
            "width": width,
            "height": height,
            "file": file_of(&self.engine, self.id),
            "frameRate": self.frame_rate.get(),
        }
    }

    pub(super) fn tell_page(&self, method: &str, arguments: Value) {
        self.engine.tell(Remotely::View(self.id), method, arguments);
    }

    pub(super) fn tell_window(&self, method: &str, arguments: Value) {
        self.engine
            .tell(Remotely::Window(self.id), method, arguments);
    }

    fn tell_surface(&self, command: SurfaceCommand) {
        task::report(tell(Command::Surface {
            id: self.surface,
            command,
        }));
    }

    fn adopt(
        self: &Rc<Self>,
        session: Rc<str>,
        frame: &str,
        parent: Option<&Rc<Target>>,
    ) -> Rc<Target> {
        let target = Rc::new(Target {
            session,
            frame: frame.into(),
            parent: parent.map_or_else(Weak::new, Rc::downgrade),
            children: Default::default(),
            world: Default::default(),
            is_watched: Default::default(),
            place: [0., 0., 1.].into(),
        });
        if let Some(parent) = parent {
            parent
                .children
                .borrow_mut()
                .retain(|it| *it.frame != *frame);
            parent.children.borrow_mut().push(Rc::clone(&target));
            parent.world.take();
        }
        self.is_drawn.set(false);
        self.accessibility_changed();
        let (view, about) = (Rc::clone(self), Rc::clone(&target));
        self.engine.listen(
            &target.session,
            Rc::new(move |method, params| {
                view.notice(&about, method, params);
                Ok(())
            }),
        );
        let frames = list![record! { "type": "iframe" }];
        let print = format!(
            "print=Object.defineProperty(alert.bind(window,'{WISH_TO_PRINT}'),'name',{{value:'print'}})"
        );
        for (method, params) in [
            (
                "Target.setAutoAttach",
                record! { "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true, "filter": frames },
            ),
            ("Input.setInterceptDrags", record! { "enabled": true }),
            ("Page.enable", record! {}),
            (
                "Page.addScriptToEvaluateOnNewDocument",
                record! { "source": print, "runImmediately": true },
            ),
            (
                "Page.setInterceptFileChooserDialog",
                record! { "enabled": true },
            ),
            ("Runtime.runIfWaitingForDebugger", record! {}),
        ] {
            self.engine.command(method, params, &target.session);
        }
        target
    }

    fn notice(self: &Rc<Self>, target: &Rc<Target>, method: &str, params: &Value) {
        match method {
            "Target.attachedToTarget" => {
                self.adopt(
                    params["sessionId"].text().into(),
                    params["targetInfo"]["targetId"].text(),
                    Some(target),
                );
            }
            "Target.detachedFromTarget" => {
                let child = target
                    .children
                    .borrow()
                    .iter()
                    .find(|it| params["targetId"].is(&it.frame))
                    .cloned();
                if let Some(it) = child {
                    self.forget(&it);
                }
            }
            "Page.frameNavigated" => self.is_drawn.set(false),
            "Input.dragIntercepted" => self.start_drag(params["data"].clone()),
            "Page.fileChooserOpened" => {
                task::spawn(Rc::clone(self).choose_files(Rc::clone(target), params.clone()));
            }
            _ => {}
        }
    }

    async fn choose_files(self: Rc<Self>, target: Rc<Target>, params: Value) {
        let show = || {
            let properties = match params["mode"].is("selectMultiple") {
                true => list!["openFile", "multiSelections"],
                false => list!["openFile"],
            };
            let window = self.owner().and_then(Remote::window);
            let window = window.map_or(JSValue::UNDEFINED, JsInterface::to_js);
            invoke(
                dialog::object(),
                "showOpenDialog",
                &[window, js(&record! { "properties": properties })?],
            )
        };
        if let Ok(chosen) = task::outcome(show()).await
            && let Ok(Ok(chosen)) = catch(super::wire::data_from_js(chosen.get()))
        {
            let files = record! { "files": &chosen["filePaths"], "backendNodeId": &params["backendNodeId"] };
            self.engine
                .command("DOM.setFileInputFiles", files, &target.session);
        }
    }

    fn forget(&self, target: &Rc<Target>) {
        target.children.take().iter().for_each(|it| self.forget(it));
        if let Some(parent) = target.parent.upgrade() {
            parent
                .children
                .borrow_mut()
                .retain(|it| !Rc::ptr_eq(it, target));
        }
        self.engine.ignore(&target.session);
        for slot in [&self.with_focus, &self.hovered, &self.captured] {
            if holds(slot, target) {
                slot.take();
            }
        }
    }

    /// `undefined` if it fails.
    pub(super) fn ask(
        &self,
        target: &Target,
        method: &str,
        params: Value,
    ) -> impl Future<Output = Value> + use<> {
        let reply = self.engine.inspect(method, params, &target.session);
        async { reply.await.unwrap_or_default() }
    }

    async fn create_world(self: Rc<Self>, target: Rc<Target>) -> Option<i32> {
        let world =
            record! { "frameId": &*target.frame, "worldName": WORLD, "grantUniveralAccess": true };
        let id = self.ask(&target, "Page.createIsolatedWorld", world).await["executionContextId"]
            .as_number()?;
        let agent = record! { "expression": AGENT, "contextId": id, "silent": true };
        self.engine
            .inspect("Runtime.evaluate", agent, &target.session)
            .await
            .ok()?;
        let children = target.children.borrow().clone();
        for child in children {
            let owner = self
                .ask(
                    &target,
                    "DOM.getFrameOwner",
                    record! { "frameId": &*child.frame },
                )
                .await;
            let node =
                record! { "backendNodeId": &owner["backendNodeId"], "executionContextId": id };
            let object =
                self.ask(&target, "DOM.resolveNode", node).await["object"].pick(&["objectId"]);
            let call = record! {
                "functionDeclaration": "function(id){owners.set(id,this)}",
                "arguments": list![record! { "value": &*child.frame }],
            };
            self.ask(&target, "Runtime.callFunctionOn", call.and(&object))
                .await;
            self.engine
                .command("Runtime.releaseObject", object, &target.session);
        }
        Some(id as i32)
    }

    async fn world(self: &Rc<Self>, target: &Rc<Target>) -> Option<i32> {
        let known = target.world.borrow().clone();
        let world = known.unwrap_or_else(|| {
            let world = Later::of(Rc::clone(self).create_world(Rc::clone(target)));
            target.world.replace(Some(world.clone()));
            world
        });
        world.await
    }

    async fn evaluate(self: &Rc<Self>, target: &Rc<Target>, expression: &str) -> Value {
        for _ in 0..2 {
            if let Some(world) = self.world(target).await {
                let params = record! {
                    "expression": expression,
                    "contextId": world,
                    "returnByValue": true,
                    "silent": true,
                    "timeout": 500,
                    "awaitPromise": true,
                };
                if let Ok(mut reply) = self
                    .engine
                    .inspect("Runtime.evaluate", params, &target.session)
                    .await
                {
                    return reply.take("result").take("value");
                }
            }
            target.world.take();
        }
        Value::Undefined
    }

    async fn root(&self) -> Option<Rc<Target>> {
        self.root.clone().await
    }

    /// Electron does not find the frame under the mouse in a page that is offscreen.
    async fn target_at(self: &Rc<Self>, at: Located) -> Option<Rc<Target>> {
        if self.engine.kind == Kind::Electron {
            self.frame_at(at).await
        } else {
            self.root().await
        }
    }

    async fn call_at(self: &Rc<Self>, target: &Rc<Target>, function: &str, at: Located) -> Value {
        let [x, y] = target.to_local(at);
        self.evaluate(target, &format!("{function}({x},{y})")).await
    }

    async fn frame_at(self: &Rc<Self>, at: Located) -> Option<Rc<Target>> {
        let mut target = self.root().await?;
        while !target.children.borrow().is_empty()
            && let Some(child) = target.descend(&self.call_at(&target, "hit", at).await)
        {
            target = child;
        }
        Some(target)
    }

    async fn ask_at(self: &Rc<Self>, function: &str, at: Located) -> Option<Value> {
        Some(self.call_at(&self.frame_at(at).await?, function, at).await)
    }

    async fn focused(self: &Rc<Self>) -> Option<(Rc<Target>, Value)> {
        let mut target = self.root().await?;
        loop {
            let found = self.evaluate(&target, "focused()").await;
            match target.descend(&found["frame"]) {
                Some(child) => target = child,
                None => return Some((target, found)),
            }
        }
    }

    /// A frame that gets a click while the page is being activated is not always made the focused one.
    async fn focus_around(self: &Rc<Self>, mut target: Rc<Target>) {
        while let Some(parent) = target.parent.upgrade() {
            self.evaluate(&parent, &format!("focusOwner({})", quote(&target.frame)))
                .await;
            target = parent;
        }
    }

    async fn inspect_focus(self: Rc<Self>) -> Option<()> {
        let (target, found) = self.focused().await?;
        let has_popup = found["hasPopup"].is_truthy() && self.engine.kind == Kind::Electron;
        // Nothing tells that it has closed, and it stays painted.
        let view = Rc::clone(&self);
        self.popup_watch
            .set(has_popup.then(|| Timer::new(100, move || view.inspect_focus_next())));
        if self.has_popup.replace(has_popup) && !has_popup {
            self.tell_page("invalidate", list![]);
        }
        self.caret.set(None);
        self.is_in_password.set(found["isPassword"].is_truthy());
        if found["takesText"].is_truthy() || found["list"].is_list() {
            let [x, y, scale] = target.place.get();
            let [left, top, height] = [0, 1, 2].map(|it| found["caret"][it].number() * scale);
            let [x, y] = catch(self.owner()?.to_surface([x + left, y + top]))
                .ok()?
                .ok()?
                .map(finite);
            let caret = Rect {
                x,
                y,
                width: 1.,
                height: finite(height * self.zoom.get()),
            };
            match &found["list"] {
                Value::List(rows) => task::report(self.show_list(&target, rows, caret)),
                _ => self.caret.set(Some(caret)),
            }
        }
        self.with_focus.replace(Some(target));
        self.update_input_method([0, 0]);
        self.accessibility_changed();
        Some(())
    }

    fn show_list(self: &Rc<Self>, target: &Rc<Target>, rows: &[Value], at: Rect) -> JsResult<()> {
        let Some((owner, window)) = self.owner().and_then(|it| Some((it, it.window()?))) else {
            return Ok(());
        };
        let template = array(&[])?;
        for row in rows.iter().take(5000) {
            let (view, target, index) = (Rc::clone(self), Rc::clone(target), row[2].int());
            let choose = procedure(move |_| {
                let (step, target) = (Rc::clone(&view), Rc::clone(&target));
                let step = async move {
                    step.evaluate(&target, &format!("choose({index})")).await;
                    None
                };
                view.enqueue(step, false);
                Ok(())
            })?;
            let label = row[1].text();
            let label = replace(&label[..label.floor_char_boundary(256)], "&", "&&");
            let indentation = if row[5].is_truthy() { "\u{2003}" } else { "" };
            let item = object!({
                "type": if row[0].is("hr") { "separator" } else { "checkbox" },
                "label": format!("{indentation}{label}"),
                "checked": row[3].is_truthy(),
                "enabled": row[0].is("option") && !row[4].is_truthy(),
                "click": choose,
            });
            template.push(global(), item)?;
        }
        let (origin, selected) = (
            owner.holder().origin_in_window(),
            rows.iter().position(|it| it[3].is_truthy()),
        );
        let options = object!({
            "window": window.to_js(),
            "x": origin.x + at.x,
            "y": origin.y + at.y + if IS_MAC { 0. } else { at.height },
            "positioningItem": selected.map_or(-1., |it| it as f64),
        });
        invoke(Menu::from_template(template)?.to_js(), "popup", &[options]).map(drop)
    }

    fn inspect_focus_next(self: &Rc<Self>) {
        self.enqueue(Rc::clone(self).inspect_focus(), false);
    }

    fn update_input_method(&self, selection: [u32; 2]) {
        if self.is_in_password.get() {
            return self.tell_surface(SurfaceCommand::PasswordField);
        }
        let text: Vec<u16> = self.composition.borrow().encode_utf16().collect();
        let field = self.caret.get().map(|caret| InputField {
            composing: (!text.is_empty()).then_some([0, text.len() as u32]).into(),
            text: text.into(),
            selection,
            caret,
            is_out_of_date: bun_ui::queue::are_edits_waiting(),
        });
        self.tell_surface(SurfaceCommand::Field(field.into()));
    }

    /// In order. Of the movements that wait, the last one is enough.
    fn enqueue(self: &Rc<Self>, step: impl Future<Output = Option<()>> + 'static, is_move: bool) {
        self.add_step(Box::pin(async { step.await.unwrap_or(()) }), is_move);
    }

    fn add_step(self: &Rc<Self>, step: LocalFuture<'static, ()>, is_move: bool) {
        if self.last_is_move.replace(is_move) && is_move {
            self.queue.borrow_mut().pop_back();
        }
        self.queue.borrow_mut().push_back(step);
        if !self.is_busy.replace(true) {
            task::spawn(Rc::clone(self).drain());
        }
    }

    pub(super) fn when_idle(self: &Rc<Self>) -> Later<()> {
        let idle = Later::default();
        let reached = idle.clone();
        self.enqueue(
            async move {
                {
                    reached.set(());
                    Some(())
                }
            },
            false,
        );
        idle
    }

    async fn drain(self: Rc<Self>) {
        loop {
            while let Some(drawn) = self.until_drawn.take() {
                drawn.await;
            }
            let Some(step) = self.queue.borrow_mut().pop_front() else {
                break;
            };
            if self.queue.borrow().is_empty() {
                self.last_is_move.set(false);
            }
            within(STEP_MS, Later::of(step)).await;
        }
        self.is_busy.set(false);
    }

    /// The engine drops what the mouse does to a document that it has yet to draw.
    async fn wait_until_drawn(self: Rc<Self>, at: Located) -> Option<()> {
        let drawn = "new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))";
        let root = self.root().await?;
        self.evaluate(&root, drawn).await;
        let target = self.frame_at(at).await?;
        if !Rc::ptr_eq(&target, &root) {
            self.evaluate(&target, drawn).await;
        }
        Some(())
    }

    /// A page that shows a dialog, or that hangs, does not acknowledge its input.
    async fn dispatch(&self, target: &Target, method: &str, params: Value) {
        within(100, self.engine.inspect(method, params, &target.session)).await;
    }

    async fn popup_takes(&self, kind: &str, at: Located, more: Value) -> bool {
        if !self.has_popup.get() {
            return false;
        }
        let [x, y] = [at.x, at.y].map(|it| f64::from(it) * self.zoom.get());
        let event = record! { "type": kind, "x": x, "y": y }.and(&more);
        let reply = self.engine.request(|reply| Order::PopupInput {
            reply,
            view: self.id,
            event,
        });
        reply.await.is_ok_and(|it| it.is_truthy())
    }

    fn leave_hovered(&self) {
        if let Some(hovered) = &*self.hovered.borrow() {
            let away = record! { "type": "mouseMoved", "x": -1, "y": -1 };
            self.engine
                .command("Input.dispatchMouseEvent", away, &hovered.session);
        }
    }

    fn is_dragging(&self) -> bool {
        self.drag.borrow().is_some()
    }

    async fn mouse(
        self: Rc<Self>,
        Mouse {
            at,
            action,
            button,
            buttons,
            clicks,
        }: Mouse,
    ) -> Option<()> {
        let (for_popup, kind) = match action {
            MouseAction::Leave => {
                return {
                    self.leave_hovered();
                    Some(())
                };
            }
            MouseAction::Move => ("mouseMove", "mouseMoved"),
            MouseAction::Down => ("mouseDown", "mousePressed"),
            MouseAction::Up => ("mouseUp", "mouseReleased"),
        };
        if self
            .popup_takes(
                for_popup,
                at,
                record! { "button": button_name(button), "clickCount": clicks },
            )
            .await
        {
            return if action == MouseAction::Up {
                self.inspect_focus().await
            } else {
                None
            };
        }
        let captured = self
            .captured
            .borrow()
            .clone()
            .filter(|_| !self.is_dragging());
        let target = match captured {
            Some(it) => it,
            None => self.target_at(at).await?,
        };
        let local = target.describe(at, self.magnified.get());
        if self.is_dragging() {
            let kind = if action == MouseAction::Up {
                "drop"
            } else {
                "dragOver"
            };
            return {
                self.continue_drag(&target, kind, local).await;
                Some(())
            };
        }
        if !holds(&self.hovered, &target) {
            self.leave_hovered();
        }
        self.hovered.replace(Some(Rc::clone(&target)));
        self.captured
            .replace((buttons != 0).then(|| Rc::clone(&target)));
        let held = [(1, "left"), (2, "right"), (4, "middle")]
            .into_iter()
            .find(|it| buttons & it.0 != 0);
        let (button, clicks) = match action {
            MouseAction::Move => (held.map_or("none", |it| it.1).into(), 0),
            _ => (button_name(button), clicks),
        };
        let params =
            record! { "type": kind, "button": button, "buttons": buttons, "clickCount": clicks };
        if action == MouseAction::Down {
            self.ask_at("watchListsAt", at).await;
        }
        self.dispatch(&target, "Input.dispatchMouseEvent", params.and(&local))
            .await;
        match action {
            MouseAction::Down => self.focus_around(target).await,
            MouseAction::Up => self.take_clipboard(),
            _ if buttons == 0 => return self.hover(at).await,
            _ => return None,
        }
        self.inspect_focus().await
    }

    async fn hover(self: Rc<Self>, at: Located) -> Option<()> {
        if self.engine.kind == Kind::Chromium {
            self.show_cursor(self.ask_at("cursorAt", at).await?.text());
        }
        if self.is_frame {
            let view = Rc::clone(&self);
            let show = async move {
                let timer = view.tooltip.borrow().clone();
                let title = view.ask_at("titleAt", at).await;
                let is_wanted = timer
                    .zip(view.tooltip.borrow().clone())
                    .is_some_and(|it| Rc::ptr_eq(&it.0, &it.1));
                if let (true, Some(title), Some(owner)) =
                    (is_wanted, title.filter(Value::is_truthy), view.owner())
                {
                    task::report(
                        owner.show_tooltip(&title.text()[..title.text().floor_char_boundary(1024)]),
                    );
                }
            };
            self.tooltip
                .replace(Some(Rc::new(Timer::new(500, || task::spawn(show)))));
        }
        Some(())
    }

    async fn wheel(
        self: Rc<Self>,
        mut at: Located,
        [dx, dy]: [f64; 2],
        is_pinch: bool,
    ) -> Option<()> {
        if self
            .popup_takes("mouseWheel", at, record! { "deltaX": -dx, "deltaY": -dy })
            .await
        {
            return None;
        }
        let target = self.target_at(at).await?;
        let delta = if !is_pinch && at.modifiers & SHIFT != 0 && dx == 0. {
            [dy, 0.]
        } else {
            [dx, dy]
        };
        let [dx, dy] = match self.engine.kind {
            Kind::Chromium => delta.map(|it| it / self.zoom.get()),
            Kind::Electron => delta,
        };
        at.modifiers |= if is_pinch { CONTROL } else { 0 };
        let params = record! { "type": "mouseWheel", "deltaX": dx, "deltaY": dy }
            .and(&target.describe(at, self.magnified.get()));
        {
            self.engine
                .command("Input.dispatchMouseEvent", params, &target.session);
            Some(())
        }
    }

    fn start_drag(&self, data: Value) {
        self.drag.replace(Some(data));
        self.captured.take();
        self.hovered.take();
    }

    async fn send_drag(&self, to: &Target, kind: &str, at: &Value) {
        let params = record! { "type": kind, "data": self.drag.borrow().clone() }.and(at);
        self.dispatch(to, "Input.dispatchDragEvent", params).await;
    }

    async fn continue_drag(&self, target: &Rc<Target>, kind: &str, local: Value) {
        if !holds(&self.hovered, target) {
            if let Some(left) = self.hovered.replace(Some(Rc::clone(target))) {
                self.send_drag(&left, "dragOver", &record! { "x": -1, "y": -1 })
                    .await;
            }
            self.send_drag(target, "dragEnter", &local).await;
        }
        self.send_drag(target, kind, &local).await;
        if kind != "dragOver" {
            self.drag.take();
            let released = record! { "type": "mouseReleased", "button": "left" }.and(&local);
            self.dispatch(target, "Input.dispatchMouseEvent", released)
                .await;
        }
    }

    async fn drag_files(self: Rc<Self>, phase: DragPhase, at: Located, files: Value) -> Option<()> {
        let hovered = self.hovered.borrow().clone();
        let target = if phase == DragPhase::Leave {
            hovered
        } else {
            self.target_at(at).await
        }?;
        if !self.is_dragging() {
            self.start_drag(record! { "items": list![], "files": files, "dragOperationsMask": 1 });
        }
        let kind = match phase {
            DragPhase::Drop => "drop",
            DragPhase::Leave => "dragCancel",
            _ => "dragOver",
        };
        {
            let local = target.describe(at, self.magnified.get());
            self.continue_drag(&target, kind, local).await;
            Some(())
        }
    }

    /// What has to be decided before the system goes on with the key. Returns what it does unless the page handles it.
    fn key_down(&self, it: &Key) -> JsResult<Option<Root<MenuItem>>> {
        let (key, modifiers) = (&*it.key, it.modifiers);
        if it.is_composing || matches!(key, "Process" | "Dead") {
            return Ok(None);
        }
        let edits = !IS_MAC
            && modifiers & (CONTROL | ALT | META) == CONTROL
            && matches!(
                key.to_ascii_lowercase().as_str(),
                "a" | "c" | "v" | "x" | "y" | "z"
            );
        let shortcut = self
            .owner()
            .filter(|_| !edits)
            .map(|owner| owner.shortcut(it))
            .transpose()?
            .flatten();
        let is_crashed = || (self.owner()).is_some_and(|it| it.mirrored("isCrashed").is_truthy());
        if let Some(reserved) = shortcut.filter(|it| it.is_reserved() || is_crashed()) {
            return self.run_shortcut(reserved, modifiers).map(|()| None);
        }
        let is_command = match key.encode_utf16().nth(2) {
            Some(_) => (IS_MAC || modifiers & ALT == 0) && keys::function_key(key).is_none(),
            None => IS_MAC && modifiers & (CONTROL | ALT | META) == CONTROL,
        };
        if shortcut.is_some() || is_command {
            tell(Command::KeyWasHandled)?;
        }
        Ok(shortcut.map(Root::new))
    }

    fn run_shortcut(&self, item: &MenuItem, modifiers: u8) -> JsResult<()> {
        item.activate(self.owner().and_then(Remote::window), Some(modifiers))
    }

    /// Until the browser has learned which frame a click has focused, it gives keys to the wrong one.
    async fn key_target(&self) -> Option<Rc<Target>> {
        let focused = self
            .with_focus
            .borrow()
            .clone()
            .filter(|_| self.engine.kind == Kind::Electron);
        if focused.is_some() {
            focused
        } else {
            self.root().await
        }
    }

    async fn key(self: Rc<Self>, it: Key, shortcut: Option<Root<MenuItem>>) -> Option<()> {
        let target = self.key_target().await?;
        let (key, is_with_command) = (&*it.key, it.modifiers & (CONTROL | META) != 0);
        if !it.is_down {
            if is_with_command {
                self.take_clipboard();
            }
            self.dispatch(
                &target,
                "Input.dispatchKeyEvent",
                keys::describe("keyUp", &it),
            )
            .await;
            return self.inspect_focus().await;
        }
        if (is_with_command && key.eq_ignore_ascii_case("v"))
            || (it.modifiers & SHIFT != 0 && key == "Insert")
        {
            self.give_clipboard().await;
        }
        if self.is_dragging() {
            if key == "Escape" {
                let hovered = self.hovered.borrow().clone().unwrap_or(target);
                self.continue_drag(&hovered, "dragCancel", record! { "x": 0, "y": 0 })
                    .await;
            }
            return None;
        }
        let watched = if shortcut.is_some() {
            Some(self.focused().await?.0)
        } else {
            None
        };
        if let Some(watched) = &watched {
            self.evaluate(watched, "watchKey()").await;
        }
        let commands = IS_MAC
            .then_some(&it)
            .and_then(keys::editing_command)
            .map(|it| list![it]);
        let down = keys::describe("rawKeyDown", &it).with("commands", commands);
        let is_in_field = self.caret.get().is_some() || self.is_in_password.get();
        if is_in_field && watched.is_none() && key != "Enter" {
            // What it types is not to wait for the next frame.
            (self.engine).command("Input.dispatchKeyEvent", down, &target.session);
            return None;
        }
        if !is_in_field {
            self.focused().await;
        }
        self.dispatch(&target, "Input.dispatchKeyEvent", down).await;
        if !is_in_field {
            self.inspect_focus_next();
        }
        if key == "Enter" {
            self.dispatch(
                &target,
                "Input.dispatchKeyEvent",
                keys::describe("char", &it).with("text", "\r"),
            )
            .await;
        }
        if !matches!(
            self.evaluate(&watched?, "key?.defaultPrevented").await,
            Value::Bool(true)
        ) {
            task::report(self.run_shortcut(shortcut?.get(), it.modifiers));
        }
        Some(())
    }

    pub(super) fn edit(self: &Rc<Self>, command: String) {
        let view = Rc::clone(self);
        let step = async move {
            if command.starts_with("paste") {
                view.give_clipboard().await;
            }
            view.tell_page(&command, list![]);
            matches!(&*command, "copy" | "cut").then(|| view.take_clipboard())
        };
        self.enqueue(step, false);
    }

    async fn give_clipboard(&self) {
        if self.engine.has_own_clipboard
            && let Ok(Ok(contents)) = catch(bun_ui::clipboard::read(global(), ClipboardPart::Text))
        {
            let text = contents.text.get().unwrap_or_default().into_string();
            let written =
                self.engine
                    .perform(Remotely::Module("clipboard"), "writeText", list![&*text]);
            self.engine.copied.replace(text);
            let _ = written.await;
        }
    }

    /// What a page copies because of the input it got.
    fn take_clipboard(&self) {
        if !self.engine.has_own_clipboard {
            return;
        }
        let engine = Rc::clone(&self.engine);
        task::spawn(async move {
            task::sleep(100).await;
            let text = engine
                .perform(Remotely::Module("clipboard"), "readText", list![])
                .await
                .unwrap_or_default();
            if text.is_truthy() && !text.is(&engine.copied.replace(text.text().to_owned())) {
                let contents = Clipboard {
                    text: Some(text.text().into()).into(),
                    ..Default::default()
                };
                task::report(bun_ui::clipboard::write(global(), contents, false));
            }
        });
    }

    /// The input method replaces what has just been typed.
    async fn select_replaced(self: &Rc<Self>, range: Maybe<[u32; 2]>) -> Option<()> {
        if let Some([start, end]) = range.get() {
            self.evaluate(
                &self.focused().await?.0,
                &format!("selectBack({})", end.saturating_sub(start)),
            )
            .await;
        }
        Some(())
    }

    async fn text(
        self: Rc<Self>,
        text: Text,
        range: Maybe<[u32; 2]>,
        typed_with: Option<Key>,
    ) -> Option<()> {
        let target = self.key_target().await?;
        self.select_replaced(range).await?;
        let was_composing = !self.composition.take().is_empty();
        if let Some(key) = typed_with.filter(|_| !was_composing) {
            let typed = keys::describe("char", &key).with("text", &*text);
            return {
                self.dispatch(&target, "Input.dispatchKeyEvent", typed)
                    .await;
                Some(())
            };
        }
        self.dispatch(&target, "Input.insertText", record! { "text": &*text })
            .await;
        self.inspect_focus().await
    }

    async fn compose(
        self: Rc<Self>,
        text: Text,
        selection: [u32; 2],
        range: Maybe<[u32; 2]>,
    ) -> Option<()> {
        self.select_replaced(range).await?;
        if self.composition.replace(text.to_string()).is_empty() && text.is_empty() {
            return None;
        }
        self.update_input_method(selection);
        let params = record! { "text": &*text, "selectionStart": selection[0], "selectionEnd": selection[1] };
        {
            self.dispatch(
                &*self.key_target().await?,
                "Input.imeSetComposition",
                params,
            )
            .await;
            Some(())
        }
    }

    /// With CSS pixels of the page.
    pub(super) fn input(self: &Rc<Self>, input: Input) -> JsResult<()> {
        if self.tooltip.take().is_some()
            && let Some(owner) = self.owner()
        {
            owner.show_tooltip("")?;
        }
        let view = Rc::clone(self);
        match input {
            Input::Mouse(mouse) => {
                let is_over = mouse.action != MouseAction::Leave;
                if self.has_mouse.replace(is_over) != is_over {
                    self.set_cursor(self.cursor.get());
                }
                if is_over && !self.is_drawn.replace(true) {
                    let drawn = Rc::clone(self).wait_until_drawn(mouse.at);
                    self.until_drawn.replace(Some(Later::of(async {
                        let _ = within(DRAW_MS, drawn).await;
                    })));
                }
                self.enqueue(view.mouse(mouse), mouse.action == MouseAction::Move);
            }
            Input::Wheel(wheel) => self.enqueue(view.wheel(wheel.at, wheel.delta, false), false),
            Input::Pinch { at, delta } => {
                self.enqueue(view.wheel(at, [0., -100. * f64::from(delta)], true), false)
            }
            Input::Drag { phase, at, paths } => {
                let files = paths.iter().map(|it| &**it).collect();
                self.enqueue(view.drag_files(phase, at, files), phase == DragPhase::Over);
            }
            Input::Key(key) => {
                self.pressed.replace(Some(key.clone()));
                let shortcut = if key.is_down {
                    self.key_down(&key)?
                } else {
                    None
                };
                self.enqueue(view.key(key, shortcut), false);
            }
            Input::Text {
                text,
                is_typed,
                range,
            } => {
                let typed_with = self.pressed.borrow().clone().filter(|_| is_typed);
                self.enqueue(view.text(text, range, typed_with), false);
            }
            Input::Compose {
                text,
                selection,
                range,
            } => self.enqueue(view.compose(text, selection, range), false),
            Input::EndComposition => {
                self.enqueue(view.compose(Text::default(), [0, 0], None.into()), false)
            }
            Input::Focus => {
                self.tell_window("focusOnWebView", list![]);
                self.enqueue(view.set_active(true), false);
            }
            Input::Blur => {
                self.caret.set(None);
                self.is_in_password.set(false);
                self.update_input_method([0, 0]);
                self.tell_window("blurWebView", list![]);
                self.enqueue(view.set_active(false), false);
            }
            Input::Perform {
                node,
                action,
                numbers,
                text,
                takes_focus,
            } => {
                let step = async move {
                    if takes_focus {
                        task::report(view.owner()?.take_focus());
                    }
                    if let Some(key) = view.tree.perform(&view, node, action, numbers, &text).await
                    {
                        task::report(view.press(key, 0).and_then(|key| {
                            view.input(Input::Key(Key {
                                is_down: false,
                                ..key
                            }))
                        }));
                    }
                    view.inspect_focus().await
                };
                self.enqueue(step, false);
            }
            _ => {}
        }
        Ok(())
    }

    /// For a key whose code is its name.
    pub(super) fn press(self: &Rc<Self>, name: &str, modifiers: u8) -> JsResult<Key> {
        let key = Key {
            key: name.into(),
            code: name.into(),
            location: 0,
            modifiers,
            is_down: true,
            is_repeat: false,
            is_composing: false,
        };
        self.input(Input::Key(key.clone())).map(|()| key)
    }

    /// Its window is never the key window.
    async fn set_active(self: Rc<Self>, is_active: bool) -> Option<()> {
        let enabled = record! { "enabled": is_active };
        self.ask(
            &*self.root().await?,
            "Emulation.setFocusEmulationEnabled",
            enabled,
        )
        .await;
        if is_active {
            self.inspect_focus().await
        } else {
            None
        }
    }

    pub(super) fn accessibility_changed(self: &Rc<Self>) {
        self.update_tree_after((50 + self.tree_cost.get() * 4).min(1000));
    }

    fn update_tree_after(self: &Rc<Self>, delay: u64) {
        self.is_tree_stale.set(true);
        if !surfaces::is_accessibility_active()
            || self.is_destroyed.get()
            || self.updates_tree.replace(true)
        {
            return;
        }
        let view = Rc::clone(self);
        task::spawn(async move {
            task::sleep(delay).await;
            let start = std::time::Instant::now();
            view.is_tree_stale.set(false);
            if let Some(root) = view.root().await.filter(|_| !view.is_destroyed.get()) {
                view.tree.update(&view, root, view.is_frame).await;
            }
            view.tree_cost.set(start.elapsed().as_millis() as u64);
            view.updates_tree.set(false);
            if view.is_tree_stale.get() {
                view.accessibility_changed();
            }
        });
    }

    /// The tree has changed once the promise that `expression` evaluates to is settled.
    pub(super) async fn watch(self: &Rc<Self>, target: &Rc<Target>, expression: &str) {
        if target.is_watched.get() {
            return;
        }
        let Some(world) = self.world(target).await else {
            return drop(target.world.take());
        };
        target.is_watched.set(true);
        let params = record! { "expression": expression, "contextId": world, "awaitPromise": true, "silent": true };
        let (view, watched) = (Rc::clone(self), Rc::clone(target));
        let changed = move |reply: super::engine::Reply| {
            watched.is_watched.set(false);
            if reply.is_err() {
                watched.world.take();
            }
            view.accessibility_changed();
        };
        self.engine.inspect_in_order(
            "Runtime.evaluate",
            params,
            &target.session,
            Box::new(changed),
        );
    }

    pub(super) fn size(&self) -> [f64; 2] {
        self.size.get()
    }

    pub(super) fn resize(&self, size: [f64; 2]) {
        let size = size.map(|it| it.ceil().max(1.));
        if self.size.replace(size) != size {
            self.tell_window("setContentSize", size.into_iter().collect());
        }
    }

    pub(super) fn set_visible(self: &Rc<Self>, is_visible: bool) {
        if self.is_visible.replace(is_visible) == is_visible {
            return;
        }
        self.tell_page(
            if is_visible {
                "startPainting"
            } else {
                "stopPainting"
            },
            list![],
        );
        if is_visible {
            self.tell_page("invalidate", list![]);
        }
        self.wake();
    }

    /// The engine takes every view for visible, so a hidden one is slowed down while nothing is asked of it.
    pub(super) fn wake(self: &Rc<Self>) {
        if self.is_resting.take() {
            self.tell_page("setFrameRate", list![self.frame_rate.get()]);
        }
        let view = Rc::clone(self);
        let rest = move || {
            view.is_resting.set(true);
            view.tell_page("setFrameRate", list![1]);
        };
        let may_rest = !self.is_visible.get() && self.may_rest.get() && !self.is_destroyed.get();
        self.rest.set(may_rest.then(|| Timer::new(1000, rest)));
    }

    pub(super) fn paint(self: &Rc<Self>, pixels: FramePixels) -> JsResult<()> {
        let painted = match &pixels {
            FramePixels::Raw { size, area, .. } => Painted {
                size: size.map(f64::from),
                area: Some(area.map(f64::from)),
            },
            FramePixels::Encoded(_) => Painted {
                size: self.size.get(),
                area: None,
            },
        };
        show_pixels(self.image, self.shown_at.get(), pixels)?;
        self.accessibility_changed();
        let Some(owner) = self.owner() else {
            return Ok(());
        };
        owner.painted(&painted)?;
        if !self.awaits_regions.get() && owner.may_drag_window()? {
            self.awaits_regions.set(true);
            task::spawn(Rc::clone(self).update_regions());
        }
        Ok(())
    }

    async fn update_regions(self: Rc<Self>) {
        task::sleep(500).await;
        let Some(root) = self.root().await else {
            return;
        };
        let found = self.evaluate(&root, "regions()").await;
        self.awaits_regions.set(false);
        let region = |it: &Value| {
            let [x, y, width, height] =
                [0, 1, 2, 3].map(|at| finite(it[at].number() * self.zoom.get()));
            Region {
                rect: Rect {
                    x,
                    y,
                    width,
                    height,
                },
                drag: it[4].is_truthy(),
            }
        };
        if !self.is_destroyed.get() {
            self.tell_surface(SurfaceCommand::Regions {
                view: self.image,
                regions: found.items().iter().map(region).collect(),
            });
        }
    }

    fn set_cursor(&self, cursor: Cursor) {
        self.cursor.set(cursor);
        if self.has_mouse.get() {
            self.tell_surface(SurfaceCommand::Cursor(cursor));
        }
    }

    /// By a value of the CSS property.
    pub(super) fn show_cursor(&self, name: &str) {
        self.set_cursor(Cursor::named(name.as_bytes()));
    }

    pub(super) fn destroy(self: &Rc<Self>) -> JsResult<()> {
        self.is_destroyed.set(true);
        drop((
            self.tooltip.take(),
            self.rest.take(),
            self.popup_watch.take(),
            self.queue.take(),
        ));
        self.target_id.set(None);
        let view = Rc::clone(self);
        task::spawn(async move { view.root().await.map_or((), |it| view.forget(&it)) });
        self.engine.remove_view(self.id);
        self.engine.send(Order::Destroy(self.id));
        surfaces::ignore(TREE_OF_IMAGE | self.image);
        self.hold.take();
        tell(Command::WebView {
            id: self.image,
            command: WebViewCommand::Close,
        })
    }
}

fn file_of(engine: &Engine, view: i32) -> Option<String> {
    engine
        .paints_to_files
        .then(|| files::join(&[&engine.directory, &format!("frame{view}")]))
}

/// They have to be taken out of the channel even if there is no such image any more.
pub(super) fn show_pixels(image: u32, scale: f64, pixels: FramePixels) -> JsResult<()> {
    tell(Command::WebView {
        id: image,
        command: WebViewCommand::Frame {
            scale: finite(scale),
            pixels,
        },
    })
}
