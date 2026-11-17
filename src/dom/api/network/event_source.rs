//! <https://html.spec.whatwg.org/#server-sent-events>

use core::time::Duration;

use bun_core::strings;
use bun_web::client::Client;
use bun_web::exec;
use bun_web::headers::digits;
use bun_web::net::NetError;
use bun_web::net::body::Body;
use bun_web::net::fetch::Controller;
use bun_web::origin::Origin;
use bun_web::request::{CacheMode, Credentials, InitiatorType};

use super::request::Options;
use super::*;
use crate::api::messaging::MessageEvent;

const CONNECTING: u16 = 0;
const OPEN: u16 = 1;
const CLOSED: u16 = 2;

#[repr(C)]
pub(crate) struct EventSource {
    pub(crate) base: EventTarget,
    url: RefCell<Url>,
    with_credentials: bool,
    state: Cell<u16>,
    controller: Controller,
}

struct Sent {
    name: Vec<u8>,
    data: Vec<u8>,
    id: Vec<u8>,
}

/// <https://html.spec.whatwg.org/#event-stream-interpretation>
struct Parser {
    last_id: Vec<u8>,
    retry: Duration,
    id: Vec<u8>,
    name: Vec<u8>,
    data: Vec<u8>,
    line: Vec<u8>,
    is_first_line: bool,
    is_after_return: bool,
}

const MAX_EVENT: usize = 256 << 20;

impl Parser {
    fn restart(&mut self) {
        self.id.clone_from(&self.last_id);
        [&mut self.name, &mut self.data, &mut self.line]
            .into_iter()
            .for_each(Vec::clear);
        (self.is_first_line, self.is_after_return) = (true, false);
    }

    #[optimize(size)]
    fn take_line(&mut self, line: &[u8]) -> Option<Sent> {
        let line = line
            .strip_prefix(b"\xEF\xBB\xBF")
            .filter(|_| self.is_first_line)
            .unwrap_or(line);
        self.is_first_line = false;
        if line.is_empty() {
            self.last_id.clone_from(&self.id);
            let (name, mut data) = (
                core::mem::take(&mut self.name),
                core::mem::take(&mut self.data),
            );
            return data.pop().map(|_| Sent {
                name,
                data,
                id: self.id.clone(),
            });
        }
        let (field, value) = strings::split_once_char(line, b':').unwrap_or((line, b""));
        let value = value.strip_prefix(b" ").unwrap_or(value);
        match field {
            b"data" => self.data.extend(value.iter().chain(b"\n")),
            b"event" => self.name = value.to_vec(),
            b"id" if !strings::contains_char(value, 0) => self.id = value.to_vec(),
            b"retry" => self.retry = digits(value).map_or(self.retry, Duration::from_millis),
            _ => {}
        }
        None
    }

    #[optimize(size)]
    fn feed(&mut self, mut bytes: &[u8], mut each: impl FnMut(Sent)) {
        if core::mem::take(&mut self.is_after_return) {
            bytes = bytes.strip_prefix(b"\n").unwrap_or(bytes);
        }
        while let Some(end) = strings::index_of_any(bytes, b"\r\n") {
            let mut line = core::mem::take(&mut self.line);
            let sent = if line.is_empty() {
                self.take_line(&bytes[..end])
            } else {
                line.extend_from_slice(&bytes[..end]);
                self.take_line(&line)
            };
            sent.map(&mut each);
            self.is_after_return = bytes[end..] == *b"\r";
            bytes = &bytes[end
                + if bytes[end..].starts_with(b"\r\n") {
                    2
                } else {
                    1
                }..];
        }
        self.line.extend_from_slice(bytes);
    }
}

#[optimize(size)]
fn is_transient(error: NetError) -> bool {
    use NetError::*;
    matches!(
        error,
        ConnectionClosed
            | ConnectionReset
            | ConnectionRefused
            | NameNotResolved
            | InternetDisconnected
            | TimedOut
            | ProxyConnectionFailed
            | NetworkChanged
            | NetworkIoSuspended
    )
}

struct Running(Kept);

impl Running {
    /// `None` if it is closed.
    #[optimize(size)]
    async fn step(
        &self,
        steps: impl for<'a> FnOnce(Cx<'_, 'a>, &'a EventSource) + 'static,
    ) -> Option<()> {
        let goes_on = self.0.in_task(|cx, this| {
            let this = EventSource::from_js(&cx.heap, this.to_js())
                .filter(|it| it.state.get() != CLOSED)?;
            steps(cx, this);
            (this.state.get() != CLOSED).then_some(())
        });
        goes_on.await?
    }

    #[optimize(size)]
    async fn announce(&self, state: u16, name: Known) -> Option<()> {
        self.step(move |cx, this| {
            this.state.set(state);
            fire(cx, this, name, EventInit::default());
        })
        .await
    }

    #[optimize(size)]
    async fn read(&self, mut body: Body, parser: &mut Parser, origin: Origin) {
        let text = |it: &[u8]| DomString::from_utf8(&bstr::ByteSlice::to_str_lossy(it));
        let origin = text(origin.as_bytes());
        parser.restart();
        while let Ok(Some(chunk)) = body.read().await {
            parser.feed(&chunk, |Sent { name, data, id }| {
                let origin = origin.clone();
                self.0.queue_task(move |cx, this| {
                    let Some(this) = EventSource::from_js(&cx.heap, this.to_js())
                        .filter(|it| it.state.get() != CLOSED)
                    else {
                        return;
                    };
                    let name = if name.is_empty() {
                        atom!("message").into()
                    } else {
                        Atom::from_string(&text(&name))
                    };
                    let event = MessageEvent::new(
                        &cx.heap,
                        name,
                        text(&data).to_js(&cx.heap).to_js(),
                        origin,
                        text(&id),
                    );
                    dispatch(cx, this, event);
                });
            });
            if parser.data.len() + parser.line.len() > MAX_EVENT {
                break;
            }
        }
    }

    #[optimize(size)]
    async fn run(
        &self,
        client: Rc<Client>,
        mut options: Options,
        controller: Controller,
    ) -> Option<core::convert::Infallible> {
        let empty = Vec::new;
        let mut parser = Parser {
            last_id: empty(),
            retry: Duration::from_secs(3),
            id: empty(),
            name: empty(),
            data: empty(),
            line: empty(),
            is_first_line: true,
            is_after_return: false,
        };
        loop {
            let mut request =
                options
                    .clone()
                    .into_request(&client, HeaderList::default(), InitiatorType::Other);
            request.cors_exempt_headers = [
                ("Accept", "text/event-stream"),
                ("Cache-Control", "no-cache"),
            ]
            .into_iter()
            .collect();
            request.cors_exempt_headers.set_if_absent(
                b"Last-Event-ID",
                bstr::ByteSlice::to_str_lossy(&*parser.last_id).as_bytes(),
            );
            match client.fetch(request, &controller).await {
                Ok(fetched)
                    if fetched.head.status == 200
                        && fetched
                            .head
                            .headers
                            .mime()
                            .is_some_and(|it| it.essence() == b"text/event-stream") =>
                {
                    options.url = fetched.head.url;
                    let url = options.url.clone();
                    self.step(|cx, this| {
                        this.url.replace(url);
                        this.state.set(OPEN);
                        fire(cx, this, atom!("open"), EventInit::default());
                    })
                    .await?;
                    self.read(
                        fetched.body.unwrap_or_default(),
                        &mut parser,
                        Origin::of(&options.url),
                    )
                    .await;
                }
                Err(error) if is_transient(error) => {}
                _ => self.announce(CLOSED, atom!("error")).await?,
            }
            self.announce(CONNECTING, atom!("error")).await?;
            exec::race(exec::sleep(parser.retry), controller.aborted()).await;
        }
    }
}

impl EventSource {
    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        url: &DomString,
        init: &EventSourceInit,
    ) -> Result<'a, &'a Self> {
        let parsed = parse_url_in_encoding(&cx.heap, url);
        let url = parsed.ok_or_else(|| {
            cx.heap.dom_exception(
                DomError::SyntaxError,
                format_args!(
                    "Cannot open an EventSource to '{}'. The URL is invalid.",
                    url.to_utf8()
                ),
            )
        })?;
        let (mut options, controller) = (Options::new(url.clone()), Controller::default());
        options.credentials = if init.with_credentials {
            Credentials::Include
        } else {
            Credentials::SameOrigin
        };
        options.cache = CacheMode::NoStore;
        let (with_credentials, state) = (init.with_credentials, Cell::new(CONNECTING));
        let this = structure.create(
            &cx.heap,
            EventSource {
                base: Default::default(),
                url: url.into(),
                with_credentials,
                state,
                controller: controller.clone(),
            },
        );
        if let Some(client) = client_of(&cx.heap) {
            let running = Running(Kept::new(cx, this.to_js()));
            spawn(&cx.heap, async move {
                running.run(client, options, controller).await;
            });
        }
        Ok(this)
    }

    pub(crate) fn get_url<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(self.url.borrow().href())
    }

    pub(crate) fn get_with_credentials(&self) -> bool {
        self.with_credentials
    }

    pub(crate) fn get_ready_state(&self) -> u16 {
        self.state.get()
    }

    pub(crate) fn close(&self) {
        self.state.set(CLOSED);
        self.controller.abort();
    }
}
