//! <https://html.spec.whatwg.org/#the-script-element>

use bun_web::mime;
use bun_web::request::Credentials;

use super::modules::{Fetching, Inline, Module};
use super::*;
use crate::api::core::html::{is_text_of_script_trusted, trust_text_of_script};
use crate::api::events::run_script;
use crate::api::svg;
use crate::api::trusted::Trusted;
use crate::generated_bindgen::html::HTMLScriptElement;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScriptFate {
    ParserInserted,
    RunsWhenConnected,
    AlreadyStarted,
}

struct Script {
    is_parser_inserted: Cell<bool>,
    forces_async: Cell<bool>,
    has_started: Cell<bool>,
    blocks_parser: Cell<bool>,
    had_duplicate_attributes: Cell<bool>,
    /// While it was being parsed.
    was_tampered_with: Cell<bool>,
    /// Where its text begins in the source of the document.
    position: Cell<(u32, u32)>,
}

impl Default for Script {
    fn default() -> Script {
        let [
            is_parser_inserted,
            has_started,
            blocks_parser,
            had_duplicate_attributes,
            was_tampered_with,
        ] = Default::default();
        Script {
            is_parser_inserted,
            forces_async: Cell::new(true),
            has_started,
            blocks_parser,
            had_duplicate_attributes,
            was_tampered_with,
            position: Cell::default(),
        }
    }
}

impl Script {
    fn of(node: &Node) -> &Script {
        node.extra()
    }
}

pub(crate) fn script_created(
    heap: &JsHeap<'_>,
    script: &Element,
    parsed: &Doc,
    fate: ScriptFate,
    position: (u32, u32),
    had_duplicate_attributes: bool,
) {
    let (it, is_parser_inserted) = (Script::of(script), fate == ScriptFate::ParserInserted);
    it.is_parser_inserted.set(is_parser_inserted);
    it.forces_async.set(!is_parser_inserted);
    it.has_started.set(fate == ScriptFate::AlreadyStarted);
    it.position.set(position);
    it.had_duplicate_attributes.set(had_duplicate_attributes);
    if is_parser_inserted {
        script.set_edge(heap, Edge::ParserDocument, parsed.to_js());
    }
}

pub(crate) fn mark_script_as_started(script: &Element) {
    Script::of(script).has_started.set(true);
}

pub(super) fn blocks_parser(node: &Node) -> bool {
    node.try_extra::<Script>()
        .is_some_and(|it| it.blocks_parser.get())
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Type {
    Classic,
    Module,
    ImportMap,
}

impl Type {
    #[optimize(size)]
    pub(super) fn of(script: &Element) -> Option<Type> {
        let Some(given) = script
            .attr(atom!("type"))
            .map(|it| it.to_utf8().to_ascii_lowercase())
        else {
            let language = utf8(
                script
                    .attr(atom!("language"))
                    .filter(|_| script.kind() == Kind::Script),
            )
            .to_ascii_lowercase();
            return (language.is_empty() || mime::is_javascript(&[b"text/", &*language].concat()))
                .then_some(Type::Classic);
        };
        match given.as_bytes() {
            b"" => Some(Type::Classic),
            b"module" => Some(Type::Module),
            b"importmap" => Some(Type::ImportMap),
            other => mime::is_javascript(other.trim_ascii()).then_some(Type::Classic),
        }
    }
}

/// <https://w3c.github.io/webappsec-csp/#is-element-nonceable>
#[optimize(size)]
pub(super) fn nonce_of(node: &Node) -> Bytes {
    let Some(element) = node.as_element() else {
        return Bytes::default();
    };
    let nonce = element.nonce();
    if nonce.is_empty() || !matches!(element.kind(), Kind::Script | Kind::SvgScript) {
        return utf8(Some(nonce));
    }
    let looks_injected = |text: &str| {
        ["<script", "<style", "<link"]
            .iter()
            .any(|it| strings::contains_case_insensitive_ascii(text.as_bytes(), it.as_bytes()))
    };
    let is_suspect = Script::of(node).had_duplicate_attributes.get()
        || element.attrs().iter().any(|(name, value)| {
            looks_injected(&name.qualified().as_utf8()) || looks_injected(&value.to_utf8())
        });
    if is_suspect {
        Bytes::default()
    } else {
        utf8(Some(nonce))
    }
}

#[optimize(size)]
pub(super) fn fetching_of(node: &Node) -> Fetching {
    Fetching {
        nonce: nonce_of(node),
        credentials: cors_of(node).map(|it| {
            if matches!(it, Cors::UseCredentials) {
                Credentials::Include
            } else {
                Credentials::SameOrigin
            }
        }),
        referrer_policy: referrer_policy_of(node),
        integrity: attribute(node, atom!("integrity")).map(|it| utf8(Some(it))),
        ..Fetching::default()
    }
}

enum Provenance {
    Inline {
        base: Bytes,
    },
    /// With what the URL was before it was redirected. Stacks show it.
    Fetched {
        requested: Bytes,
    },
}

struct Classic {
    source: DomString,
    url: Bytes,
    provenance: Provenance,
    position: (u32, u32),
    is_muted: bool,
    fetching: Fetching,
}

impl Classic {
    fn inline(doc: &Doc, source: DomString, position: (u32, u32), fetching: Fetching) -> Classic {
        Classic {
            source,
            url: utf8(Some(doc.url())),
            provenance: Provenance::Inline {
                base: utf8(Some(doc.base_url())),
            },
            position,
            is_muted: false,
            fetching,
        }
    }

    fn is_inline(&self) -> bool {
        matches!(self.provenance, Provenance::Inline { .. })
    }

    fn base(&self) -> &Bytes {
        if let Provenance::Inline { base } = &self.provenance {
            base
        } else {
            &self.url
        }
    }

    fn shown_url(&self) -> &Bytes {
        if let Provenance::Fetched { requested } = &self.provenance {
            requested
        } else {
            &self.url
        }
    }

    fn evaluate_as_it_is<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        modules::evaluate_classic(cx, &self.source, &self.url, self.base(), self.position)
    }

    fn evaluate_here<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        if !self.is_inline()
            && let Some(path) = bun_web::compiled::path_of(&self.url)
        {
            return modules::run_compiled(cx, &path, true);
        }
        let shown = self.shown_url();
        if self.is_muted {
            WindowTarget::of_realm(&cx.heap).inspect(|it| it.mute_errors(shown));
        }
        let base = if self.is_muted {
            b"about:blank"
        } else {
            &**self.base()
        };
        let key = modules::key_of_classic_script(&cx.heap, base, &self.fetching);
        let base = key.as_ref().map_or(base, |it| it.as_bytes());
        if !self.is_inline() && !self.is_muted {
            modules::script_was_fetched(&cx.heap, base);
        }
        modules::evaluate_classic(cx, &self.source, shown, base, self.position)
    }

    /// <https://html.spec.whatwg.org/#run-a-classic-script>
    #[optimize(size)]
    fn evaluate<'a>(self, cx: Cx<'_, 'a>, doc: &'a Doc) -> JSValue {
        let mut result = JSValue::UNDEFINED;
        run_script(cx, |cx| {
            if doc.has_realm(&cx.heap) && (self.is_inline() || doc.may_run_script_at(&self.url)) {
                doc.in_realm(|cx| {
                    match if doc.is_of_program() {
                        self.evaluate_as_it_is(cx)
                    } else {
                        self.evaluate_here(cx)
                    } {
                        Ok(value) => result = value,
                        Err(error) => report_error(cx, error, self.shown_url()),
                    }
                });
            }
        });
        result
    }

    #[optimize(size)]
    fn run<'a>(self, cx: Cx<'_, 'a>, script: &'a Element) {
        let doc = script.doc();
        let before = doc.current_script();
        doc.set_current_script(
            &cx.heap,
            script.root().as_shadow_root().is_none().then_some(script),
        );
        self.evaluate(cx, doc);
        doc.set_current_script(&cx.heap, before);
    }
}

/// <https://html.spec.whatwg.org/#evaluate-a-javascript:-url>
pub(crate) fn run_javascript_url<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, source: DomString) -> JSValue {
    Classic::inline(doc, source, (0, 0), Fetching::default()).evaluate(cx, doc)
}

/// <https://html.spec.whatwg.org/#concept-script-result>
enum Ready {
    Failed,
    Classic(Classic),
    Fetched {
        resource: Resource,
        requested: Bytes,
        encoding: Option<Encoding>,
        fetching: Fetching,
    },
    Module {
        module: Module,
        is_external: bool,
    },
}

/// <https://html.spec.whatwg.org/#execute-the-script-element>
#[optimize(size)]
fn execute<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, script: JSValue, ready: Ready) {
    if doc
        .try_edge_list(Edge::RenderBlockers)
        .is_some_and(|it| it.contains(script))
    {
        unblock_rendering(cx, doc, script);
    }
    let Some(script) = Element::from_js(&cx.heap, script).filter(|it| core::ptr::eq(it.doc(), doc))
    else {
        return;
    };
    let ignored = &doc.loading().ignores_destructive_writes;
    let is_external = match ready {
        Ready::Failed => {
            fire(cx, script, atom!("error"), EventInit::default());
            return;
        }
        Ready::Classic(classic) => return classic.run(cx, script),
        Ready::Fetched {
            resource,
            requested,
            encoding,
            fetching,
        } => {
            let encoding = resource.encoding(encoding.unwrap_or_else(|| doc.encoding()));
            let source = if encoding.is_utf8() {
                utf8_text(&resource.bytes)
            } else {
                DomString::from_utf8(&encoding.decode(&resource.bytes, false))
            };
            ignored.update(|it| it + 1);
            Classic {
                source,
                url: resource.url.href().into(),
                provenance: Provenance::Fetched { requested },
                position: (0, 0),
                is_muted: !resource.is_readable,
                fetching,
            }
            .run(cx, script);
            true
        }
        Ready::Module {
            module,
            is_external,
        } => {
            ignored.update(|it| it + 1);
            run_script(cx, |_| doc.in_realm(|cx| module.run(cx)));
            is_external
        }
    };
    ignored.update(|it| it - 1);
    if is_external {
        fire(cx, script, atom!("load"), EventInit::default());
    }
}

pub(super) struct Pending {
    script: Anchor,
    ready: Receiver<Ready>,
}

impl Pending {
    async fn run(self) {
        let ready = self.ready.await.unwrap_or(Ready::Failed);
        self.script
            .in_task(Box::new(|cx, doc, script| execute(cx, doc, script, ready)))
            .await;
    }

    pub(super) async fn run_after(self, sheets: &BlockingSheets) {
        let ready = self.ready.await.unwrap_or(Ready::Failed);
        sheets.loaded().await;
        self.script
            .soon(|cx, doc, script| execute(cx, doc, script, ready))
            .await;
    }
}

/// If the parser has inserted it.
pub(super) fn blocks_by_default(script: &Element, kind: Type) -> bool {
    kind == Type::Classic && !script.has_attr(atom!("async")) && !script.has_attr(atom!("defer"))
}

#[optimize(size)]
fn fetch<'a>(
    cx: Cx<'_, 'a>,
    script: &'a Element,
    kind: Type,
    url: Option<Url>,
    source: &DomString,
) -> Receiver<Ready> {
    let doc = script.doc();
    let is_parser_inserted = Script::of(script).is_parser_inserted.get();
    let blocks_rendering = allows_render_blockers(doc)
        && (asks_to_block_rendering(script)
            || (is_parser_inserted && blocks_by_default(script, kind)));
    let fetching = Fetching {
        is_parser_inserted,
        blocks_rendering,
        ..fetching_of(script)
    };
    if let (Type::Classic, Some(url), Some(client)) = (kind, &url, doc.client(&cx.heap)) {
        let mut request = request_for(
            &client,
            script,
            url.clone(),
            Destination::Script,
            cors_of(script),
        );
        (
            request.metadata.is_parser_inserted,
            request.blocks_rendering,
        ) = (is_parser_inserted, blocks_rendering);
        let encoding = Encoding::for_label(&utf8(script.attr(atom!("charset"))));
        let fetching = Fetching {
            integrity: None,
            is_parser_inserted: false,
            ..fetching
        };
        let requested = url.without_fragment().into();
        let loading = async move {
            client
                .load(request, Purpose::Use, false)
                .await
                .map_or(Ready::Failed, |resource| Ready::Fetched {
                    resource,
                    requested,
                    encoding,
                    fetching,
                })
        };
        return start_for(doc, loading);
    }
    let is_external = url.is_some();
    if !doc.has_realm(&cx.heap)
        || url
            .as_ref()
            .is_some_and(|it| !doc.may_run_script_at(it.href()))
    {
        return Receiver::ready(Ready::Failed);
    }
    if doc.is_of_program() {
        let module = url.map_or_else(
            || Module::InlineOfProgram(source.clone()),
            Module::OfProgram,
        );
        return Receiver::ready(Ready::Module {
            module,
            is_external,
        });
    }
    let preparing = doc.in_realm(|cx| match url {
        Some(url) => modules::prepare(cx, &url, fetching),
        None => {
            let inline = Inline {
                source: source.clone(),
                url: utf8(Some(doc.url())),
                base: utf8(Some(doc.base_url())),
                position: Script::of(script).position.get(),
            };
            modules::prepare_inline(
                cx,
                inline,
                Fetching {
                    integrity: None,
                    is_parser_inserted: false,
                    ..fetching
                },
            )
        }
    });
    start_for(doc, async move {
        preparing
            .await
            .flatten()
            .map_or(Ready::Failed, |module| Ready::Module {
                module,
                is_external,
            })
    })
}

fn is_for_another_event(script: &Element) -> bool {
    let is = |name, values: &[&str]| {
        script.with_attr(name, |it| {
            values
                .iter()
                .any(|value| it.trim_ascii().eq_ignore_ascii_case(value))
        })
    };
    matches!((is(atom!("for"), &["window"]), is(atom!("event"), &["onload", "onload()"])), (Some(a), Some(b)) if !(a && b))
}

/// <https://html.spec.whatwg.org/#pending-parsing-blocking-script>
#[optimize(size)]
fn pause_parser<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    parser: &'a DocumentParser,
    Pending { script, ready }: Pending,
) {
    parser.set_paused(true);
    speculation::speculate(cx, doc, parser);
    let (sheets, paused) = (
        Rc::clone(&doc.loading().blocking_sheets),
        Strong::create(parser.to_js(), doc.global()),
    );
    spawn_for(doc, async move {
        let ready = ready.await.unwrap_or(Ready::Failed);
        sheets.loaded().await;
        let resuming = script.soon(move |cx, doc, script| {
            let parser = doc
                .parser(&cx.heap)
                .filter(|it| it.to_js() == paused.get())?;
            parser.set_paused(false);
            parser.with_insertion_point(cx, |cx| execute(cx, doc, script, ready));
            queue_task(doc, [parser.to_js()], |cx, _, [parser]| {
                DocumentParser::from_js(&cx.heap, parser).map_or((), |it| it.run(cx))
            });
            Some(())
        });
        resuming.await;
    });
}

fn source_url(script: &Element) -> Option<DomString> {
    if script.kind() == Kind::Script {
        script.attr(atom!("src"))
    } else {
        svg::href(script)
    }
}

/// <https://html.spec.whatwg.org/#prepare-the-script-element>
#[optimize(size)]
pub(super) fn prepare<'a>(cx: Cx<'_, 'a>, script: &'a Element) -> Option<()> {
    let (it, doc) = (Script::of(script), script.doc());
    (!it.has_started.get()).then_some(())?;
    let (is_parser_inserted, mut source) =
        (it.is_parser_inserted.get(), script.child_text_content());
    if doc.has_page() && script.is_connected() && !is_text_of_script_trusted(script, &source) {
        let sink = if script.kind() == Kind::Script {
            "HTMLScriptElement text"
        } else {
            "SVGScriptElement text"
        };
        source = match Trusted::Script.check(cx, doc, source, sink) {
            Ok(trusted) => trusted,
            Err(error) => {
                let _ = cx.catch(error);
                return None;
            }
        };
        (!it.has_started.get()).then_some(())?;
    }
    let src = source_url(script);
    let Some(kind) =
        Type::of(script).filter(|_| script.is_connected() && (src.is_some() || !source.is_empty()))
    else {
        it.forces_async
            .update(|it| it || (is_parser_inserted && !script.has_attr(atom!("async"))));
        it.is_parser_inserted.set(false);
        return None;
    };
    it.has_started.set(true);
    let is_at_home = !is_parser_inserted || script.edge(Edge::ParserDocument) == Some(doc.to_js());
    (doc.is_fully_active() && is_at_home && doc.runs_scripts()).then_some(())?;
    (kind != Type::Classic
        || !(script.has_attr(atom!("nomodule")) || is_for_another_event(script)))
    .then_some(())?;
    let fail = || {
        fire_later(doc, script, atom!("error"));
        None
    };
    let parsed_at = is_parser_inserted.then(|| (it.position.get().0 + 1, it.position.get().1 + 1));
    (src.is_some() || source::allows_inline_script(cx, script, &source, parsed_at)).then_some(())?;
    let parser = doc.parser(&cx.heap).filter(|_| is_parser_inserted);
    let pending = |ready| Pending {
        script: Anchor::new(doc, script.to_js()),
        ready,
    };
    let url = match (src, kind) {
        (Some(_), Type::ImportMap) => return fail(),
        (None, Type::ImportMap) => {
            let base = Url::parse(doc.base_url().to_utf8().as_bytes())?;
            doc.has_realm(&cx.heap).then_some(())?;
            let add = |cx: Cx<'_, '_>| {
                modules::add_import_map(cx, &source, &base)
                    .unwrap_or_else(|it| report_error(cx, it, b""))
            };
            run_script(cx, |_| doc.in_realm(add));
            return Some(());
        }
        (None, Type::Classic) => {
            let classic = Classic::inline(
                doc,
                source,
                it.position.get(),
                Fetching {
                    integrity: None,
                    ..fetching_of(script)
                },
            );
            match parser {
                None => classic.run(cx, script),
                Some(parser)
                    if doc.loading().blocking_sheets.has_any()
                        && parser.script_nesting_level() == 0 =>
                {
                    pause_parser(
                        cx,
                        doc,
                        parser,
                        pending(Receiver::ready(Ready::Classic(classic))),
                    );
                }
                Some(parser) => parser.with_insertion_point(cx, |cx| classic.run(cx, script)),
            }
            return Some(());
        }
        (None, Type::Module) => None,
        (Some(src), _) => match Some(src)
            .filter(|it| !it.is_empty())
            .and_then(|it| doc.resolve(cx, &it))
        {
            None => return fail(),
            url => url,
        },
    };
    let pending = pending(fetch(cx, script, kind, url, &source));
    let (is_async, is_deferred) = (
        script.has_attr(atom!("async")) || it.forces_async.get(),
        kind == Type::Module || script.has_attr(atom!("defer")),
    );
    it.blocks_parser
        .set(parser.is_some() && !is_async && !is_deferred);
    block_rendering(&cx.heap, script);
    match parser.filter(|_| !is_async) {
        Some(_) if is_deferred => doc
            .loading()
            .deferred_scripts
            .borrow_mut()
            .push(hold(doc.realm(&cx.heap), pending)),
        Some(parser) => pause_parser(cx, doc, parser, pending),
        None => {
            delay_load(doc);
            let (has_run, next) = oneshot();
            let (before, anchor) = (
                (!is_async)
                    .then(|| doc.loading().last_script.replace(Some(next)))
                    .flatten(),
                Anchor::new(doc, JSValue::UNDEFINED),
            );
            spawn_for(doc, async move {
                if let Some(before) = before {
                    before.await;
                }
                pending.run().await;
                has_run.send(());
                anchor.soon(|_, doc, _| allow_load(doc)).await;
            });
        }
    }
    Some(())
}

fn prepare_unless_parsing<'a>(cx: Cx<'_, 'a>, script: &'a Element, is_move: bool) {
    if !is_move && !Script::of(script).is_parser_inserted.get() {
        prepare(cx, script);
    }
}

pub(crate) const SCRIPT_STEPS: Steps = Steps {
    cloned: Some(|_, from, to, _| {
        Script::of(to)
            .has_started
            .set(Script::of(from).has_started.get())
    }),
    post_connection: Some(prepare_unless_parsing),
    children_changed: Some(|cx, script, is_move| {
        if script.has(NodeFlags::BEING_PARSED)
            && !script
                .doc()
                .parser(&cx.heap)
                .is_some_and(DocumentParser::is_inserting)
        {
            Script::of(script).was_tampered_with.set(true);
        }
        prepare_unless_parsing(cx, script, is_move);
    }),
    finished_parsing: Some(|_, script| {
        if !Script::of(script).has_started.get() && !Script::of(script).was_tampered_with.get() {
            trust_text_of_script(script);
        }
    }),
    attribute_changed: Some(|cx, script, change| {
        if change.is(atom!("async")) {
            Script::of(script).forces_async.set(false);
        } else if change.new.is_some()
            && change.name.local.known()
                == if script.kind() == Kind::Script {
                    atom!("src")
                } else {
                    atom!("href")
                }
        {
            prepare_unless_parsing(cx, script, false);
        }
    }),
    ..Steps::NONE
};

macro_rules! is_async {
    ($($element:ty),+) => {$(
        impl $element {
            pub(crate) fn get_is_async(&self) -> bool {
                Script::of(self).forces_async.get() || self.has_attr(atom!("async"))
            }

            pub(crate) fn set_is_async<'a>(&'a self, cx: Cx<'_, 'a>, value: bool) {
                Script::of(self).forces_async.set(false);
                self.toggle_attr(cx, atom!("async"), value);
            }
        }
    )+};
}

is_async!(
    HTMLScriptElement,
    crate::generated_bindgen::svg::SVGScriptElement
);
