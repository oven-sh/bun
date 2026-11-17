//! The keys and the format of Electron's `safeStorage`, so that each can read what the other has written.

use std::sync::OnceLock;

use bun_ui::protocol::{Reply, Request, SystemRequest};
use bun_ui::queue;

use crate::cipher::{Direction, aes_128_cbc};
use crate::prelude::*;
use crate::secrets::{self, Found};
use crate::{app, command_line, paths, text};

type Key = [u8; 16];
type Next = Box<dyn FnOnce() -> JsResult<()>>;

const PREFIX: &[u8] = if IS_MAC { b"v10" } else { b"v11" };
const IV: Key = [b' '; 16];

static KEY: OnceLock<Key> = OnceLock::new();

#[derive(Default)]
enum Progress {
    #[default]
    Untouched,
    Loading(Vec<Next>),
    Done,
}

state!(fn progress() -> RefCell<Progress>);

fn derive(password: &[u8]) -> Key {
    let (mut key, salt) = (Key::default(), b"saltysalt");
    // SAFETY: each pointer goes with its length.
    unsafe {
        bun_boringssl_sys::PKCS5_PBKDF2_HMAC(
            password.as_ptr(),
            password.len(),
            salt.as_ptr(),
            salt.len(),
            if IS_MAC { 1003 } else { 1 },
            bun_boringssl_sys::EVP_sha1(),
            key.len(),
            key.as_mut_ptr(),
        );
    }
    key
}

pub(crate) fn has_key() -> bool {
    KEY.get().is_some()
}

pub(crate) fn can_encrypt() -> bool {
    has_key() || !IS_MAC
}

pub(crate) fn encrypt(data: &[u8]) -> Vec<u8> {
    let (prefix, key) = KEY
        .get()
        .map_or_else(|| (&b"v10"[..], derive(b"peanuts")), |it| (PREFIX, *it));
    [
        prefix,
        &aes_128_cbc(Direction::Encrypt, &key, &IV, data).unwrap_or_default(),
    ]
    .concat()
}

pub(crate) fn decrypt(data: &[u8]) -> Option<Vec<u8>> {
    let (prefix, data) = data.split_at_checked(3)?;
    let key = if prefix == PREFIX {
        *KEY.get()?
    } else {
        derive(b"peanuts")
    };
    aes_128_cbc(Direction::Decrypt, &key, &IV, data)
}

pub(crate) fn is_untouched() -> bool {
    matches!(*progress().borrow(), Progress::Untouched)
}

/// `next` is called whether or not there is a key.
pub(crate) fn load(next: impl FnOnce() -> JsResult<()> + 'static) -> JsResult<()> {
    match &mut *progress().borrow_mut() {
        Progress::Loading(waiting) => {
            waiting.push(Box::new(next));
            return Ok(());
        }
        Progress::Done => {
            later::soon(|_| next());
            return Ok(());
        }
        untouched => *untouched = Progress::Loading(vec![Box::new(next)]),
    }
    match catch(read())? {
        Ok(()) => Ok(()),
        Err(thrown) => finish(Err(message_of(thrown)?)),
    }
}

fn finish(password: Result<Vec<u8>, String>) -> JsResult<()> {
    match password {
        Ok(password) => drop(KEY.set(derive(&password))),
        Err(reason) => warn(&format!("safeStorage has no key: {reason}"))?,
    }
    match progress().replace(Progress::Done) {
        Progress::Loading(waiting) => waiting
            .into_iter()
            .try_for_each(|next| bun_ui::report(global(), next())),
        _ => Ok(()),
    }
}

fn read() -> JsResult<()> {
    let fresh = text::base64(&text::random_bytes::<16>());
    let owner = command_line::value("safe-storage-name").map_or_else(paths::app_name, Ok)?;
    if !IS_MAC {
        let request = SystemRequest::ChromiumPassword {
            application: owner.into(),
            fresh: fresh.into(),
        };
        return queue::request(global(), Request::System(request), |_, reply| match reply {
            Reply::Secret(it) => finish(Ok(it.into_vec())),
            Reply::Failed(reason) => finish(Err(reason.into_string())),
            _ => finish(Err("there is none".into())),
        });
    }
    if command_line::switch("use-mock-keychain").is_some() {
        later::soon(|_| finish(Ok(b"mock_password".into())));
        return Ok(());
    }
    let other = command_line::value("safe-storage-copy-from");
    keychain_password(
        other.clone().unwrap_or_else(|| owner.clone()),
        move |stored| {
            let password = match (stored, other) {
                (Err(reason), _) => return finish(Err(reason)),
                (Ok(None), Some(other)) => return finish(Err(format!("{other} has no key"))),
                (Ok(Some(stored)), None) => return finish(Ok(stored.into_bytes())),
                (Ok(stored), _) => stored.unwrap_or(fresh),
            };
            let store = move || {
                secrets::set(
                    &format!("{owner} Safe Storage"),
                    &format!("{owner} Key"),
                    &password,
                )?;
                Ok(password.into_bytes())
            };
            in_background(store, finish);
            Ok(())
        },
    )
}

/// Old versions of Electron left out " Key".
fn keychain_password(
    owner: String,
    next: impl FnOnce(Found) -> JsResult<()> + 'static,
) -> JsResult<()> {
    let service = format!("{owner} Safe Storage");
    read_secret(
        service.clone(),
        format!("{owner} Key"),
        move |found| match found {
            Ok(None) => read_secret(service, owner, next),
            found => next(found),
        },
    )
}

fn read_secret(
    service: String,
    name: String,
    next: impl FnOnce(Found) -> JsResult<()> + 'static,
) -> JsResult<()> {
    let request = SystemRequest::ReadKeychain {
        service: service.as_str().into(),
        account: name.as_str().into(),
    };
    queue::request(global(), Request::System(request), move |_, reply| {
        match reply {
            Reply::Secret(it) if !it.is_empty() => return next(Ok(Some(string(&it)))),
            Reply::NoSecret { would_ask: true } => app::explain_wait_for_key()?,
            _ => {}
        }
        in_background(move || secrets::get(&service, &name), next);
        Ok(())
    })
}
