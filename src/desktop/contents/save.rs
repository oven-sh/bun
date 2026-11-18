//! `savePage()`

use std::collections::BTreeSet;

use bun_web::client::Resource;
use bun_web::page::{self, Purpose};
use bun_web::request::Destination;

use super::page::Page;
use crate::prelude::*;
use crate::text::{base64, before, encode_path, random_uuid, split, split_once};
use crate::{files, task};

/// That style sheets refer to.
const MOST_INDIRECT: usize = 2000;

struct Wanted {
    by: Root<Page>,
    url: String,
    destination: Destination,
    name: String,
}

async fn snapshot(page: &Page, purpose: Purpose) -> JsResult<(String, Vec<Wanted>)> {
    let (snapshot, pages) = (page.snapshot(purpose).await?, page.with_descendants()?);
    let wanted = |it: page::Resource| {
        Some(Wanted {
            by: Root::new(pages.iter().find(|by| by.get().id == it.page)?.get()),
            destination: Destination::parse(it.destination.as_bytes())
                .unwrap_or(Destination::Image),
            name: files::name(&it.name).to_owned(),
            url: it.url,
        })
    };
    let wanted = snapshot.resources.into_iter().filter_map(wanted);
    Ok((snapshot.markup, wanted.collect()))
}

fn referred_to_by(sheet: &Resource) -> Vec<String> {
    let text = string(&sheet.bytes);
    let urls = (split(&text, "url(").skip(1))
        .map(|it| before(it, ")").trim().trim_matches(['"', '\'']))
        .filter_map(|it| sheet.url.join(it.as_bytes()));
    urls.filter(|it| it.scheme() != b"data")
        .map(|it| string(it.href()))
        .collect()
}

fn write(path: &str, contents: &[u8]) -> JsResult<()> {
    files::or_throw(files::write(path, contents, 0o666))
}

async fn save_archive(page: &Root<Page>, path: &str) -> JsResult<()> {
    let (markup, mut wanted) = snapshot(page.get(), Purpose::Archive).await?;
    let (boundary, url) = (
        format!("----MultipartBoundary--{}----", random_uuid()),
        page.get().url(),
    );
    let mut archive = format!(
        "From: <Saved by Blink>\r\nSnapshot-Content-Location: {url}\r\nSubject: =?utf-8?B?{}?=\r\nMIME-Version: 1.0\r\n\
         Content-Type: multipart/related;\r\n\ttype=\"text/html\";\r\n\tboundary=\"{boundary}\"\r\n\r\n",
        base64(page.get().title().as_bytes())
    );
    let mut add = |kind: &str, url: &str, bytes: &[u8]| {
        archive += &format!(
            "\r\n--{boundary}\r\nContent-Type: {kind}\r\nContent-Transfer-Encoding: base64\r\nContent-Location: {url}\r\n\r\n"
        );
        for line in bytes.chunks(57) {
            archive += &base64(line);
            archive += "\r\n";
        }
    };
    add("text/html", &url, markup.as_bytes());
    let (mut next, most) = (0, wanted.len() + MOST_INDIRECT);
    let mut listed: BTreeSet<_> = (wanted.iter())
        .map(|it| (it.by.get().id, it.url.clone()))
        .collect();
    let mut added = BTreeSet::new();
    while let Some(it) = wanted.get(next) {
        next += 1;
        let (by, url) = (Root::new(it.by.get()), it.url.clone());
        if added.contains(&url) {
            continue;
        }
        let Some(found) = by.get().fetch(&url, it.destination)?.await else {
            continue;
        };
        add(&string(found.essence()), &url, &found.bytes);
        added.insert(url);
        if found.essence() == b"text/css" {
            for url in referred_to_by(&found) {
                let name = before(&url, "?");
                let destination = match () {
                    () if name.ends_with(".css") => Destination::Style,
                    () if split_once(name, ".woff").is_some() || name.ends_with("tf") => {
                        Destination::Font
                    }
                    () => Destination::Image,
                };
                if wanted.len() < most && listed.insert((by.get().id, url.clone())) {
                    wanted.push(Wanted {
                        by: Root::new(by.get()),
                        url,
                        destination,
                        name: String::new(),
                    });
                }
            }
        }
    }
    archive += &format!("\r\n--{boundary}--\r\n");
    write(path, archive.as_bytes())
}

async fn save_with_resources(page: &Root<Page>, path: &str) -> JsResult<()> {
    let extension = bun_paths::extension(path.as_bytes()).len();
    let folder = format!("{}_files", &path[..path.len() - extension]);
    let purpose = Purpose::Save(encode_path(files::name(&folder)));
    let (markup, wanted) = snapshot(page.get(), purpose).await?;
    files::or_throw(files::make_directory(&folder, 0o777))?;
    for it in wanted {
        if let Some(found) = it.by.get().fetch(&it.url, it.destination)?.await {
            write(&files::join(&[&folder, &it.name]), &found.bytes)?;
        }
    }
    write(path, markup.as_bytes())
}

pub(super) fn save(page: &Page, path: String, kind: String) -> JsResult<JSValue> {
    if !["HTMLOnly", "HTMLComplete", "MHTML"].contains(&&*kind) {
        return Err(type_error(format_args!(
            "Error processing argument at index 1, conversion failure from {kind}"
        )));
    }
    if !files::is_absolute(&path) {
        return Err(error(format_args!("Path must be absolute")));
    }
    let page = Root::new(page);
    Ok(task::promise(async move {
        let folder = files::parent(&path).unwrap_or_default();
        files::or_throw(files::make_directory(folder, 0o777))?;
        match &*kind {
            "MHTML" => save_archive(&page, &path).await?,
            "HTMLComplete" => save_with_resources(&page, &path).await?,
            _ => {
                let found = (page.get()).fetch(&page.get().url(), Destination::Document)?;
                let failed = || error(format_args!("Failed to save the page."));
                write(&path, &found.await.ok_or_else(failed)?.bytes)?;
            }
        }
        Ok(JSValue::UNDEFINED)
    }))
}
