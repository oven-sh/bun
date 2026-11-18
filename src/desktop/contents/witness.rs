//! What the user and the app have really done to the pages of a process, which may claim more.

use std::collections::VecDeque;

use bun_web::host::{ChosenFile, Keystroke, Notice, Question, ToFrame, ToGuest, Wish};
use bun_web::input::{Action, Drag, Input, Phase};
use bun_web::page::Order;
use bun_web::time::monotonic_now;
use bun_web::url::Url;

use super::page::is_recent;
use crate::prelude::*;

#[derive(Clone, Copy, PartialEq)]
enum Contact {
    Button(Action, i16),
    Fingers(Phase),
}

enum Gesture {
    Contact(Contact),
    Key(Keystroke),
    Shortcut(Keystroke),
    Text(String),
    Edit(String),
    Drop(Vec<ChosenFile>),
}

pub(super) struct Witness {
    activated_at: Cell<f64>,
    may_paste_since: Cell<f64>,
    may_paste_selection_since: Cell<f64>,
    may_copy_since: Cell<f64>,
    may_show_menu_since: Cell<f64>,
    /// Each can be passed on once.
    gestures: RefCell<VecDeque<(f64, Gesture)>>,
    /// To a frame that it does not have.
    passes_drag_on: Cell<bool>,
}

fn is_same(one: &Keystroke, other: &Keystroke) -> bool {
    (&one.key, &one.code, one.modifiers) == (&other.key, &other.code, other.modifiers)
}

fn contact_in(input: &Input) -> Option<Contact> {
    match input {
        _ if !input.may_activate() => None,
        Input::Mouse(mouse) | Input::Pen { mouse, .. } => {
            Some(Contact::Button(mouse.action, mouse.button))
        }
        Input::Touch { phase, .. } => Some(Contact::Fingers(*phase)),
        _ => None,
    }
}

fn pastes(key: &Keystroke) -> bool {
    const SHIFT: u32 = 1;
    const CONTROL_OR_META: u32 = 2 | 8;
    let is_v = key.key.eq_ignore_ascii_case("v") || key.code == "KeyV";
    (is_v && key.modifiers & CONTROL_OR_META != 0)
        || (key.key == "Insert" && key.modifiers & SHIFT != 0)
        || key.key == "Paste"
}

impl Witness {
    pub(super) fn new() -> Witness {
        Witness {
            activated_at: f64::NEG_INFINITY.into(),
            may_paste_since: f64::NEG_INFINITY.into(),
            may_paste_selection_since: f64::NEG_INFINITY.into(),
            may_copy_since: f64::NEG_INFINITY.into(),
            may_show_menu_since: f64::NEG_INFINITY.into(),
            gestures: Default::default(),
            passes_drag_on: false.into(),
        }
    }

    fn remember(&self, gesture: Gesture) {
        const MOST: usize = 64;
        let mut all = self.gestures.borrow_mut();
        all.push_back((monotonic_now(), gesture));
        if all.len() > MOST {
            all.pop_front();
        }
    }

    fn take(&self, is_it: impl Fn(&Gesture) -> bool) -> Option<Gesture> {
        let mut all = self.gestures.borrow_mut();
        all.retain(|it| is_recent(it.0));
        let at = all.iter().position(|it| is_it(&it.1))?;
        Some(all.remove(at)?.1)
    }

    pub(super) fn note_activation(&self) {
        self.activated_at.set(monotonic_now());
    }

    pub(super) fn note_permission(&self, name: &str) {
        match name {
            "clipboard-read" => self.may_paste_since.set(monotonic_now()),
            "clipboard-sanitized-write" => self.may_copy_since.set(monotonic_now()),
            _ => {}
        }
    }

    pub(super) fn note(&self, order: &mut Order) {
        let input = match order {
            Order::Input { input } => input,
            Order::Activate {} => return self.note_activation(),
            Order::Edit { command } => {
                match command.starts_with("paste") {
                    true => self.may_paste_since.set(monotonic_now()),
                    false => self.may_copy_since.set(monotonic_now()),
                }
                return self.remember(Gesture::Edit(command.clone()));
            }
            _ => return,
        };
        if input.may_activate() {
            self.note_activation();
            self.may_show_menu_since.set(monotonic_now());
        }
        if let Some(contact) = contact_in(input) {
            self.remember(Gesture::Contact(contact));
            if let Contact::Button(_, 1) = contact {
                self.may_paste_selection_since.set(monotonic_now());
            }
        }
        match input {
            Input::Key(key) if key.is_down => {
                self.remember(Gesture::Key(key.clone()));
                self.remember(Gesture::Shortcut(key.clone()));
                if pastes(key) {
                    self.may_paste_since.set(monotonic_now());
                }
            }
            Input::Text { text, .. } | Input::Compose { text, .. } => {
                self.remember(Gesture::Text(text.clone()));
            }
            Input::Drag { phase, files, .. } => {
                let is_dropped = *phase == Drag::Drop;
                if is_dropped {
                    self.remember(Gesture::Drop(files.clone()));
                }
                let gets_files = is_dropped && !self.passes_drag_on.get();
                for it in files.iter_mut().filter(|_| !gets_files) {
                    it.0 = format!("file{}", string(bun_paths::extension(it.0.as_bytes())));
                }
            }
            _ => {}
        }
    }

    fn may_pass_on(&self, input: &mut Input) -> bool {
        if let Some(contact) = contact_in(input) {
            return (self.take(|it| matches!(it, Gesture::Contact(it) if *it == contact)))
                .is_some();
        }
        match input {
            Input::Key(key) if key.is_down => {
                (self.take(|it| matches!(it, Gesture::Key(it) if is_same(it, key)))).is_some()
            }
            Input::Text { text, .. } | Input::Compose { text, .. } => {
                (self.take(|it| matches!(it, Gesture::Text(it) if it == text))).is_some()
            }
            Input::Drag { phase, files, .. } => {
                (self.passes_drag_on).set(matches!(phase, Drag::Enter | Drag::Over));
                if *phase != Drag::Drop {
                    files.retain(|it| !bun_paths::is_absolute(it.0.as_bytes()));
                    return true;
                }
                let Some(Gesture::Drop(dropped)) = self.take(|it| matches!(it, Gesture::Drop(_)))
                else {
                    return false;
                };
                *files = dropped;
                true
            }
            Input::Perform { .. } => false,
            _ => true,
        }
    }

    fn correct_wish(&self, wish: &mut Wish) {
        let is_active = is_recent(self.activated_at.get());
        wish.is_by_user &= is_active;
        wish.has_activation &= is_active;
        wish.has_text_activation &= is_active;
    }

    pub(super) fn believes(&self, notice: &mut Notice) -> bool {
        let Notice::ContextMenu { menu } = notice else {
            return true;
        };
        menu.edit_flags.can_paste &= bun_web::dom::can_paste();
        for url in [&mut menu.page_url, &mut menu.link_url, &mut menu.src_url] {
            *url = Url::parse(url.as_bytes()).map_or_else(String::new, |it| string(it.href()));
        }
        is_recent(self.may_show_menu_since.replace(f64::NEG_INFINITY))
    }

    /// Whether it is to be answered.
    pub(super) fn admits(&self, question: &mut Question) -> bool {
        let is_active = || is_recent(self.activated_at.get());
        match question {
            Question::Navigate { wish }
            | Question::NavigateWindow { wish, .. }
            | Question::Open { wish, .. }
            | Question::ChooseWindow {
                wish: Some(wish), ..
            } => self.correct_wish(wish),
            Question::ActivatedByPreload {} => self.note_activation(),
            Question::Activated {} | Question::PickFiles { .. } => return is_active(),
            Question::Permission { name } if name == "fullscreen" => return is_active(),
            Question::ReadClipboard { is_selection } => {
                let since = match is_selection {
                    true => &self.may_paste_selection_since,
                    false => &self.may_paste_since,
                };
                return is_recent(since.replace(f64::NEG_INFINITY));
            }
            Question::WriteClipboard { .. } | Question::WriteImage { .. } => {
                return is_recent(self.may_copy_since.replace(f64::NEG_INFINITY)) || is_active();
            }
            Question::UnhandledKey { key } => {
                return (self.take(|it| matches!(it, Gesture::Shortcut(it) if is_same(it, key))))
                    .is_some();
            }
            Question::Guest {
                message: ToGuest::Edit(command),
                ..
            } => {
                return (self.take(|it| matches!(it, Gesture::Edit(it) if it == command)))
                    .is_some();
            }
            Question::Guest {
                message: ToGuest::Input(input),
                ..
            }
            | Question::Frame {
                message: ToFrame::Input(input),
                ..
            } => return self.may_pass_on(input),
            _ => {}
        }
        true
    }
}
