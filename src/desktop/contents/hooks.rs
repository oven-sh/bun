//! What a page wants of other windows.

use bun_web::convert::token_for_path;
use bun_web::host::{Chosen, Opened, ToGuest, Verdict, Wish};
use bun_web::page::News;
use bun_web::trust;

use super::load::Initiator;
use super::page::Page;
use super::{Contents, link, spread};
use crate::prelude::*;
use crate::webview::embedded::Controls;

/// What stands for the files that the user or the app has chosen.
pub(crate) fn all_chosen(paths: JSValue) -> JsResult<JSValue> {
    let all = array(&[])?;
    with_elements(paths, |it| {
        it.iter()
            .try_for_each(|it| all.push(global(), token_for_path(global(), *it)))
    })?;
    Ok(all)
}

pub(super) fn show_context_menu(page: &Page, given: JSValue) -> JsResult<()> {
    let params = object!({
        "suggestedFilename": "",
        "selectionRect": Rect::default(),
        "selectionStartOffset": 0,
        "frameCharset": "UTF-8",
        "menuSourceType": "mouse",
        "mediaFlags": object!({}),
    });
    let about = object!({
        "frame": page.handle(),
        "pageURL": page.url(),
        "frameURL": "",
        "referrerPolicy": object!({ "url": "", "policy": "default" }),
    });
    announce(
        page.owner().to_js(),
        "context-menu",
        &[spread(spread(params, given)?, about)?],
    )
}

pub(super) fn open(
    page: &'static Page,
    wish: &Wish,
    target: &str,
    features: &str,
    popup: u32,
) -> JsResult<Opened> {
    let name = if target.eq_ignore_ascii_case("_blank") {
        ""
    } else {
        target
    };
    let Some(opened) = page.contents().open(page, wish, name, features)? else {
        return Ok(Opened::Nothing);
    };
    if opened.page().opener().is_some() {
        return Ok(Opened::Page(opened.page().id));
    }
    let guest = opened.guest();
    if guest.is_none()
        && page.has_relatives.get()
        && opened
            .opened_by()
            .is_some_and(|it| same(it, page.contents()))
    {
        return Ok(Opened::Context(opened.id));
    }
    if opened.is_destroyed.get() {
        page.later(move |it| it.tell(|it| it.tell_frame(popup, News::Closed)));
        return Ok(Opened::Popup);
    }
    let controls = (guest.filter(|it| it.get_is_opened_by_page()))
        .map(|guest| {
            let controls = Controls::create(page.to_js(), popup, 1.)?;
            controls.open_popup(guest, &wish.url, target)?;
            JsResult::Ok(controls.to_js())
        })
        .transpose()?;
    let both = array(&[opened.to_js(), controls.unwrap_or(JSValue::UNDEFINED)])?;
    page.numbered()?.set(global(), js(popup)?, both)?;
    let forget = listener(page, move |it, _| {
        it.numbered()?.remove(global(), js(popup)?)?;
        it.tell(|it| it.tell_frame(popup, News::Closed))
    })?;
    invoke(opened.to_js(), "once", &[js("destroyed")?, forget])?;
    Ok(Opened::Popup)
}

pub(super) fn create_guest(page: &Page, number: u32, scale: f64) -> JsResult<()> {
    let known = page.numbered()?;
    if known.get(global(), js(number)?)?.is_object() {
        return Ok(());
    }
    let controls = Controls::create(page.to_js(), number, scale)?;
    known.set(global(), js(number)?, controls.to_js())
}

pub(super) fn tell_guest(page: &Page, number: u32, message: ToGuest) -> JsResult<()> {
    let found = page.numbered()?.get(global(), js(number)?)?;
    if let Some(frame) = cast::<Controls>(found) {
        if let ToGuest::Remove = message {
            page.numbered()?.remove(global(), js(number)?)?;
        }
        return frame.obey(message);
    }
    if !found.is_array() {
        return Ok(());
    }
    let popup = cast::<Contents>(found.get_index(global(), 0)?);
    match (message, popup) {
        (ToGuest::Close, Some(popup)) => {
            popup.later(Contents::close_now);
            Ok(())
        }
        (ToGuest::Focus, Some(popup)) => popup.focus_window(),
        (message @ (ToGuest::Location { .. } | ToGuest::Post { .. }), _) => {
            cast::<Controls>(found.get_index(global(), 1)?).map_or(Ok(()), |it| it.obey(message))
        }
        _ => Ok(()),
    }
}

pub(super) fn choose_window(
    page: &Page,
    target: &str,
    wish: Option<Wish>,
    becomes_opener: bool,
) -> JsResult<Chosen> {
    let context = page.contents();
    let is_keyword = ["_self", "_parent", "_top"]
        .iter()
        .any(|it| target.eq_ignore_ascii_case(it));
    let may_choose = link::knows_other_windows(page) || context.is_frame();
    let found = if may_choose && (is_keyword || trust::relates_windows()) {
        context.choose(target)?
    } else {
        None
    };
    let Some(found) = found else {
        return Ok(Chosen::Nothing);
    };
    if becomes_opener {
        found.set_opened_by(Some(context));
    }
    Ok(Chosen::Context {
        id: found.id,
        verdict: wish.map_or(Ok(Verdict::Granted), |it| found.judge_for_script(page, it))?,
    })
}

pub(super) fn navigate(page: &Page, wish: Wish) -> JsResult<()> {
    let named = (wish.initiator)
        .and_then(|it| page.contents().related_page(it))
        .filter(|it| page.has_relatives.get() && it.is_kin_of(page));
    (page.contents()).wish(page, wish, Initiator::of(named.unwrap_or(page)), None)
}
