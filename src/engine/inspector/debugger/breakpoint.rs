use core::cell::Cell;
use std::rc::Rc;

use bun_engine_text::StringRef;
use bun_engine_vm::Message;

use super::Location;
use crate::protocol::{Json, Object, Outcome};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ActionKind {
    Log,
    Evaluate,
    Sound,
    Probe,
}

pub(super) struct Action {
    pub(super) kind: ActionKind,
    pub(super) data: StringRef,
    /// The frontend picks it.
    pub(super) id: i32,
}

impl Action {
    fn parse(json: &Json) -> Outcome<Action> {
        let json = (json.as_object()).ok_or("Unexpected non-object item in given actions")?;
        let kind = (json.string("type")).ok_or("Missing type for item in given actions")?;
        let known = [
            ("log", ActionKind::Log),
            ("evaluate", ActionKind::Evaluate),
            ("sound", ActionKind::Sound),
            ("probe", ActionKind::Probe),
        ];
        let Some(&(_, kind)) = known.iter().find(|it| kind.text().eq_ascii(it.0)) else {
            return Err(format_args!("Unknown breakpoint action type: {kind}").into());
        };
        Ok(Action {
            kind,
            data: json.string("data").cloned().unwrap_or_default(),
            id: json.integer("id").unwrap_or(0),
        })
    }

    /// Of the objects that it has reported.
    pub(super) fn object_group(&self) -> StringRef {
        format_args!("breakpoint-action-{}", self.id).into_string()
    }
}

/// `Debugger.BreakpointOptions`
#[derive(Default)]
pub(crate) struct Options {
    pub(super) condition: StringRef,
    pub(super) actions: Vec<Action>,
    pub(super) continues: bool,
    ignore_count: u64,
}

impl Options {
    pub(crate) fn parse(json: Option<&Object>) -> Outcome<Rc<Options>> {
        let Some(json) = json else {
            return Ok(Rc::default());
        };
        let actions = json.get("actions").and_then(Json::as_array);
        let actions = actions.unwrap_or_default().iter().map(Action::parse);
        Ok(Rc::new(Options {
            condition: json.string("condition").cloned().unwrap_or_default(),
            actions: actions.collect::<Outcome<_>>()?,
            continues: json.boolean("autoContinue").unwrap_or(false),
            ignore_count: json.integer("ignoreCount").unwrap_or(0) as u64,
        }))
    }
}

/// At a location, or else for a kind of event.
pub(crate) struct Breakpoint {
    pub(super) location: Option<Location>,
    /// `Debugger.BreakpointId`, which several can share. `None` if the frontend does not know of it.
    pub(super) id: Option<StringRef>,
    pub(super) options: Rc<Options>,
    hit_count: Cell<u64>,
}

impl Breakpoint {
    pub(super) fn at(
        location: Location,
        id: Option<StringRef>,
        options: Rc<Options>,
    ) -> Rc<Breakpoint> {
        Rc::new(Breakpoint {
            location: Some(location),
            id,
            options,
            hit_count: Cell::new(0),
        })
    }

    pub(crate) fn for_event(options: Option<&Object>) -> Outcome<Rc<Breakpoint>> {
        Ok(Rc::new(Breakpoint {
            location: None,
            id: None,
            options: Options::parse(options)?,
            hit_count: Cell::new(0),
        }))
    }

    /// False if the hit is one of those to ignore.
    pub(super) fn count_hit(&self) -> bool {
        self.hit_count.update(|count| count + 1);
        self.hit_count.get() > self.options.ignore_count
    }
}
