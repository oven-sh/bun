//! The keys and the format of Electron's `safeStorage`, so that each can read what the other has written.

use std::sync::OnceLock;

use crate::cipher::Direction;
use crate::prelude::*;
use crate::{paths, text};

pub(crate) use system::{can_encrypt, decrypt, encrypt};

type Next = Box<dyn FnOnce() -> JsResult<()>>;

static KEY: OnceLock<system::Key> = OnceLock::new();

#[derive(Default)]
enum Progress {
    #[default]
    Untouched,
    Loading(Vec<Next>),
    Done,
}

state!(fn progress() -> RefCell<Progress>);

pub(crate) fn has_key() -> bool {
    KEY.get().is_some()
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
    match catch(system::read())? {
        Ok(()) => Ok(()),
        Err(thrown) => finish(Err(message_of(thrown)?)),
    }
}

fn finish(password: Result<Vec<u8>, String>) -> JsResult<()> {
    match password {
        Ok(password) => drop(KEY.set(system::derive(&password))),
        Err(reason) => warn(&format!("safeStorage has no key: {reason}"))?,
    }
    match progress().replace(Progress::Done) {
        Progress::Loading(waiting) => waiting
            .into_iter()
            .try_for_each(|next| bun_ui::report(global(), next())),
        _ => Ok(()),
    }
}

#[cfg(unix)]
mod system {
    use bun_ui::protocol::{Reply, Request, SystemRequest};
    use bun_ui::queue;

    use super::*;
    use crate::cipher::aes_128_cbc;
    use crate::secrets::{self, Found};
    use crate::{app, command_line};

    pub(super) type Key = [u8; 16];

    const PREFIX: &[u8] = if IS_MAC { b"v10" } else { b"v11" };
    const IV: Key = [b' '; 16];

    pub(super) fn derive(password: &[u8]) -> Key {
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

    pub(crate) fn can_encrypt() -> bool {
        has_key() || !IS_MAC
    }

    pub(crate) fn encrypt(data: &[u8]) -> Option<Vec<u8>> {
        let (prefix, key) = KEY
            .get()
            .map_or_else(|| (&b"v10"[..], derive(b"peanuts")), |it| (PREFIX, *it));
        Some([prefix, &aes_128_cbc(Direction::Encrypt, &key, &IV, data)?].concat())
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

    pub(super) fn read() -> JsResult<()> {
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
}

/// The key is in a file, where only this user can read it.
#[cfg(windows)]
mod system {
    use super::*;
    use crate::cipher::aes_256_gcm;
    use crate::{files, win32};

    pub(super) type Key = Vec<u8>;

    const PREFIX: &[u8] = b"v10";
    const PREFIX_OF_KEY: &[u8] = b"DPAPI";
    const NONCE: usize = 12;
    const LENGTH: usize = 32;
    const NAME_OF_OLDER: &str = "older_encrypted_keys";

    /// They could not be opened once, which a logon with the password, or in reach of the domain, may change.
    static OLDER: OnceLock<Vec<String>> = OnceLock::new();

    pub(super) fn derive(password: &[u8]) -> Key {
        password.into()
    }

    pub(crate) fn can_encrypt() -> bool {
        has_key()
    }

    pub(crate) fn encrypt(data: &[u8]) -> Option<Vec<u8>> {
        let nonce = text::random_bytes::<NONCE>();
        let sealed = aes_256_gcm(Direction::Encrypt, KEY.get()?, &nonce, data)?;
        Some([PREFIX, &nonce, &sealed].concat())
    }

    pub(crate) fn decrypt(data: &[u8]) -> Option<Vec<u8>> {
        let (nonce, sealed) = data.strip_prefix(PREFIX)?.split_at_checked(NONCE)?;
        let with = |key: &Key| aes_256_gcm(Direction::Decrypt, key, nonce, sealed);
        with(KEY.get()?).or_else(|| (OLDER.get()?.iter()).find_map(|it| with(&open(it).ok()??)))
    }

    /// `None` if waiting is not likely to help.
    fn open(stored: &str) -> std::io::Result<Option<Key>> {
        let stored = bun_base64::decode_alloc(stored.as_bytes()).unwrap_or_default();
        match stored.strip_prefix(PREFIX_OF_KEY).map(win32::unprotect) {
            Some(Ok(key)) => Ok(Some(key).filter(|it| it.len() == LENGTH)),
            Some(Err(error)) if !win32::needs_another_key(&error) => Err(error),
            _ => Ok(None),
        }
    }

    fn make() -> std::io::Result<(String, Key)> {
        let protected = win32::protect(&text::random_bytes::<LENGTH>())?;
        let stored = text::base64(&[PREFIX_OF_KEY, &protected].concat());
        match open(&stored)? {
            Some(key) => Ok((stored, key)),
            None => Err(std::io::Error::other(
                "the system does not give back what it protects",
            )),
        }
    }

    struct Stored {
        /// `None` if it is damaged.
        state: Option<JSValue>,
        current: Option<String>,
        older: Vec<String>,
    }

    fn read_from(file: &str) -> JsResult<Result<Stored, String>> {
        let state = match files::read(file) {
            Some(text) => catch(files::parse_json(&text))?
                .ok()
                .filter(|it| it.is_object()),
            None if files::exists(file) => return Ok(Err(format!("{file} cannot be read"))),
            None => Some(object!({})),
        };
        let part = state.map_or(Ok(JSValue::UNDEFINED), |it| get(it, "os_crypt"))?;
        let member = |name| {
            if part.is_object() {
                get(part, name)
            } else {
                Ok(part)
            }
        };
        let (current, older) = (member("encrypted_key")?, member(NAME_OF_OLDER)?);
        Ok(Ok(Stored {
            state,
            current: current.is_string().then(|| text_of(current)).transpose()?,
            older: if older.is_array() {
                texts_of(older)?
            } else {
                Vec::new()
            },
        }))
    }

    fn write(file: &str, stored: &Stored) -> JsResult<()> {
        let state = stored.state.unwrap_or_else(|| object!({}));
        let part = Some(get(state, "os_crypt")?).filter(|it| it.is_object());
        let part = part.unwrap_or_else(|| object!({}));
        part.put(global(), b"encrypted_key", js(stored.current.clone())?);
        if !stored.older.is_empty() {
            part.put(
                global(),
                NAME_OF_OLDER.as_bytes(),
                js(stored.older.clone())?,
            );
        }
        state.put(global(), b"os_crypt", part);
        let (json, new) = (state.json_stringify_fast(global())?, format!("{file}.new"));
        files::or_throw(files::write_for_good(&new, &json.to_utf8(), 0o600))?;
        if stored.state.is_none() {
            let aside = format!(
                "{file}.{:08x}.bad",
                u32::from_ne_bytes(text::random_bytes())
            );
            files::or_throw(files::rename(file, &aside))?;
            warn(&format!("{file} is damaged. It has been moved to {aside}"))?;
        }
        files::or_throw(files::rename(&new, file))
    }

    fn read_or_create() -> JsResult<Result<Key, String>> {
        let directory = paths::path("sessionData")?;
        let file = files::join(&[&directory, "Local State"]);
        let mut turn = None;
        loop {
            let mut stored = match read_from(&file)? {
                Ok(stored) => stored,
                Err(reason) => return Ok(Err(reason)),
            };
            match stored.current.as_deref().map_or(Ok(None), open) {
                Ok(Some(key)) => {
                    _ = OLDER.set(stored.older);
                    return Ok(Ok(key));
                }
                Err(error) => return Ok(Err(error.to_string())),
                Ok(None) if turn.is_some() => {}
                Ok(None) => {
                    files::or_throw(files::make_directory(&directory, 0o700))?;
                    turn = win32::take_turn(&format!("{file}.lock"));
                    if turn.is_none() {
                        return Ok(Err(format!("{file} cannot be written")));
                    }
                    continue;
                }
            }
            let known =
                (stored.older.iter().enumerate()).find_map(|(at, it)| Some((at, open(it).ok()??)));
            let (current, key) = match known {
                Some((at, key)) => (stored.older.remove(at), key),
                None => match make() {
                    Ok(made) => made,
                    Err(error) => return Ok(Err(error.to_string())),
                },
            };
            stored.older.extend(stored.current.replace(current));
            write(&file, &stored)?;
            _ = OLDER.set(stored.older);
            return Ok(Ok(key));
        }
    }

    pub(super) fn read() -> JsResult<()> {
        let key = read_or_create()?;
        later::soon(|_| finish(key));
        Ok(())
    }
}
