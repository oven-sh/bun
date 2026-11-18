//! Windows and frames that know each other, and are in different processes.

use bun_ui::protocol::{PageCommand, Proxy};
use bun_web::channel::Message;
use bun_web::host::{Container, Looks, Position, ToContainer};
use bun_web::input::{Action, Input};
use bun_web::origin::Origin;
use bun_web::page::{Controls, News as ForElement};
use bun_web::time::monotonic_now;
use bun_web::url::Url;

use super::page::{Page, is_recent};
use super::{Contents, place, with_id};
use crate::prelude::*;

/// What a frame has been told by the page that has its element.
#[derive(Default)]
pub(super) struct Told {
    looks: Cell<Looks>,
    position: Cell<Option<Position>>,
    has_focus: Cell<bool>,
    has_pointer: Cell<bool>,
    scrolled_at: Cell<Option<f64>>,
}

/// The pages around have no business with it.
pub(super) fn is_typed(input: &Input) -> bool {
    match input {
        Input::Key(key) => key.key != "Escape",
        Input::Text { .. } | Input::Compose { .. } | Input::EndComposition => true,
        _ => false,
    }
}

fn are_sane<const N: usize>(numbers: [f64; N]) -> bool {
    numbers.iter().all(|it| it.abs() < 1e7)
}

impl Contents {
    /// From its element.
    pub(super) fn is_apart(&self) -> bool {
        self.is_frame() && !self.page().is_beside(self.embedder())
    }

    fn told(&self) -> Option<&Told> {
        (self.embedded.as_ref().map(|it| &it.told)).filter(|_| self.is_apart())
    }

    pub(super) fn pages_apart_below(&self) -> JsResult<Vec<Root<Page>>> {
        if place::is_all_in_app() {
            return Ok(Vec::new());
        }
        let mut all = self.page().with_descendants()?;
        all.remove(0);
        all.retain(|it| it.get().contents().is_apart());
        Ok(all)
    }

    /// The outermost one that it is in without leaving the process.
    fn entrance(&self) -> &'static Contents {
        (self.with_ancestors().find(|it| it.is_apart())).unwrap_or_else(|| self.owner())
    }

    pub(super) fn page_with_keys(&self) -> &'static Page {
        match with_id(self.context.with_keys.get()) {
            Some(frame) => frame.entrance().page(),
            None => self.page(),
        }
    }

    fn give_keys(&self) {
        let before = with_id(self.owner().context.with_keys.replace(self.id));
        (before.into_iter().chain([self.itself()])).for_each(Contents::represent);
    }

    pub(super) fn represent(&self) {
        if let Some((told, process)) = self.told().zip(self.page().process()) {
            process.command(PageCommand::Represent(Proxy {
                surface: self.surface,
                top: self.owner().surface,
                has_keys: same(self.owner().page_with_keys(), self.page()),
                has_pointer: told.has_pointer.get(),
            }));
        }
    }

    pub(super) fn container(&self) -> Option<Container> {
        let (told, element) = (self.told()?, self.element());
        Some(Container {
            origin: self.embedder().origin(),
            looks: told.looks.get(),
            forbids_scrolling: element.forbids_scrolling,
            is_object: matches!(&*element.kind, "object" | "embed"),
            margins: element.margins,
        })
    }

    pub(super) fn is_out_of_sight(&self) -> bool {
        (self.told().and_then(|it| it.position.get())).is_some_and(|it| it.shown.is_none())
    }

    pub(super) fn origin_in_top(&self) -> [f64; 2] {
        (self.entrance().told().and_then(|it| it.position.get())).map_or([0.; 2], |it| it.origin)
    }

    pub(super) fn catch_up_with_element(&self) -> JsResult<()> {
        let (page, Some(told)) = (self.page(), self.told()) else {
            return Ok(());
        };
        self.represent();
        if let Some(extent) = self.size() {
            let is_quiet = true;
            page.tell(|it| it.input(Input::Resize { extent, is_quiet }))?;
        }
        (told.position.get()).map_or(Ok(()), |position| page.tell(|it| it.moved(position)))?;
        match told.has_focus.get() {
            true => page.tell(|it| it.input(Input::Focus { direction: 0 })),
            false => Ok(()),
        }
    }

    pub(super) fn change_looks(&self, looks: Looks) -> JsResult<()> {
        self.told().map_or(Ok(()), |it| {
            it.looks.set(looks);
            self.page().tell(Controls::environment_changed)
        })
    }

    pub(super) fn change_position(&self, position: Position) -> JsResult<()> {
        let is_sane = are_sane(position.origin) && position.shown.is_none_or(are_sane);
        let Some(told) = self.told().filter(|_| is_sane) else {
            return Ok(());
        };
        let was_out_of_sight = self.is_out_of_sight();
        told.position.set(Some(position));
        self.page().tell(|it| it.moved(position))?;
        match was_out_of_sight == self.is_out_of_sight() {
            true => Ok(()),
            false => self.page().tell(Controls::environment_changed),
        }
    }

    pub(super) fn exit_fullscreen_for_element(&self) -> JsResult<()> {
        (self.told()).map_or(Ok(()), |_| self.page().tell(Controls::exit_fullscreen))
    }

    pub(super) fn input_from_element(&self, input: Input) -> JsResult<()> {
        let Some(told) = self.told() else {
            return Ok(());
        };
        let around = self.embedder().contents().entrance();
        match &input {
            Input::Focus { .. } => {
                told.has_focus.set(true);
                if same(self.owner().page_with_keys(), around.page()) {
                    self.give_keys();
                }
            }
            Input::Blur { leaves } => {
                told.has_focus.set(false);
                let with_keys = self.owner().page_with_keys().contents();
                if *leaves && with_keys.with_ancestors().any(|it| same(it, self)) {
                    around.give_keys();
                }
            }
            Input::Mouse(mouse) | Input::Pen { mouse, .. } => {
                let has_pointer = mouse.action != Action::Leave;
                if told.has_pointer.replace(has_pointer) != has_pointer {
                    self.represent();
                }
            }
            Input::Wheel { .. } | Input::Touch { .. } => {
                told.scrolled_at.set(Some(monotonic_now()));
            }
            Input::Key(_) | Input::Pinch { .. } | Input::Drag { .. } => {}
            _ => return Ok(()),
        }
        self.page().tell(|it| it.input(input))
    }

    pub(super) fn tell_container(&self, message: ToContainer) -> JsResult<()> {
        let Some(told) = self.told() else {
            return Ok(());
        };
        self.tell_element(match message {
            ToContainer::Focus => ForElement::Focus,
            ToContainer::Scroll(delta)
                if are_sane(delta) && told.scrolled_at.get().is_some_and(is_recent) =>
            {
                ForElement::Scroll(delta)
            }
            ToContainer::Reveal(area) if are_sane(area) => ForElement::Reveal(area),
            ToContainer::Tab { is_backward } => ForElement::Tab { is_backward },
            ToContainer::Fit(size) if are_sane(size) => ForElement::Fit(size.map(|it| it.max(0.))),
            _ => return Ok(()),
        })
    }

    pub(super) fn spread_activation(&self) -> JsResult<()> {
        if !self.is_apart() {
            return Ok(());
        }
        (self.embedder().process().iter()).for_each(|it| it.witness.note_activation());
        self.tell_element(ForElement::Activated)
    }

    pub(super) fn consume_activation_apart_from(&self, page: &Page) -> JsResult<()> {
        let mut all = self.pages_apart_below()?;
        all.push(Root::new(self.page()));
        let own = page.contents().entrance().page();
        (all.iter().map(Root::get).filter(|it| !same(*it, own)))
            .try_for_each(|it| it.tell(Controls::consume_activation))
    }

    pub(super) fn post(&self, source: &Page, message: Message, wanted: &str) -> JsResult<()> {
        if self.has_crashed() || self.context.is_closed.get() {
            return Ok(());
        }
        let page = self.started_page()?;
        let is_for_it = match wanted {
            "*" => true,
            "/" => page.origin_key() == source.origin_key(),
            url => (Url::parse(url.as_bytes()).map(|it| Origin::of(&it)))
                .is_some_and(|it| !it.is_opaque() && it == page.client.origin()),
        };
        if !is_for_it {
            return Ok(());
        }
        let token = match source.client.origin().is_opaque() {
            true => string(source.token()),
            false => String::new(),
        };
        page.tell(|it| it.deliver(source.contents().id, source.origin(), token, message))
    }
}
