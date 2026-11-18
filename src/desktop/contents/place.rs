//! Which process has a document.

use std::rc::Rc;

use bun_web::origin::{Origin, Site};
use bun_web::service::Lodging;
use bun_web::url::Url;
use bun_web::{compiled, trust};

use super::page::{About, Creator, Page};
use super::{Contents, fields, worlds};
use crate::prelude::*;
use crate::text::before;
use crate::{app, process};

const SANDBOXED: &str = " sandboxed";
const WORKERS: &str = " workers";

#[derive(Clone, Default, PartialEq)]
pub(super) enum Place {
    #[default]
    App,
    /// What can reach each other has the same site. That of an empty window is empty.
    Apart { role: Role, site: Rc<str> },
}

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Role {
    Stranger,
    Trusted,
    /// With what was compiled for pages.
    Compiled,
}

impl Place {
    fn role(&self) -> Option<Role> {
        match self {
            Place::App => None,
            Place::Apart { role, .. } => Some(*role),
        }
    }

    pub(super) fn site(&self) -> Rc<str> {
        match self {
            Place::App => "".into(),
            Place::Apart { site, .. } => Rc::clone(site),
        }
    }

    pub(super) fn is_trusted(&self) -> bool {
        self.role() != Some(Role::Stranger)
    }

    pub(super) fn runs_program(&self) -> bool {
        matches!(self.role(), None | Some(Role::Compiled))
    }

    pub(super) fn can_become(&self, other: &Place) -> bool {
        matches!(self, Place::Apart { site, .. } if site.is_empty()) && self.role() == other.role()
    }

    pub(super) fn can_be_shared(&self) -> bool {
        matches!(self, Place::Apart { site, .. } if !site.is_empty() && !site.ends_with(SANDBOXED))
    }
}

state!(fn is_sandbox_enabled() -> Cell<bool>);
state!(fn was_sandbox_asked_for() -> Cell<bool>);

unsafe extern "Rust" {
    safe fn __bun_desktop_can_sandbox_pages() -> bool;
    safe fn __bun_desktop_can_run_uncompiled_code() -> bool;
}

fn has_sandbox() -> bool {
    !switch_for_testing().is_empty() && __bun_desktop_can_sandbox_pages()
}

/// Returns whether there is one.
pub(crate) fn enable_sandbox() -> bool {
    is_sandbox_enabled().set(has_sandbox());
    forces_sandbox()
}

/// For `sandbox: true`. Returns whether there is one.
pub(super) fn ask_for_sandbox() -> bool {
    let is_there = has_sandbox();
    was_sandbox_asked_for().update(|it| it || is_there);
    is_there
}

pub(crate) fn show_the_rest(is_on: bool) -> JsResult<()> {
    if is_on && !(has_sandbox() && __bun_desktop_can_run_uncompiled_code()) {
        return Err(unsupported("setWebEngine"));
    }
    trust::set_sandbox_for_the_rest(is_on);
    super::process::statics_changed()
}

pub(super) fn forces_sandbox() -> bool {
    is_sandbox_enabled().get()
}

/// Nothing is shown in the app, so that all there is to trust a page with is what its origin has.
pub(super) fn trusts_by_origin() -> bool {
    forces_sandbox() && trust::has_sandbox_for_the_rest() && !compiled::is_for_any_document()
}

/// `asked` for what the app asks for, `1` for all pages, and `node` to try the sandbox from the inside.
fn switch_for_testing() -> &'static str {
    state!(fn known() -> core::cell::OnceCell<String>);
    known().get_or_init(|| {
        let read = |name| process::variable(name).ok().flatten();
        (read("BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING").filter(|_| cfg!(unix)))
            .and_then(|_| read("BUN_DESKTOP_PAGE_PROCESSES"))
            .unwrap_or_default()
    })
}

pub(super) fn is_for_testing() -> bool {
    matches!(switch_for_testing(), "1" | "node")
        && global().bun_vm().standalone_module_graph.is_none()
        && !process::variable("BUN_BE_BUN").is_ok_and(|it| it.is_some())
}

pub(super) fn moves_node_for_testing() -> bool {
    is_for_testing() && switch_for_testing() == "node"
}

fn moves_trusted_pages() -> bool {
    forces_sandbox() || is_for_testing()
}

pub(super) fn is_all_in_app() -> bool {
    !(moves_trusted_pages() || was_sandbox_asked_for().get() || trust::has_sandbox_for_the_rest())
}

impl Contents {
    fn has_compiled_preload(&self) -> bool {
        let is_compiled = |it: &String| worlds::compiled_preload(it).is_some();
        self.preloads().iter().any(is_compiled)
    }

    fn role_of_trusted(&self, runs_program: bool) -> Role {
        let is_compiled = global().bun_vm().standalone_module_graph.is_some();
        match is_compiled && (runs_program || self.has_compiled_preload()) {
            true => Role::Compiled,
            false => Role::Trusted,
        }
    }

    fn place_of_trusted(&self, site: &str, runs_program: bool) -> Place {
        let needs_app = self.preferences.integrates_node || !self.preferences.is_sandboxed;
        let moves = moves_trusted_pages() && (!needs_app || moves_node_for_testing());
        match moves || self.preferences.has_sandbox {
            true => Place::Apart {
                role: self.role_of_trusted(runs_program),
                site: site.into(),
            },
            false => Place::App,
        }
    }

    fn place_of_empty_window(&self) -> JsResult<Place> {
        let opener = fields::opener(self).and_then(cast::<Page>);
        let is_of_stranger = opener.is_some_and(|it| !it.place().is_trusted());
        Ok(
            match is_of_stranger || (trust::has_sandbox_for_the_rest() && self.is_foreign()?) {
                true => Place::Apart {
                    role: Role::Stranger,
                    site: "".into(),
                },
                false => self.place_of_trusted("", compiled::is_for_any_document()),
            },
        )
    }

    /// For the document that `url` will probably turn out to be.
    pub(super) fn prepare_process(&self, url: &Url) -> JsResult<()> {
        if is_all_in_app() || matches!(url.scheme(), b"about" | b"blob" | b"data") {
            return Ok(());
        }
        let (text, site) = (string(url.href()), self.key_of(&Site::of(url)));
        let place = match trust::has_sandbox_for_the_rest() && !self.is_trusted(&text)? {
            true => Place::Apart {
                role: Role::Stranger,
                site: site.into(),
            },
            false => self.place_of_trusted(&site, compiled::is_for_site_of(url)),
        };
        match self.has_process_for(&place) {
            true => Ok(()),
            false => super::process::prepare(&place, self.is_frame()),
        }
    }

    fn key_of(&self, site: &Site) -> String {
        key_of(self.session.network().id(), site)
    }

    /// Of a trusted page that can reach a document of `site`, whose window may have other preferences.
    fn place_of_kin(&self, site: &Site, otherwise: &Place) -> Option<Place> {
        let is_kin = |it: &&Page| {
            it.is_started()
                && it.place().is_trusted()
                && (it.place().runs_program() || otherwise.role() != Some(Role::Compiled))
                && it.site().is_some_and(|it| it == *site)
        };
        let others = self.members().into_iter().filter(|it| !same(*it, self));
        others.map(Contents::page).find(is_kin).map(Page::place)
    }

    fn trusts_next(
        &self,
        url: &Url,
        is_sandboxed: bool,
        is_led_by_stranger: bool,
    ) -> JsResult<bool> {
        let parent = self.embedded.as_ref().map(|_| self.embedder());
        Ok(
            match (trusts_by_origin(), trust::has_sandbox_for_the_rest()) {
                (_, false) => true,
                _ if parent.is_some_and(|it| !it.place().is_trusted()) => false,
                _ if is_led_by_stranger && !self.has_shown_trusted.get() => false,
                (true, true) => !is_sandboxed && trust::is_trusted(url, app::path()?.as_bytes()),
                (false, true) => self.is_trusted(&string(url.href()))?,
            },
        )
    }

    /// The document at `url`. `None` if it will not have the storage of its origin.
    pub(super) fn will_be_apart(
        &self,
        url: &Url,
        is_led_by_stranger: bool,
    ) -> JsResult<Option<bool>> {
        if is_all_in_app() {
            return Ok(Some(false));
        }
        if !self.trusts_next(url, false, is_led_by_stranger)? {
            return Ok((!trust::is_trusted_origin(Origin::of(url).as_bytes())).then_some(true));
        }
        let site = Site::of(url);
        let otherwise = self.place_of_trusted(&self.key_of(&site), compiled::is_for_site_of(url));
        Ok(Some(
            self.place_of_kin(&site, &otherwise).unwrap_or(otherwise) != Place::App,
        ))
    }
}

fn key_of(session: u32, site: &Site) -> String {
    format!("{session} {}", string(site.as_bytes()))
}

/// In a process that shows no pages.
pub(crate) fn lodge_worker(session: u32, url: &Url, is_compiled: bool) -> JsResult<Lodging> {
    if !has_sandbox() {
        return Err(unsupported("sandbox"));
    }
    let is_trusted = trust::is_trusted(url, app::path()?.as_bytes());
    let apart = if moves_node_for_testing() {
        ""
    } else {
        WORKERS
    };
    super::process::lease(Place::Apart {
        role: match (is_trusted, is_compiled) {
            (false, _) if trust::has_sandbox_for_the_rest() => Role::Stranger,
            (_, true) => Role::Compiled,
            _ => Role::Trusted,
        },
        site: (key_of(session, &Site::of(url)) + apart).into(),
    })
}

impl Page {
    fn site(&self) -> Option<Site> {
        let origin = self.client.origin();
        (!origin.is_opaque()).then(|| Site::of_origin(&origin))
    }

    /// Once it has its origin.
    pub(super) fn choose_place(&self, about: &About) -> JsResult<Place> {
        if is_all_in_app() {
            return Ok(Place::App);
        }
        let (it, url, creator) = (self.contents(), self.url(), about.creator.as_ref());
        let is_empty = before(before(&url, "#"), "?") == "about:blank";
        let is_error = (about.loaded.as_ref()).is_some_and(|it| it.unreachable.is_some());
        if let Some(creator) = creator.filter(|_| is_empty || about.is_of_markup) {
            return Ok(creator.place());
        }
        if is_empty || is_error {
            let known = (self.parent()).or_else(|| fields::page(it).filter(|_| is_error));
            return known.map_or_else(|| it.place_of_empty_window(), |it| Ok(it.place()));
        }
        let (session, parsed) = (it.session.network().id(), self.client.url());
        let is_sandboxed = self.sandbox().forbids("allow-same-origin");
        let named = Origin::of(&parsed);
        let maker = creator.filter(|it| match parsed.scheme() {
            b"about" | b"data" => true,
            b"blob" => named.is_opaque() || named == it.client().origin(),
            _ => false,
        });
        let site = match maker.map(|it| (it.place(), it.client().origin())) {
            Some((place @ Place::Apart { .. }, _)) if !is_sandboxed => return Ok(place),
            Some((Place::Apart { site, .. }, _)) => before(&site, SANDBOXED).to_owned(),
            Some((_, origin)) if !origin.is_opaque() => it.key_of(&Site::of_origin(&origin)),
            None if parsed.scheme() == b"blob" && !named.is_opaque() => {
                it.key_of(&Site::of_origin(&named))
            }
            None if parsed.scheme() != b"data" && parsed.scheme() != b"blob" => {
                it.key_of(&Site::of(&parsed))
            }
            _ => format!("{session} page {}", self.id),
        };
        let site = site + if is_sandboxed { SANDBOXED } else { "" };
        let is_led_by_stranger = creator.is_some_and(|it| !it.place().is_trusted())
            || (about.loaded.as_ref()).is_some_and(|it| it.is_led_by_stranger);
        if !it.trusts_next(&parsed, is_sandboxed, is_led_by_stranger)? {
            let (role, site) = (Role::Stranger, site.into());
            return Ok(Place::Apart { role, site });
        }
        let runs_program = self.client.runs_program() || compiled::is_for_site_of(&parsed);
        let otherwise = it.place_of_trusted(&site, runs_program);
        let of_kin = (self.site()).and_then(|site| it.place_of_kin(&site, &otherwise));
        Ok(of_kin.unwrap_or(otherwise))
    }
}

impl Creator {
    pub(super) fn place(&self) -> Place {
        match self {
            Creator::Page(page) => page.get().place(),
            Creator::Bequest { place, .. } => place.clone(),
        }
    }
}
