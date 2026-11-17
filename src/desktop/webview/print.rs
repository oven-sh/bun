//! The web engine lays documents out on pages, and has no window to ask about printers in.

use std::rc::Rc;

use bun_ui::protocol::{PrintJob, Reply, Request, SystemRequest};
use bun_web::convert::resolve_blob_url;
use bun_web::net::body::Blob;
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
use crate::text::{escape, escape_html, origin_of, replace, split_once};
use crate::value::Value;
use crate::window::Window;
use crate::{app, realm, task};

/// Stands for the origin of the document.
const HOME: &str = "https://print.invalid";
const DOCUMENT: &str = "https://print.invalid/.document";
const BLOB: &str = "https://print.invalid/.blob/";
const POLICY: &str = "default-src 'none'; img-src * data:; font-src * data:; style-src * 'unsafe-inline'; base-uri *";

struct Duplicate {
    markup: String,
    origin: String,
    blobs: Vec<Option<Blob>>,
}

impl Duplicate {
    fn new(base_url: &str, mut markup: &str) -> Duplicate {
        let (origin, mut blobs) = (origin_of(base_url), Vec::new());
        let mut copy = format!(
            "<!doctype html><meta charset=utf-8><base href=\"{}\">",
            escape_html(base_url)
        );
        while let Some((before, after)) = split_once(markup, "blob:") {
            let is_part = |it: &u8| !it.is_ascii_whitespace() && !b"\"'()<>".contains(it);
            let (rest_of_url, rest) = after.split_at(after.bytes().take_while(is_part).count());
            copy += &format!("{before}{BLOB}{}", blobs.len());
            blobs.push(
                Url::parse(format!("blob:{rest_of_url}").as_bytes())
                    .and_then(|it| resolve_blob_url(&it)),
            );
            markup = rest;
        }
        Duplicate {
            markup: replace(&(copy + markup), &format!("{origin}/"), &format!("{HOME}/")),
            origin,
            blobs,
        }
    }

    fn answer(&self, page: &Page, request: JSValue) -> JsResult<JSValue> {
        let respond =
            |body, headers| realm::construct("Response", &[body, object!({ "headers": headers })]);
        let url = text_of(get(request, "url")?)?;
        if url == DOCUMENT {
            return respond(
                js(&*self.markup)?,
                object!({ "content-type": "text/html", "content-security-policy": POLICY }),
            );
        }
        if let Some(index) = url.strip_prefix(BLOB) {
            let blob = index
                .parse()
                .ok()
                .and_then(|it: usize| self.blobs.get(it)?.clone());
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
        let url = url
            .strip_prefix(HOME)
            .filter(|it| it.starts_with('/'))
            .map_or_else(|| url.clone(), |it| self.origin.clone() + it);
        let accepts = text_of(invoke(get(request, "headers")?, "get", &[js("accept")?])?)?;
        let destination = match () {
            () if accepts.starts_with("text/css") => Destination::Style,
            () if accepts.starts_with("image/") => Destination::Image,
            () => Destination::Font,
        };
        let fetched = page.fetch(&url, destination)?;
        Ok(task::promise(async move {
            let fetched = (fetched.await).ok_or_else(|| error(format_args!("net::ERR_FAILED")))?;
            let headers =
                object!({ "content-type": fetched.essence(), "access-control-allow-origin": "*" });
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
    ) -> JsResult<bool> {
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
            return Ok(is_printed);
        }
        let (session, name) = (Session::of(contents.get())?, format!("{title}.pdf"));
        DownloadItem::save_pdf(session, self.url, self.pdf, contents.get(), &name)?.await;
        Ok(true)
    }
}

async fn wait(result: JsResult<JSValue>) -> JsResult<bun_jsc::Strong> {
    task::outcome(result).await.map_err(|it| task::throw(&it))
}

async fn print_duplicate(page: &Root<Page>, duplicate: Duplicate) -> JsResult<()> {
    let (session, duplicate) = (
        Root::new(session::from_partition("print")?),
        Rc::new(duplicate),
    );
    let answer = function(page.get().to_js(), move |page, given| {
        duplicate.answer(
            cast(page).expect("it is what was passed"),
            argument(given, 0),
        )
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
        wait(invoke(contents.get(), "loadURL", &[js(DOCUMENT)?])).await?;
        let options = js(&layout(&record! { "printBackground": true })?)?;
        wait(invoke(contents.get(), "printToPDF", &[options])).await
    };
    let pdf = catch(print.await)?.map_err(keep);
    invoke(contents.get(), "destroy", &[])?;
    ["http", "https"]
        .into_iter()
        .try_for_each(|it| session.get().handle_scheme(it, None))?;
    let pdf = pdf.map_err(|it| task::throw(&it))?;
    let owner = page.get().web_contents()?;
    let pages = Pages {
        pdf: (pdf.get().as_array_buffer(global()))
            .map(|it| it.byte_slice().to_vec())
            .unwrap_or_default(),
        title: text_of(invoke(owner, "getTitle", &[])?)?,
        url: page.get().url(),
    };
    let window = cast::<Contents>(owner).and_then(Contents::window);
    (pages.print(owner, window, &Value::Undefined).await).map(drop)
}

state!(fn is_printing() -> Cell<bool>);

/// Of what the web engine shows. `done` is told whether it was printed.
pub(crate) fn print_remote(
    remote: &Remote,
    frame: Option<i32>,
    options: Value,
    done: JSValue,
) -> JsResult<()> {
    let tell = |done: JSValue, result: Result<bool, ()>| {
        let reason = result.map_or("Print job failed", |it| {
            if it { "" } else { "Print job canceled" }
        });
        match done.is_callable() {
            true => call(done, &[(result == Ok(true)).into(), js(reason)?]).map(drop),
            false => Ok(()),
        }
    };
    if is_printing().replace(true) {
        return tell(done, Err(()));
    }
    let layout = list![layout(&options)?];
    let pdf = match frame {
        Some(frame) => (remote.engine()).perform(Target::Object(frame), "printToPDF", layout),
        None => remote.ask("printToPDF", layout),
    };
    let (remote, done) = (Root::new(remote), keep(done));
    task::spawn(async move {
        let print = async {
            let pdf = (task::within(60_000, pdf).await)
                .ok_or_else(|| error(format_args!("It takes too long")))?
                .map_err(|it| it.throw())?;
            let pages = Pages {
                pdf: pdf.as_bytes().map(|it| it.to_vec()).unwrap_or_default(),
                title: remote.get().mirrored("title").text().to_owned(),
                url: remote.get().mirrored("url").text().to_owned(),
            };
            let (contents, window) = (remote.get().contents(), remote.get().window());
            pages.print(contents, window, &options).await
        };
        let result = catch(print.await);
        is_printing().set(false);
        task::report(result.and_then(|it| tell(done.get(), it.map_err(drop))));
    });
    Ok(())
}

pub(crate) fn print(page: &Page, base_url: &str, markup: &str) -> JsResult<JSValue> {
    if !engine::is_available()? || is_printing().replace(true) {
        return resolved(JSValue::UNDEFINED);
    }
    let (page, duplicate) = (Root::new(page), Duplicate::new(base_url, markup));
    Ok(task::promise(async move {
        let result = catch(print_duplicate(&page, duplicate).await);
        is_printing().set(false);
        if let Err(thrown) = result? {
            let message = format!("Failed to print: {}", message_of(thrown)?);
            Embedder::log_error(page.get(), &message)?;
        }
        Ok(JSValue::UNDEFINED)
    }))
}
