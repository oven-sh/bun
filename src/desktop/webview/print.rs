//! The web engine lays documents out on pages, and has no window to ask about printers in.

use std::collections::BTreeMap;
use std::rc::Rc;

use bun_ui::protocol::{PrintJob, Reply, Request, SystemRequest};
use bun_web::convert::resolve_blob_url;
use bun_web::net::body::Blob;
use bun_web::page::{Purpose, Snapshot, printed_from};
use bun_web::request::Destination;
use bun_web::url::Url;

use super::embedder::Embedder;
use super::engine::{self, Target};
use super::remote::Remote;
use crate::contents::page::Page;
use crate::contents::{Contents, Kind};
use crate::prelude::*;
use crate::session::download::{DownloadItem, is_reserved};
use crate::session::{self, Session};
use crate::text::{before, escape, escape_html, replace, split_once};
use crate::value::Value;
use crate::window::Window;
use crate::{app, realm, task};

/// With a number before it, it stands for the origin of a document.
const HOME: &str = ".print.invalid";
const BLOB: &str = "https://print.invalid/.blob/";
const POLICY: &str = "default-src 'none'; img-src * data:; font-src * data:; style-src * 'unsafe-inline'; base-uri *; frame-src https://*.page.print.invalid";

const MILLISECONDS_FOR_RESOURCE: u64 = 3000;
const MILLISECONDS_FOR_ALL: u64 = 60_000;

struct Duplicate {
    /// The document, and those in its frames.
    pages: Vec<Root<Page>>,
    markup: BTreeMap<String, String>,
    /// With the URL, and which of the pages has it.
    blobs: Vec<(Option<Blob>, String, usize)>,
    /// Which of the pages a document or a style sheet is for.
    referrers: Rc<RefCell<BTreeMap<String, usize>>>,
}

impl Duplicate {
    fn new(page: &Page, snapshot: Snapshot) -> JsResult<Duplicate> {
        let mut this = Duplicate {
            pages: page.with_descendants()?,
            markup: BTreeMap::new(),
            blobs: Vec::new(),
            referrers: Rc::default(),
        };
        for (id, markup) in [(page.id(), snapshot.markup)]
            .into_iter()
            .chain(snapshot.frames)
        {
            if let Some(index) = this.pages.iter().position(|it| it.get().id() == id) {
                let (url, copy) = (printed_from(id), this.copy(&markup, index));
                this.referrers.borrow_mut().insert(url.clone(), index);
                this.markup.insert(url, copy);
            }
        }
        Ok(this)
    }

    fn url(&self) -> String {
        printed_from(self.pages[0].get().id())
    }

    fn copy(&mut self, mut markup: &str, index: usize) -> String {
        let (mut copy, is_here) = (
            String::new(),
            !self.pages[index].get().is_in_other_process(),
        );
        while let Some((before, after)) = split_once(markup, "blob:") {
            let is_part = |it: &u8| !it.is_ascii_whitespace() && !b"\"'()<>&".contains(it);
            let (rest_of_url, rest) = after.split_at(after.bytes().take_while(is_part).count());
            copy += &format!("{before}{BLOB}{}", self.blobs.len());
            let url = format!("blob:{rest_of_url}");
            let parsed = Url::parse(url.as_bytes()).filter(|_| is_here);
            let blob = parsed.and_then(|it| resolve_blob_url(&it));
            self.blobs.push((blob, url, index));
            markup = rest;
        }
        copy += markup;
        for (index, page) in self.pages.iter().enumerate() {
            let origin = page.get().origin_of_base();
            copy = replace(
                &copy,
                &format!("{origin}/"),
                &format!("https://{index}{HOME}/"),
            );
        }
        copy
    }

    fn answer(&self, request: JSValue) -> JsResult<JSValue> {
        let respond =
            |body, headers| realm::construct("Response", &[body, object!({ "headers": headers })]);
        let url = text_of(get(request, "url")?)?;
        if let Some(markup) = self.markup.get(&url) {
            return respond(
                js(&**markup)?,
                object!({
                    "content-type": "text/html; charset=utf-8",
                    "content-security-policy": POLICY,
                    "referrer-policy": "unsafe-url",
                }),
            );
        }
        let header = |name: &str| invoke(get(request, "headers")?, "get", &[js(name)?]);
        let referrer = match header("referer")? {
            it if it.is_string() => text_of(it)?,
            _ => text_of(get(request, "referrer")?)?,
        };
        let page = self.referrers.borrow().get(&referrer).copied();
        if let Some(index) = url.strip_prefix(BLOB) {
            let found = (index.parse().ok()).and_then(|it: usize| self.blobs.get(it));
            let found = found.filter(|it| Some(it.2) == page);
            if let Some((_, url, page)) = found
                && self.pages[*page].get().is_in_other_process()
            {
                let fetched = self.pages[*page].get().fetch(url, Destination::Image)?;
                return Ok(task::promise(async move {
                    let fetched = fetched.await;
                    let bytes = fetched.as_ref().map_or(&[][..], |it| &it.bytes);
                    realm::construct("Response", &[buffer(bytes)?])
                }));
            }
            let blob = found.and_then(|it| it.0.clone());
            return Ok(task::promise(async move {
                let bytes = match blob {
                    Some(blob) => blob
                        .data
                        .open()
                        .read_to_end()
                        .await
                        .map(|it| it.into_vec())
                        .unwrap_or_default(),
                    None => Vec::new(),
                };
                realm::construct("Response", &[buffer(&bytes)?])
            }));
        }
        let failed = || error(format_args!("net::ERR_FAILED"));
        let Some(page) = page.filter(|_| !self.markup.keys().any(|it| url.starts_with(it))) else {
            return Ok(task::promise(async move { Err::<JSValue, _>(failed()) }));
        };
        let at_home = (url.strip_prefix("https://"))
            .and_then(|it| split_once(it, &format!("{HOME}/")))
            .and_then(|(index, path)| Some((self.pages.get(index.parse::<usize>().ok()?)?, path)))
            .map(|(page, path)| format!("{}/{path}", page.get().origin_of_base()));
        let accepts = text_of(header("accept")?)?;
        let destination = match () {
            () if accepts.starts_with("text/css") => Destination::Style,
            () if accepts.starts_with("image/") => Destination::Image,
            () => Destination::Font,
        };
        let fetched =
            (self.pages[page].get()).fetch(at_home.as_ref().unwrap_or(&url), destination)?;
        let referrers = Rc::clone(&self.referrers);
        Ok(task::promise(async move {
            let fetched = task::within(MILLISECONDS_FOR_RESOURCE, fetched).await;
            let fetched = fetched.flatten().ok_or_else(failed)?;
            if destination == Destination::Style {
                let url = before(&url, "#").to_owned();
                referrers.borrow_mut().entry(url).or_insert(page);
            }
            let headers = object!({
                "content-type": fetched.essence(),
                "access-control-allow-origin": "*",
                "referrer-policy": "unsafe-url",
            });
            respond(buffer(&fetched.bytes)?, headers)
        }))
    }
}

/// From the options of `print()` to those of `printToPDF()`.
fn layout(options: &Value) -> JsResult<Value> {
    const USE_LETTER: [&str; 14] = [
        "BZ", "CA", "CL", "CO", "CR", "GT", "MX", "NI", "PA", "PH", "PR", "SV", "US", "VE",
    ];
    let (size, margins) = (&options["pageSize"], &options["margins"]);
    let in_inches = |it: &Value, names: &[&str], per_inch: f64| {
        let convert = |name: &&str| ((*name).into(), (it[*name].number() / per_inch).into());
        Value::Record(names.iter().map(convert).collect())
    };
    let sides = ["top", "bottom", "left", "right"];
    let range = |it: &Value| format!("{}-{}", it["from"].int() + 1, it["to"].int() + 1);
    let ranges: Vec<String> = options["pageRanges"].items().iter().map(range).collect();
    let template = |name: &str| {
        let text = escape_html(options[name].text());
        format!("<span style='font-size:9px;margin:0 1cm'>{text}</span>")
    };
    Ok(options
        .pick(&["landscape", "printBackground"])
        .and(&record! {
            "preferCSSPageSize": size.is_nothing(),
            "pageSize": match size {
                Value::Record(_) => in_inches(size, &["width", "height"], 25400.),
                named if named.is_truthy() => named.clone(),
                _ if USE_LETTER.contains(&&*app::country()?) => "Letter".into(),
                _ => "A4".into(),
            },
            "margins": match margins["marginType"].text() {
                "none" | "printableArea" => in_inches(&Value::Undefined, &sides, 1.),
                "custom" => in_inches(margins, &sides, 96.),
                _ => Value::empty(),
            },
            "scale": options["scaleFactor"].as_number().map_or(1., |it| it / 100.),
            "pageRanges": ranges.join(","),
            "displayHeaderFooter": options["header"].is_truthy() || options["footer"].is_truthy(),
            "headerTemplate": template("header"),
            "footerTemplate": template("footer"),
        }))
}

/// From the options of `printToPDF()` to those of `Page.printToPDF`.
pub(crate) fn for_protocol(options: &Value) -> Result<Value, String> {
    const SIZES: [(&str, [f64; 2]); 11] = [
        ("letter", [8.5, 11.]),
        ("legal", [8.5, 14.]),
        ("tabloid", [11., 17.]),
        ("ledger", [17., 11.]),
        ("a0", [33.1, 46.8]),
        ("a1", [23.4, 33.1]),
        ("a2", [16.54, 23.4]),
        ("a3", [11.7, 16.54]),
        ("a4", [8.27, 11.7]),
        ("a5", [5.83, 8.27]),
        ("a6", [4.13, 5.83]),
    ];
    let checked = |given: &Value, otherwise: Value, name: &str| {
        let kind = match (given, &otherwise) {
            _ if given.is_nothing() => return Ok(otherwise),
            (Value::Bool(_), Value::Bool(_))
            | (Value::Number(_), Value::Number(_))
            | (Value::Text(_), Value::Text(_))
            | (Value::Record(_), Value::Record(_)) => return Ok(given.clone()),
            (_, Value::Bool(_)) => "boolean",
            (_, Value::Number(_)) => "number",
            (_, Value::Text(_)) => "string",
            _ => "object",
        };
        Err(format!("{name} must be a {kind}"))
    };
    if !options.is_object() {
        return Err("options must be an object".to_owned());
    }
    let margins = checked(&options["margins"], Value::empty(), "margins")?;
    let [width, height] = match &options["pageSize"] {
        Value::Text(name) => {
            let found = SIZES.iter().find(|it| it.0.eq_ignore_ascii_case(name));
            found.ok_or_else(|| format!("Invalid pageSize {name}"))?.1
        }
        size @ Value::Record(_) => match [size["width"].as_number(), size["height"].as_number()] {
            [Some(width), Some(height)] => [width, height],
            _ => return Err("width and height properties are required for pageSize".to_owned()),
        },
        size if size.is_nothing() => SIZES[0].1,
        _ => return Err("pageSize must be a string or an object".to_owned()),
    };
    let mut all = record! { "paperWidth": width, "paperHeight": height };
    for (side, name, most) in [
        ("top", "marginTop", height),
        ("bottom", "marginBottom", height),
        ("left", "marginLeft", width),
        ("right", "marginRight", width),
    ] {
        if margins[side].number() > most {
            return Err("margins must be less than or equal to pageSize".to_owned());
        }
        let margin = checked(&margins[side], 0.4.into(), &format!("margins.{side}"))?;
        all.set(name, margin);
    }
    for (name, otherwise) in [
        ("landscape", Value::from(false)),
        ("displayHeaderFooter", false.into()),
        ("headerTemplate", "".into()),
        ("footerTemplate", "".into()),
        ("printBackground", false.into()),
        ("scale", 1.0.into()),
        ("pageRanges", "".into()),
        ("preferCSSPageSize", false.into()),
        ("generateTaggedPDF", false.into()),
        ("generateDocumentOutline", false.into()),
    ] {
        all.set(name, checked(&options[name], otherwise, name)?);
    }
    Ok(all)
}

/// Why nothing was printed.
type Printed = Result<(), &'static str>;

const FAILED: Printed = Err("Print job failed");

struct Pages {
    pdf: Vec<u8>,
    title: String,
    url: String,
}

impl Pages {
    /// They are downloaded where the system cannot print.
    async fn print(
        self,
        contents: JSValue,
        window: Option<&Window>,
        options: &Value,
    ) -> JsResult<Printed> {
        let title = escape(&self.title, |it| is_reserved(it).then_some(" "));
        let title = Some(title.trim()).filter(|it| !it.is_empty());
        let (title, contents) = (title.unwrap_or("Untitled"), keep(contents));
        let job = PrintJob {
            window: window.map(Window::get_id).into(),
            title: title.into(),
            pdf: self.pdf.clone().into(),
            printer: options["deviceName"].text().into(),
            copies: options["copies"].int().max(1) as u32,
            is_silent: options["silent"].is_truthy(),
        };
        let (sender, reply) = task::oneshot();
        let request = Request::System(SystemRequest::Print(job));
        bun_ui::queue::request(global(), request, |_, it| {
            sender.send(it);
            Ok(())
        })?;
        if let Some(Reply::Agreed(is_printed)) = reply.await {
            return Ok(is_printed.then_some(()).ok_or("Print job canceled"));
        }
        if options["deviceName"].is_truthy() {
            return Ok(Err("Invalid deviceName provided"));
        }
        let (session, name) = (Session::of(contents.get())?, format!("{title}.pdf"));
        DownloadItem::save_pdf(session, self.url, self.pdf, contents.get(), &name)?.await;
        Ok(Ok(()))
    }
}

async fn wait(result: JsResult<JSValue>) -> JsResult<bun_jsc::Strong> {
    task::outcome(result).await.map_err(|it| task::throw(&it))
}

async fn lay_out(duplicate: Duplicate, options: &Value) -> JsResult<Vec<u8>> {
    let url = duplicate.url();
    let session = Root::new(session::from_partition("print")?);
    let answer = function(JSValue::UNDEFINED, move |_, given| {
        duplicate.answer(argument(given, 0))
    })?;
    ["http", "https"]
        .into_iter()
        .try_for_each(|it| session.get().handle_scheme(it, Some(answer)))?;
    let contents = keep(
        Contents::create(
            object!({ "session": session.get().to_js(), "javascript": false }),
            Kind::Print,
        )?
        .to_js(),
    );
    let print = async {
        wait(invoke(contents.get(), "loadURL", &[js(&*url)?])).await?;
        wait(invoke(contents.get(), "printToPDF", &[js(options)?])).await
    };
    let pdf = (task::within(MILLISECONDS_FOR_ALL, print).await)
        .unwrap_or_else(|| Err(error(format_args!("It takes too long"))));
    let pdf = catch(pdf)?.map_err(keep);
    invoke(contents.get(), "destroy", &[])?;
    ["http", "https"]
        .into_iter()
        .try_for_each(|it| session.get().handle_scheme(it, None))?;
    let pdf = pdf.map_err(|it| task::throw(&it))?;
    Ok((pdf.get().as_array_buffer(global()))
        .map(|it| it.byte_slice().to_vec())
        .unwrap_or_default())
}

/// One after the other.
async fn lay_out_in_turn(duplicate: Duplicate, options: Value) -> JsResult<Vec<u8>> {
    state!(fn turns() -> task::Sequence);
    let (sender, result) = task::oneshot();
    turns().add(async move {
        match catch(lay_out(duplicate, &options).await) {
            Ok(result) => sender.send(result.map_err(keep)),
            Err(error) => task::report(Err(error)),
        }
    });
    let result = (result.await).ok_or_else(|| error(format_args!("Printing failed")))?;
    result.map_err(|it| task::throw(&it))
}

async fn print_duplicate(
    page: &Root<Page>,
    duplicate: Duplicate,
    options: &Value,
) -> JsResult<Printed> {
    let pdf = lay_out_in_turn(duplicate, layout(options)?).await?;
    let owner = page.get().web_contents()?;
    let pages = Pages {
        pdf,
        title: text_of(invoke(owner, "getTitle", &[])?)?,
        url: page.get().url(),
    };
    let window = cast::<Contents>(owner).and_then(Contents::window);
    pages.print(owner, window, options).await
}

state!(fn is_printing() -> Cell<bool>);

fn tell(done: JSValue, result: Printed) -> JsResult<()> {
    match done.is_callable() {
        true => call(
            done,
            &[result.is_ok().into(), js(result.err().unwrap_or_default())?],
        )
        .map(drop),
        false => Ok(()),
    }
}

fn tell_after(done: JSValue, print: impl Future<Output = JsResult<Printed>> + 'static) {
    let done = keep(done);
    task::spawn(async move {
        let result = catch(print.await);
        is_printing().set(false);
        task::report(result.and_then(|it| tell(done.get(), it.unwrap_or(FAILED))));
    });
}

/// Of what the web engine shows. `done` is told whether it was printed.
pub(crate) fn print_remote(
    remote: &Remote,
    frame: Option<i32>,
    options: Value,
    done: JSValue,
) -> JsResult<()> {
    let layout = list![layout(&options)?];
    if is_printing().replace(true) {
        return tell(done, FAILED);
    }
    let pdf = match frame {
        Some(frame) => (remote.engine()).perform(Target::Object(frame), "printToPDF", layout),
        None => remote.ask("printToPDF", layout),
    };
    let remote = Root::new(remote);
    tell_after(done, async move {
        let pdf = (task::within(MILLISECONDS_FOR_ALL, pdf).await)
            .ok_or_else(|| error(format_args!("It takes too long")))?
            .map_err(|it| it.throw())?;
        let pages = Pages {
            pdf: pdf.as_bytes().map(|it| it.to_vec()).unwrap_or_default(),
            title: remote.get().mirrored("title").text().to_owned(),
            url: remote.get().mirrored("url").text().to_owned(),
        };
        let (contents, window) = (remote.get().contents(), remote.get().window());
        pages.print(contents, window, &options).await
    });
    Ok(())
}

fn printing_changed(page: &Page, is_over: bool) -> JsResult<()> {
    (page.with_descendants()?.iter())
        .try_for_each(|it| it.get().tell(|it| it.printing_changed(is_over)))
}

async fn duplicate(page: &Page) -> JsResult<Duplicate> {
    printing_changed(page, false)?;
    match catch(page.snapshot(Purpose::Print).await)? {
        Ok(snapshot) => Duplicate::new(page, snapshot),
        Err(thrown) => {
            let thrown = keep(thrown);
            printing_changed(page, true)?;
            Err(task::throw(&thrown))
        }
    }
}

/// For the app.
pub(crate) fn print_page(page: &Page, options: Value, done: JSValue) -> JsResult<()> {
    if !engine::is_available()? {
        return tell(done, Err("Printing needs a web engine"));
    }
    if is_printing().replace(true) {
        return tell(done, FAILED);
    }
    let page = Root::new(page);
    tell_after(done, async move {
        let duplicate = duplicate(page.get()).await?;
        let result = catch(print_duplicate(&page, duplicate, &options).await)?;
        printing_changed(page.get(), true).map(|()| result.unwrap_or(FAILED))
    });
    Ok(())
}

pub(crate) fn print_to_pdf(page: &Page, options: Value) -> JsResult<JSValue> {
    for_protocol(&options).map_err(|it| error(format_args!("{it}")))?;
    if !engine::is_available()? {
        return Err(error(format_args!("Printing needs a web engine")));
    }
    let page = Root::new(page);
    Ok(task::promise(async move {
        let duplicate = duplicate(page.get()).await?;
        let pdf = catch(lay_out_in_turn(duplicate, options).await)?.map_err(keep);
        printing_changed(page.get(), true)?;
        buffer(&pdf.map_err(|it| task::throw(&it))?)
    }))
}

/// For the page.
pub(crate) fn print(page: &Page, markup: Option<String>) -> JsResult<JSValue> {
    let given = markup.map(|markup| Snapshot {
        markup,
        ..Snapshot::default()
    });
    if !engine::is_available()? || is_printing().replace(true) {
        return resolved(JSValue::UNDEFINED);
    }
    let page = Root::new(page);
    Ok(task::promise(async move {
        let print = async {
            let snapshot = match given {
                Some(given) => given,
                None => page.get().snapshot(Purpose::Print).await?,
            };
            let options = record! { "printBackground": true };
            print_duplicate(&page, Duplicate::new(page.get(), snapshot)?, &options).await
        };
        let result = catch(print.await);
        is_printing().set(false);
        if let Err(thrown) = result? {
            let message = format!("Failed to print: {}", message_of(thrown)?);
            Embedder::log_error(page.get(), &message)?;
        }
        Ok(JSValue::UNDEFINED)
    }))
}
