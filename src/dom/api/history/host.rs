//! What it takes to go elsewhere.

use bun_jsc::JSGlobalObject;

use bun_web::client::ScriptLocation;
use bun_web::csp::{Delivery, Inline};
use bun_web::host::{Chosen, Level, Opened, Traversal as Outcome, Verdict, Wish};

use super::navigate::Options;
use super::*;

use crate::api::events::{ErrorDescription, where_thrown};
use crate::api::loading::came_with;
use crate::api::realm::Kept;

fn calling_window<'a>(cx: &mut Cx<'a>, callee: &'a Window, is_entry: bool) -> &'a Window {
    unsafe extern "C" {
        safe fn Bun__DOM__callingWindow(global: &JSGlobalObject, is_entry: bool) -> JSValue;
    }
    let window = callee
        .cluster()
        .map(|_| Bun__DOM__callingWindow(cx.global(), is_entry));
    window
        .and_then(|it| WindowTarget::of(&cx.heap, it)?.downcast())
        .unwrap_or(callee)
}

/// <https://html.spec.whatwg.org/#concept-incumbent-global>
pub(super) fn caller<'a>(cx: &mut Cx<'a>, callee: &'a Window) -> &'a Window {
    calling_window(cx, callee, false)
}

/// <https://html.spec.whatwg.org/#entry-global-object>
pub(super) fn entry<'a>(cx: &mut Cx<'a>, callee: &'a Window) -> &'a Window {
    calling_window(cx, callee, true)
}

fn wish(url: &str, options: &Options<'_>) -> Box<Wish> {
    let text = |it: &Option<DomString>| it.as_ref().map(|it| it.to_utf8().into_owned());
    Box::new(Wish {
        url: url.into(),
        source: options.source,
        replaces: options.replace,
        is_by_user: options.is_by_user,
        has_activation: options.has_activation,
        has_text_activation: options.has_text_activation,
        download: text(&options.download),
        srcdoc: text(&options.srcdoc),
        referrer_policy: text(&options.referrer_policy),
        navigation_state: options.navigation_state.clone(),
        post: options.post.as_ref().map(|it| it.sent.clone()),
        initiator: options.initiator.map(|it| it.page),
        ..Default::default()
    })
}

pub(super) fn navigate(window: &Window, url: &str, options: &Options<'_>, markup: Option<String>) {
    window.host().navigate(Box::new(Wish {
        may_unload: true,
        markup,
        ..*wish(url, options)
    }));
}

/// Whether `source` may.
fn carry_out(
    verdict: Verdict,
    target: &Context,
    source: &Window,
    url: &str,
    options: &Options<'_>,
) -> bool {
    let options = match verdict {
        Verdict::Refused => return false,
        Verdict::Granted => return true,
        Verdict::UpToPage => Options {
            push: false,
            has_activation: false,
            navigation_state: None,
            noopener: None,
            ..options.clone()
        },
        Verdict::UpToForeignPage => Options {
            replace: options.replace,
            is_by_user: options.is_by_user,
            ..Default::default()
        },
    };
    let Some(window) = target.window() else {
        return true;
    };
    let is_by_other_origin = window
        .host()
        .origin()
        .is_none_or(|it| Some(it) != source.host().origin());
    let options = Options {
        initiator: Some(source),
        is_by_other_origin,
        ..options
    };
    window.enter(|cx, window| {
        History::of(&cx.heap, window).navigate(cx, url, options.in_other_scope(), "")
    });
    true
}

/// Whether `source` may.
pub(super) fn navigate_from(
    target: &Context,
    source: &Window,
    url: &str,
    options: &Options<'_>,
) -> bool {
    carry_out(
        source
            .host()
            .navigate_window(target.id(), wish(url, options)),
        target,
        source,
        url,
        options,
    )
}

pub(super) enum Target {
    /// Windows have no names.
    Unknown,
    Missing,
    Window(JSValue),
}

pub(super) fn navigate_other<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    target: &str,
    url: Option<&str>,
    options: &Options<'a>,
    becomes_opener: bool,
) -> Target {
    if !window.knows_other_windows()
        && !window
            .context()
            .is_some_and(|it| window.cluster().is_some() && it.container().is_some())
    {
        return Target::Unknown;
    }
    let Chosen::Context { id, verdict } = window.host().choose_window(
        target.into(),
        url.map(|it| wish(it, options)),
        becomes_opener,
    ) else {
        return Target::Missing;
    };
    let Some(found) = Context::with_id(id) else {
        return Target::Missing;
    };
    if let Some(url) = url {
        carry_out(verdict, found, window, url, options);
    }
    window
        .relative(&cx.heap, |_| Some(found))
        .filter(|it| it.is_object())
        .map_or(Target::Missing, Target::Window)
}

pub(super) fn open<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    url: &str,
    target: &str,
    features: &str,
    options: &Options<'a>,
) -> JSValue {
    let popup = crate::api::frames::next_number();
    let opened = match window
        .host()
        .open(wish(url, options), target.into(), features.into(), popup)
    {
        Opened::Nothing => None,
        Opened::Page(page) => Window::of_page(page).map(|it| it.window()),
        Opened::Context(id) => window.relative(&cx.heap, |_| Context::with_id(id)),
        Opened::Popup => Some(ForeignWindow::of_popup(&cx.heap, window, popup)),
    };
    opened.unwrap_or(JSValue::NULL)
}

/// False if it has no list of entries.
pub(super) fn traverse_to<'a>(
    cx: &mut Cx<'a>,
    navigation: &'a Navigation,
    window: &'a Window,
    key: &str,
) -> bool {
    if window.context().is_none() {
        return false;
    }
    let (navigation, given) = (Kept::new(cx, navigation.to_js()), key.to_owned());
    window.host().traverse_to(key.into(), move |_, outcome| {
        let error = match outcome {
            Outcome::Begun => return,
            Outcome::Aborted => None,
            Outcome::Forbidden => Some(DomError::SecurityError),
            Outcome::Impossible => Some(DomError::InvalidStateError),
        };
        navigation.enter(|cx, it| {
            Navigation::from_value(it.to_js())
                .into_iter()
                .for_each(|it| it.give_up_traversal(cx, Some(&given), error))
        });
    });
    true
}

fn is_in_source<'a>(cx: &mut Cx<'a>, window: &'a Window, text: &DomString) -> bool {
    let owner = core::iter::successors(Some(window), |it| it.opened_beside())
        .last()
        .unwrap_or(window);
    !owner.is_disposed() && came_with(cx, owner.document(), text)
}

fn policy_allows<'a>(cx: &mut Cx<'a>, window: &'a Window, source: &str, frame: JSValue) -> bool {
    window.document().own_client(&cx.heap).is_none_or(|it| {
        it.enforce(
            it.policies()
                .csp
                .check_inline(Inline::Navigation, source.as_bytes(), b"", true),
            frame,
        )
    })
}

fn allows_javascript_url<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    source: &DomString,
    initiator: &'a Window,
) -> bool {
    let frame = crate::api::frames::container(window.document())
        .filter(|it| it.doc() == initiator.document());
    let text = source.to_utf8();
    if initiator.host().is_sandboxed("allow-scripts".into())
        || !policy_allows(
            cx,
            initiator,
            &text,
            frame.map_or(JSValue::UNDEFINED, |it| it.to_js()),
        )
    {
        return false;
    }
    // Without a policy: what the document came with, and nothing that was put into it since.
    let has_policy = || {
        initiator
            .document()
            .own_client(&cx.heap)
            .is_some_and(|it| it.policies().csp.restricts_scripts())
    };
    let is_up_to_page = !bun_web::compiled::is_exclusive()
        && (has_policy() || bun_web::trust::trusts_injected_scripts());
    if !is_up_to_page && !is_in_source(cx, initiator, source) {
        initiator.host().console(
            Level::Error,
            "Refused to run an inline script that is not in the source of the document".into(),
            0,
            initiator.url(),
        );
        return false;
    }
    core::ptr::eq(window, initiator) || policy_allows(cx, window, &text, JSValue::UNDEFINED)
}

/// What the script comes to.
pub(super) fn run_javascript_url<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    source: &DomString,
    initiator: Option<&'a Window>,
) -> JSValue {
    let doc = window.document();
    let is_allowed = doc.runs_scripts()
        && if doc.is_of_program() {
            came_with(cx, doc, source)
        } else {
            window.context().is_some()
                && allows_javascript_url(cx, window, source, initiator.unwrap_or(window))
        };
    if !is_allowed {
        return JSValue::UNDEFINED;
    }
    crate::api::loading::run_javascript_url(cx, window.document(), source.clone())
}

impl Window {
    /// Of a `<meta>`.
    pub(crate) fn add_security_policy<'a>(&'a self, cx: &mut Cx<'a>, policy: &DomString) {
        let Some(client) = self
            .document()
            .own_client(&cx.heap)
            .filter(|_| self.context().is_some() && !self.is_disposed())
        else {
            return;
        };
        let is_own = is_in_source(cx, self, &DomString::concat(&[&"\0".into(), policy]));
        client.add_csp(
            policy.to_utf8().as_bytes(),
            if is_own {
                Delivery::Meta
            } else {
                Delivery::InjectedMeta
            },
        );
        self.host()
            .security_policy_added(policy.to_utf8().into_owned(), is_own);
        self.apply_policy(&cx.heap, false);
    }
}

pub(super) fn describe_error<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    error: JSValue,
) -> ErrorDescription {
    let global = cx.global();
    let at = if error.is_error() {
        where_thrown(global, error, None)
    } else {
        ScriptLocation::now(global)
    };
    let filename = if at.url.is_empty() {
        window.document().url()
    } else {
        DomString::from_utf8(&lossy(&at.url))
    };
    ErrorDescription {
        message: DomString::from_utf8(&crate::api::events::describe(global, error)),
        filename,
        lineno: at.line,
        colno: at.column,
    }
}
