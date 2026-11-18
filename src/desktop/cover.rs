//! The picture of a window from the last run, which is on the screen until the app has painted.

use core::cell::OnceCell;
use std::collections::VecDeque;

use bun_ui::protocol::{
    ALT, ALT_GRAPH, CAPS_LOCK, Cover, Input, Key, Located, Mouse, MouseAction, Reply, Request,
    SHIFT, SurfacePoint, Uncovered, WindowEvent, WindowOptions,
};
use bun_ui::{queue, surfaces};

use crate::prelude::*;
use crate::{files, paths, process, text, theme, window};

const WINDOW: u32 = 1;
const PATIENCE: f64 = 10_000.;
const TYPING: u8 = SHIFT | ALT_GRAPH | CAPS_LOCK | if IS_MAC { ALT } else { 0 };

#[derive(Default)]
struct State {
    /// The app may move `userData` later on.
    directory: OnceCell<String>,
    is_shown: Cell<bool>,
    is_reserved: Cell<bool>,
    has_window: Cell<bool>,
    is_owner: Cell<bool>,
    is_adopted: Cell<bool>,
    generation: Cell<u32>,
    timer: Cell<Option<later::Timer>>,
    missed: RefCell<Vec<WindowEvent>>,
    inputs: RefCell<Vec<Input>>,
    is_composing: Cell<bool>,
    is_pressed: Cell<bool>,
    wants_end: Cell<Option<Vec<Rect>>>,
    /// Only parts are pictured.
    is_partial: Cell<bool>,
    /// What was typed is in the field, which has yet to be rendered.
    is_handing_over: Cell<bool>,
    types_into: Cell<u32>,
    received: Cell<u32>,
    waits_for_input: Cell<Option<Deferred>>,
    early_keys: RefCell<Vec<Input>>,
    to_save: RefCell<VecDeque<(Cover, u32, Deferred)>>,
    is_saving: Cell<bool>,
}

state!(fn state() -> State);

fn directory() -> JsResult<&'static str> {
    if let Some(known) = state().directory.get() {
        return Ok(known);
    }
    let directory = paths::path("userData")?;
    Ok(state().directory.get_or_init(|| directory))
}

fn description() -> JsResult<String> {
    Ok(files::join(&[directory()?, "LaunchCover.json"]))
}

fn owner() -> JsResult<String> {
    Ok(files::join(&[directory()?, "LaunchCover.owner"]))
}

fn picture() -> JsResult<String> {
    Ok(files::join(&[&paths::path("userData")?, "LaunchCover"]))
}

fn is_possible() -> JsResult<bool> {
    Ok(paths::resources().is_some()
        && process::variable("BUN_DESKTOP_LAUNCH_COVER")?.as_deref() != Some("0"))
}

/// Returns whether the others can tell.
fn own(stage: &str) -> JsResult<bool> {
    if files::write(
        &owner()?,
        format!("{} {stage}", process::id()).as_bytes(),
        0o600,
    )
    .is_err()
    {
        return Ok(false);
    }
    state().is_owner.set(true);
    process::at_exit(|| owner().iter().for_each(|it| files::remove(it)));
    Ok(true)
}

pub(crate) fn begin() -> JsResult<()> {
    let description = description()?;
    if state().is_owner.get() || !is_possible()? || !files::exists(&description) {
        return Ok(());
    }
    let last = files::read_text(&owner()?).unwrap_or_default();
    let (id, stage) = text::split_once(&last, " ").unwrap_or_default();
    if id
        .parse()
        .is_ok_and(|id| id != process::id() && process::is_running(id))
    {
        return Ok(());
    }
    if stage == "launching" {
        files::remove(&owner()?);
        return clear();
    }
    if !own("launching")? {
        return Ok(());
    }
    let surface = surfaces::next_id();
    surfaces::listen(surface, hold);
    bun_ui::start_with(
        global(),
        Command::ShowCover {
            description: description.into(),
            window: WINDOW,
            surface,
        },
    )?;
    state().is_shown.set(true);
    state().is_reserved.set(true);
    state().has_window.set(true);
    wait(6);
    Ok(())
}

fn wait(times: u8) {
    state().timer.set(Some(later::after(PATIENCE, move |_| {
        if times > 1 && has_typed() {
            wait(times - 1);
            return Ok(());
        }
        end(false, Vec::new())
    })));
}

fn is_typed(input: &Input) -> bool {
    !matches!(input, Input::Mouse(_))
}

fn has_typed() -> bool {
    state().inputs.borrow().iter().any(is_typed)
}

fn hold(input: Input) -> JsResult<()> {
    let state = state();
    match &input {
        Input::Text { .. } | Input::Key(Key { is_down: true, .. }) => {
            state.received.update(|it| it + 1)
        }
        Input::Key(_) => {}
        Input::Outside | Input::Wheel(_) if state.is_partial.get() => return end(true, Vec::new()),
        Input::Compose { .. } => state.is_composing.set(true),
        Input::EndComposition => state.is_composing.set(false),
        Input::Mouse(Mouse {
            action: MouseAction::Down | MouseAction::Up,
            buttons,
            ..
        }) => {
            state.is_pressed.set(*buttons != 0);
            if !state.is_shown.get() {
                return Ok(());
            }
        }
        _ => return Ok(()),
    }
    let is_open = !state.is_shown.get()
        || state.is_partial.get()
        || (state.is_handing_over.get() && state.inputs.borrow().is_empty());
    if is_typed(&input) && is_open {
        return type_into(state.types_into.get(), [input]);
    }
    state.inputs.borrow_mut().push(input);
    if let Some(waiting) = state.waits_for_input.take() {
        match has_input()? {
            true => waiting.resolve(JSValue::UNDEFINED)?,
            false => state.waits_for_input.set(Some(waiting)),
        }
    }
    state
        .wants_end
        .take()
        .map_or(Ok(()), |keep| end(true, keep))
}

pub(crate) fn when_input() -> JsResult<JSValue> {
    if !state().is_shown.get() || has_input()? {
        return resolved(JSValue::UNDEFINED);
    }
    let waiting = state().waits_for_input.take().unwrap_or_default();
    let promise = waiting.promise();
    state().waits_for_input.set(Some(waiting));
    Ok(promise)
}

fn edits(key: &Key) -> bool {
    let name = &*key.key;
    key.modifiers & !TYPING == 0
        && (name.chars().count() == 1
            || name.starts_with("Arrow")
            || matches!(
                name,
                "Backspace" | "Delete" | "Enter" | "Shift" | "Dead" | "Process" | "Home" | "End"
            ))
}

fn type_into(surface: u32, inputs: impl IntoIterator<Item = Input>) -> JsResult<()> {
    inputs.into_iter().try_for_each(|input| {
        match &input {
            Input::Key(key) if !edits(key) => return Ok(()),
            Input::Mouse(_) => return Ok(()),
            _ => {}
        }
        surfaces::send(surface, input)
    })
}

fn if_it_accepts_text(surface: Option<u32>) -> JsResult<Option<u32>> {
    match surface.filter(|it| *it != 0) {
        Some(it) if answer((bun_ui::renderer(global())?.surface_accepts_text)(it))? => Ok(Some(it)),
        _ => Ok(None),
    }
}

fn focused_field() -> JsResult<Option<u32>> {
    if_it_accepts_text(answer((ui()?.focused_under_cover)())?.get())
}

fn forget() -> JsResult<()> {
    let state = state();
    state.is_shown.set(false);
    state.is_partial.set(false);
    state.inputs.take();
    state.timer.take();
    state
        .waits_for_input
        .take()
        .map(|it| it.resolve(JSValue::UNDEFINED))
        .transpose()?;
    own("running").map(drop)
}

fn last_click(inputs: &[Input]) -> Option<(usize, Mouse)> {
    let mut clicks = inputs
        .iter()
        .enumerate()
        .filter_map(|(index, it)| match it {
            Input::Mouse(
                it @ Mouse {
                    action: MouseAction::Down,
                    clicks: 0 | 1,
                    ..
                },
            ) => Some((index, *it)),
            _ => None,
        });
    clicks.next_back().filter(|it| it.1.button == 0)
}

fn fits(click: Mouse) -> JsResult<bool> {
    answer((ui()?.cover_fits)(Point {
        x: click.at.x,
        y: click.at.y,
    }))
}

pub(crate) fn has_input() -> JsResult<bool> {
    let click = last_click(&state().inputs.borrow());
    click.map_or_else(|| Ok(has_typed()), |it| fits(it.1))
}

/// Text is only typed into a field, and only the last click is made, if it hits what the user saw.
pub(crate) fn end(replays: bool, keep: Vec<Rect>) -> JsResult<()> {
    let state = state();
    if !state.is_shown.get() {
        return Ok(());
    }
    if !state.is_adopted.get() {
        return discard();
    }
    if replays
        && (state.is_composing.get() || state.is_pressed.get() || state.is_handing_over.get())
    {
        state.wants_end.set(Some(keep));
        return Ok(());
    }
    state.wants_end.take();
    if !replays || last_click(&state.inputs.borrow()).is_some() {
        return finish(replays, keep);
    }
    if !state.is_partial.get() {
        let mut field = focused_field()?;
        if field.is_none() && has_typed() {
            // An editor may ask for another frame to take the focus in.
            render_pages();
            field = focused_field()?;
        }
        state.types_into.set(field.unwrap_or(0));
    }
    if state.types_into.get() == 0 {
        return finish(true, keep);
    }
    if !has_typed() {
        // The picture shows what is still on its way.
        if !state.is_partial.get() && answer((ui()?.sent_to_cover)())? != state.received.get() {
            state.wants_end.set(Some(keep));
            return Ok(());
        }
        return finish(true, keep);
    }
    state.is_handing_over.set(true);
    post(Priority::Blocking, move || {
        render_pages();
        state.is_handing_over.set(false);
        end(true, state.wants_end.take().unwrap_or(keep))
    });
    type_into(state.types_into.get(), state.inputs.take())
}

fn finish(replays: bool, mut keep: Vec<Rect>) -> JsResult<()> {
    let state = state();
    let click = last_click(&state.inputs.borrow()).filter(|_| replays);
    if let (Some((_, click)), false) = (click, keep.is_empty()) {
        if !fits(click)? {
            return Ok(());
        }
        keep.clear();
    }
    let mut held = state.inputs.take();
    if let (false, Some(window)) = (state.is_partial.get(), window::with_id(WINDOW)) {
        window.uncovered()?;
    }
    let (is_over, at) = (
        keep.is_empty(),
        click.map(|(_, it)| Point {
            x: it.at.x,
            y: it.at.y,
        }),
    );
    let Uncovered { clicked, focused } = answer((ui()?.end_cover)(at.into(), keep.into()))?;
    if is_over {
        forget()?;
    } else if !state.is_partial.replace(true) {
        own("running")?;
    }
    if !replays {
        return Ok(());
    }
    let rest = held.split_off(click.map_or(held.len(), |it| it.0));
    if let Some(field) = if_it_accepts_text(focused.get())? {
        state.types_into.set(field);
        type_into(field, held)?;
    }
    let Some((_, click)) = click else {
        return Ok(());
    };
    state.types_into.set(0);
    let Some(SurfacePoint { surface, at }) = clicked.get() else {
        return Ok(());
    };
    let there = |it: Mouse| {
        Input::Mouse(Mouse {
            at: Located {
                x: at.x,
                y: at.y,
                ..it.at
            },
            ..it
        })
    };
    surfaces::send(
        surface,
        there(Mouse {
            action: MouseAction::Move,
            buttons: 0,
            clicks: 0,
            ..click
        }),
    )?;
    for input in &rest {
        if let Input::Mouse(it) = input {
            surfaces::send(surface, there(*it))?;
        }
    }
    type_when_focused(surface, rest, 20)
}

fn type_when_focused(surface: u32, inputs: Vec<Input>, tries: u8) -> JsResult<()> {
    if if_it_accepts_text(Some(surface))?.is_some() {
        return type_into(surface, inputs);
    }
    if tries > 1 && inputs.iter().any(is_typed) {
        later::after(16., move |_| type_when_focused(surface, inputs, tries - 1)).detach();
    }
    Ok(())
}

fn drop_keys() -> Vec<Input> {
    surfaces::filter(None);
    state().timer.take();
    state().early_keys.take()
}

fn drop_keys_after(milliseconds: f64) {
    state().timer.set(Some(later::after(milliseconds, |_| {
        drop_keys();
        Ok(())
    })));
}

/// Without a picture, what is typed waits for the field all the same.
pub(crate) fn hold_keys() -> JsResult<()> {
    if is_possible()? {
        drop_keys_after(PATIENCE);
        surfaces::filter(Some(hold_key));
    }
    Ok(())
}

fn hold_key(surface: u32, input: &Input) -> JsResult<bool> {
    let moves_focus = match input {
        Input::Mouse(it) => Some(it.action == MouseAction::Down),
        Input::Key(it) if &*it.key == "Tab" => Some(it.is_down),
        _ => None,
    };
    if let Some(is_down) = moves_focus {
        if is_down {
            drop_keys();
        }
        return Ok(false);
    }
    if if_it_accepts_text(Some(surface))?.is_some() {
        type_into(surface, drop_keys())?;
        return Ok(false);
    }
    if matches!(input, Input::Key(it) if &*it.key == "Enter" || !edits(it)) {
        return Ok(false);
    }
    if state().early_keys.borrow().is_empty() {
        later::after(16., |_| type_early_keys()).detach();
    }
    state().early_keys.borrow_mut().push(input.clone());
    // The page may listen for keys.
    Ok(matches!(input, Input::Text { .. }))
}

fn type_early_keys() -> JsResult<()> {
    if state().early_keys.borrow().is_empty() {
        return Ok(());
    }
    for surface in surfaces::ids() {
        if if_it_accepts_text(Some(surface))?.is_some() {
            return type_into(surface, drop_keys());
        }
    }
    later::after(16., |_| type_early_keys()).detach();
    Ok(())
}

pub(crate) fn release_keys(replays: bool) {
    if !surfaces::is_filtered() {
        return;
    }
    if replays && !state().early_keys.borrow().is_empty() {
        return drop_keys_after(500.);
    }
    drop_keys();
}

pub(crate) fn discard() -> JsResult<()> {
    if !state().is_shown.get() || state().is_adopted.get() {
        return Ok(());
    }
    tell(Command::DiscardCover)?;
    forget()
}

pub(crate) fn first_free_id() -> u32 {
    WINDOW + u32::from(state().has_window.get())
}

/// The id of the window that has the option `launchCover`.
pub(crate) fn take_id() -> Option<u32> {
    state().is_reserved.take().then_some(WINDOW)
}

/// Returns the events that the window has missed, if it exists already.
pub(crate) fn adopt(options: WindowOptions) -> JsResult<Option<Vec<WindowEvent>>> {
    if !state().is_shown.get() {
        return Ok(None);
    }
    if !answer((ui()?.adopt_cover)(options))? {
        return forget().map(|()| None);
    }
    state().is_adopted.set(true);
    Ok(Some(state().missed.take()))
}

pub(crate) fn missed(window: u32, event: WindowEvent) {
    if state().is_shown.get() && window == WINDOW {
        state().missed.borrow_mut().push(event);
    }
}

pub(crate) fn is_shown_in(window: u32) -> bool {
    state().is_shown.get() && state().is_adopted.get() && window == WINDOW
}

pub(crate) fn is_saved() -> JsResult<bool> {
    Ok(files::exists(&description()?))
}

/// The paths and the theme are filled in.
pub(crate) fn save(cover: Cover) -> JsResult<JSValue> {
    let result = Deferred::new();
    let promise = result.promise();
    state()
        .to_save
        .borrow_mut()
        .push_back((cover, state().generation.get(), result));
    if !state().is_saving.replace(true) {
        queue_microtask(save_next)?;
    }
    Ok(promise)
}

fn save_next() -> JsResult<()> {
    let state = state();
    let Some((cover, generation, result)) = state.to_save.borrow_mut().pop_front() else {
        state.is_saving.set(false);
        return Ok(());
    };
    if state.is_shown.get() || generation != state.generation.get() || !is_possible()? {
        result.resolve(false)?;
        return save_next();
    }
    if bun_ui::surfaces::has_screen_reader() {
        clear()?;
        result.resolve(false)?;
        return save_next();
    }
    let _ = files::make_directory(directory()?, 0o700);
    if !state.is_owner.get() {
        own("running")?;
    }
    let cover = Cover {
        description: description()?.into(),
        picture: picture()?.into(),
        theme: theme::source(),
        ..cover
    };
    queue::request(global(), Request::SaveCover(cover), move |_, reply| {
        let is_saved = generation == state.generation.get() && !matches!(reply, Reply::Failed(_));
        if !is_saved {
            clear()?;
        }
        result.resolve(is_saved)?;
        save_next()
    })
}

pub(crate) fn clear() -> JsResult<()> {
    state().generation.update(|it| it + 1);
    let picture = picture()?;
    [description()?, format!("{picture}.font"), picture]
        .iter()
        .for_each(|it| files::remove(it));
    Ok(())
}
