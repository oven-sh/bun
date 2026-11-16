//! The clipboard and what is dropped: https://tronche.com/gui/x/icccm/sec-2.html

use std::cell::RefCell;
use std::os::unix::ffi::OsStringExt as _;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::atom::{self, Name};
use super::wire::{Bytes as _, Request};
use super::{X11, dbus, event, mask};
use crate::bridge;
use crate::error::{Context as _, Result};
use crate::json::{Value, json};

const CHUNK: usize = 1 << 17;
const IMAGES: [(Name, &str); 6] = [
    (atom::PNG, "image/png"),
    (atom::JPEG, "image/jpeg"),
    (atom::WEBP, "image/webp"),
    (atom::GIF, "image/gif"),
    (atom::BMP, "image/bmp"),
    (atom::SVG, "image/svg+xml"),
];

type Contents = Vec<(u32, Rc<Vec<u8>>)>;

struct Transfer {
    to: (u32, u32),
    kind: u32,
    bytes: Rc<Vec<u8>>,
    sent: usize,
}

#[derive(Default)]
pub struct Selections {
    /// By selection, with the time from which.
    owned: RefCell<Vec<(u32, u32, Contents)>>,
    transfers: RefCell<Vec<Transfer>>,
}

pub fn paths_in(list: &[u8]) -> Vec<PathBuf> {
    let paths = list
        .split(|it| *it == b'\n')
        .filter_map(|line| line.trim_ascii().strip_prefix(b"file://"));
    let without_host = paths.filter_map(|it| Some(&it[it.iter().position(|it| *it == b'/')?..]));
    without_host
        .map(|it| std::ffi::OsString::from_vec(dbus::percent_decoded(it)).into())
        .collect()
}

/// Firefox offers UTF-16.
fn html(bytes: &[u8]) -> String {
    match bytes {
        [0xff, 0xfe, rest @ ..] => String::from_utf16_lossy(
            &rest
                .as_chunks()
                .0
                .iter()
                .map(|it| u16::from_le_bytes(*it))
                .collect::<Vec<_>>(),
        ),
        _ => String::from_utf8_lossy(bytes).into_owned(),
    }
}

fn image_type(bytes: &[u8]) -> Option<Name> {
    Some(match bytes {
        [0x89, b'P', b'N', b'G', ..] => atom::PNG,
        [0xff, 0xd8, ..] => atom::JPEG,
        [b'R', b'I', b'F', b'F', ..] => atom::WEBP,
        [b'G', b'I', b'F', ..] => atom::GIF,
        [b'B', b'M', ..] => atom::BMP,
        _ if bytes.trim_ascii_start().starts_with(b"<") => atom::SVG,
        _ => return None,
    })
}

impl X11 {
    fn selection(&self, is_primary: bool) -> u32 {
        if is_primary {
            atom::PRIMARY
        } else {
            self.atom(atom::CLIPBOARD)
        }
    }

    /// Others get what they ask for in the meantime.
    fn wait_for(&self, patience: Duration, is_wanted: impl Fn(&[u8]) -> bool) -> Option<Vec<u8>> {
        let mut deadline = Instant::now() + patience;
        loop {
            let is_for_others = |it: &[u8]| match it[0] & 0x7f {
                event::PROPERTY => self
                    .selections
                    .transfers
                    .borrow()
                    .iter()
                    .any(|to| to.to == (it.u32(4), it.u32(8))),
                kind => kind == event::SELECTION_REQUEST,
            };
            while let Some(found) = self.x.take_event(is_for_others) {
                self.selection_event(&found);
                deadline = Instant::now() + patience;
            }
            if let Some(found) = self.x.take_event(&is_wanted) {
                return Some(found);
            }
            let left = deadline
                .checked_duration_since(Instant::now())
                .filter(|_| !self.x.is_broken())?;
            self.x.flush();
            self.x.read(left.as_millis() as i32 + 1);
        }
    }

    pub fn convert(&self, selection: u32, target: u32, time: u32) -> Option<Vec<u8>> {
        const PATIENCE: Duration = Duration::from_secs(2);
        let property = self.atom(atom::TRANSFER);
        self.x
            .send(Request::new(24, 0).words(&[self.helper, selection, target, property, time]));
        let is_answer = |it: &[u8]| {
            it[0] & 0x7f == event::SELECTION && (it.u32(12), it.u32(16)) == (selection, target)
        };
        self.wait_for(PATIENCE, is_answer)
            .filter(|it| it.u32(20) != 0)?;
        let is_written = |it: &[u8]| {
            it[0] == event::PROPERTY && (it.u32(4), it.u32(8), it[16]) == (self.helper, property, 0)
        };
        while self.x.take_event(is_written).is_some() {}
        let take = || {
            self.x
                .property(self.x.ask_for_property(self.helper, property, true))
        };
        let first = take()?;
        if first.kind != self.atom(atom::INCR) {
            return Some(first.value);
        }
        let mut all = Vec::new();
        loop {
            self.wait_for(PATIENCE, is_written)?;
            match take()?.value {
                part if part.is_empty() => return Some(all),
                part if all.len() + part.len() > 1 << 28 => return None,
                part => all.extend(part),
            }
        }
    }

    pub fn read_clipboard(&self, kind: &str) -> Value {
        let selection = self.selection(kind == "selection");
        let own = self
            .selections
            .owned
            .borrow()
            .iter()
            .find(|it| it.0 == selection)
            .map(|it| it.2.clone());
        let targets = match &own {
            Some(own) => own.iter().map(|it| it.0).collect(),
            None => self
                .convert(selection, self.atom(atom::TARGETS), 0)
                .unwrap_or_default()
                .words(),
        };
        let read = |target: u32| match &own {
            _ if !targets.contains(&target) => None,
            Some(own) => own.iter().find(|it| it.0 == target).map(|it| it.1.to_vec()),
            None => self.convert(selection, target, 0),
        };
        let mut result = json!({});
        let text = [atom::UTF8_STRING, atom::PLAIN_UTF8]
            .into_iter()
            .find_map(|it| read(self.atom(it)));
        let text = text.map(|it| String::from_utf8_lossy(&it).into_owned());
        if let Some(text) =
            text.or_else(|| Some(read(atom::STRING)?.into_iter().map(char::from).collect()))
        {
            result["text"] = text.into();
        }
        if kind == "text" {
            return result;
        }
        if let Some(bytes) = read(self.atom(atom::HTML)) {
            result["html"] = html(&bytes).into();
        }
        if let Some(list) = read(self.atom(atom::URI_LIST)) {
            result["files"] = paths_in(&list)
                .iter()
                .map(|it| it.to_string_lossy().into_owned())
                .collect();
        }
        if let Some((bytes, kind)) = IMAGES
            .iter()
            .find_map(|(name, kind)| Some((read(self.atom(*name))?, *kind)))
        {
            result["type"] = kind.into();
            result["image"] = bridge::put_blob(bytes).into();
        }
        result
    }

    pub fn write_clipboard(&self, arguments: &Value) -> Result<()> {
        let mut contents = Contents::new();
        if !arguments["image"].is_null() {
            let bytes = bridge::blob(&arguments["image"])?;
            contents.push((
                self.atom(image_type(&bytes).context("the image has an unknown format")?),
                bytes.into(),
            ));
        }
        if let Some(html) = arguments["html"].as_str() {
            let bytes = format!(
                "<meta http-equiv=\"content-type\" content=\"text/html; charset=utf-8\">{html}"
            );
            contents.push((self.atom(atom::HTML), bytes.into_bytes().into()));
        }
        if let Some(text) = arguments["text"].as_str() {
            let bytes = Rc::new(text.as_bytes().to_vec());
            let names = [atom::UTF8_STRING, atom::PLAIN_UTF8, atom::PLAIN, atom::TEXT];
            contents.extend(names.map(|name| (self.atom(name), bytes.clone())));
            contents.push((
                atom::STRING,
                Rc::new(
                    text.chars()
                        .map(|it| it.try_into().unwrap_or(b'?'))
                        .collect(),
                ),
            ));
        }
        let (selection, time) = (
            self.selection(arguments["selection"] == true),
            self.time.get(),
        );
        let mut owned = self.selections.owned.borrow_mut();
        owned.retain(|it| it.0 != selection);
        owned.push((selection, time, contents));
        self.x
            .check(Request::new(22, 0).words(&[self.helper, selection, time]))
    }

    fn answer(&self, selection: u32, target: u32, to: (u32, u32)) -> Option<()> {
        let owned = self.selections.owned.borrow();
        let (_, time, contents) = owned.iter().find(|it| it.0 == selection)?;
        if target == self.atom(atom::TARGETS) {
            let always =
                [atom::TARGETS, atom::TIMESTAMP, atom::SAVE_TARGETS].map(|it| self.atom(it));
            let targets: Vec<_> = always
                .into_iter()
                .chain(contents.iter().map(|it| it.0))
                .collect();
            self.x.set_words(to.0, to.1, atom::ATOM, &targets);
            return Some(());
        }
        if target == self.atom(atom::TIMESTAMP) {
            self.x.set_words(to.0, to.1, atom::INTEGER, &[*time]);
            return Some(());
        }
        let bytes = contents.iter().find(|it| it.0 == target)?.1.clone();
        let kind = if target == self.atom(atom::TEXT) {
            self.atom(atom::UTF8_STRING)
        } else {
            target
        };
        if bytes.len() <= CHUNK {
            self.x.set_bytes(to.0, to.1, kind, &bytes);
            return Some(());
        }
        self.x.select_events(to.0, mask::PROPERTY);
        self.x
            .set_words(to.0, to.1, self.atom(atom::INCR), &[bytes.len() as u32]);
        let mut transfers = self.selections.transfers.borrow_mut();
        transfers.retain(|it| it.to != to);
        transfers.push(Transfer {
            to,
            kind,
            bytes,
            sent: 0,
        });
        Some(())
    }

    pub fn selection_event(&self, event: &[u8]) {
        match event[0] & 0x7f {
            event::SELECTION_CLEAR => {
                // It may have been taken back since.
                if self.x.selection_owner(event.u32(12)) != self.helper {
                    self.selections
                        .owned
                        .borrow_mut()
                        .retain(|it| it.0 != event.u32(12));
                }
            }
            event::SELECTION_REQUEST => {
                let [time, requestor, selection, target, property] =
                    [4, 12, 16, 20, 24].map(|at| event.u32(at));
                let property = if property == 0 { target } else { property };
                let is_answered = if target == self.atom(atom::MULTIPLE) {
                    let mut pairs = self.x.words(requestor, property);
                    for pair in pairs.as_chunks_mut::<2>().0 {
                        pair[1] = self
                            .answer(selection, pair[0], (requestor, pair[1]))
                            .map_or(0, |()| pair[1]);
                    }
                    self.x
                        .set_words(requestor, property, self.atom(atom::ATOM_PAIR), &pairs);
                    true
                } else {
                    self.answer(selection, target, (requestor, property))
                        .is_some()
                };
                let fields = [
                    time,
                    requestor,
                    selection,
                    target,
                    if is_answered { property } else { 0 },
                ];
                self.x.send_event(
                    requestor,
                    0,
                    Request::new(event::SELECTION, 0).words(&fields),
                );
            }
            // The last part was taken.
            _ if event[16] == 1 => {
                let mut transfers = self.selections.transfers.borrow_mut();
                let Some(at) = transfers
                    .iter()
                    .position(|it| it.to == (event.u32(4), event.u32(8)))
                else {
                    return;
                };
                let Transfer {
                    to,
                    kind,
                    bytes,
                    sent,
                } = &mut transfers[at];
                let part = bytes.part(*sent, CHUNK);
                self.x.set_bytes(to.0, to.1, *kind, part);
                *sent += part.len();
                if part.is_empty() {
                    self.x.select_events(to.0, 0);
                    transfers.remove(at);
                }
            }
            _ => {}
        }
    }

    /// https://www.freedesktop.org/wiki/ClipboardManager/
    pub fn hand_over_clipboard(&self) {
        let (manager, is_owned) = (self.atom(atom::CLIPBOARD_MANAGER), |it: &(u32, _, _)| {
            it.0 == self.selection(false)
        });
        if self.selections.owned.borrow().iter().any(is_owned)
            && self.x.selection_owner(manager) != 0
        {
            let fields = [
                self.helper,
                manager,
                self.atom(atom::SAVE_TARGETS),
                0,
                self.time.get(),
            ];
            self.x.send(Request::new(24, 0).words(&fields));
            self.wait_for(Duration::from_millis(500), |it| {
                it[0] & 0x7f == event::SELECTION && it.u32(12) == manager
            });
        }
    }
}
