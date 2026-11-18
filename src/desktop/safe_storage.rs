//! `safeStorage`

use core::cell::OnceCell;

use crate::cipher::{Direction, TAG, aes_256_gcm};
use crate::generated_bindgen::electron::ElectronSafeStorage;
use crate::generated_bindgen::system::DesktopSafeStorage;
use crate::prelude::*;
use crate::{app, os_crypt, paths, secrets, text};

const PREFIX: &[u8] = b"b1";
const NONCE: usize = 12;

type Next = Box<dyn FnOnce(JsResult<()>) -> JsResult<()>>;

#[derive(Default)]
struct State {
    key: OnceCell<Vec<u8>>,
    waiting: RefCell<Vec<Next>>,
    allows_plain_text: Cell<bool>,
}

state!(fn state() -> State);

fn read_or_create_key(service: &str, name: &str) -> Result<Vec<u8>, String> {
    let stored = match secrets::get(service, name)? {
        Some(stored) => stored,
        None => {
            let fresh = text::base64(&text::random_bytes::<32>());
            secrets::set(service, name, &fresh)?;
            fresh
        }
    };
    bun_base64::decode_alloc(stored.as_bytes()).map_err(|_| "The key is damaged".into())
}

/// A promise of what `then` returns. It is told whether there is a key.
fn with_key(then: impl FnOnce(JsResult<()>) -> JsResult<JSValue> + 'static) -> JsResult<JSValue> {
    if state().key.get().is_some() {
        return resolved(then(Ok(()))?);
    }
    let (service, name) = (
        format!("{} Safe Storage", paths::app_name()?),
        paths::identifier()?,
    );
    let result = Deferred::new();
    let promise = result.promise();
    let is_first = state().waiting.borrow().is_empty();
    state()
        .waiting
        .borrow_mut()
        .push(Box::new(move |outcome| result.settle(then(outcome))));
    if is_first {
        in_background(
            move || read_or_create_key(&service, &name),
            |key| {
                let outcome = key.map(|it| drop(state().key.set(it)));
                (state().waiting.take().into_iter()).try_for_each(|next| {
                    next(outcome.clone().map_err(|it| error(format_args!("{it}"))))
                })
            },
        );
    }
    Ok(promise)
}

fn loaded_key() -> JsResult<&'static [u8]> {
    let message =
        "The key has not been read yet. Wait for safeStorage.isAsyncEncryptionAvailable() first.";
    state()
        .key
        .get()
        .map(Vec::as_slice)
        .ok_or_else(|| error(format_args!("{message}")))
}

fn encrypt(text: &[u8]) -> JsResult<JSValue> {
    let nonce = text::random_bytes::<NONCE>();
    let sealed = aes_256_gcm(Direction::Encrypt, loaded_key()?, &nonce, text);
    buffer(
        &[
            PREFIX,
            &nonce,
            &sealed.ok_or_else(|| error(format_args!("Invalid key length")))?,
        ]
        .concat(),
    )
}

fn decrypt(encrypted: &[u8]) -> JsResult<String> {
    let Some(rest) = encrypted
        .strip_prefix(PREFIX)
        .filter(|it| it.len() >= NONCE + TAG)
    else {
        return Err(invalid_value(
            "encrypted",
            &format!("{} bytes", encrypted.len()),
            "was not made by safeStorage",
        ));
    };
    let (nonce, sealed) = rest.split_at(NONCE);
    let opened = aes_256_gcm(Direction::Decrypt, loaded_key()?, nonce, sealed);
    Ok(string(&opened.ok_or_else(|| {
        error(format_args!(
            "Unsupported state or unable to authenticate data"
        ))
    })?))
}

fn decrypted(text: String) -> JsResult<JSValue> {
    Ok(object!({ "result": text, "shouldReEncrypt": false }))
}

impl DesktopSafeStorage {
    pub(crate) fn is_encryption_available() -> bool {
        state().key.get().is_some()
    }

    pub(crate) fn is_async_encryption_available(_: Cx<'_, '_>) -> JsResult<JSValue> {
        with_key(|outcome| js(catch(outcome)?.is_ok()))
    }

    pub(crate) fn encrypt_string(_: Cx<'_, '_>, text: &[u8]) -> JsResult<JSValue> {
        encrypt(text)
    }

    pub(crate) fn decrypt_string(_: &JsHeap<'_>, encrypted: &[u8]) -> JsResult<String> {
        decrypt(encrypted)
    }

    pub(crate) fn encrypt_string_async(_: Cx<'_, '_>, text: &[u8]) -> JsResult<JSValue> {
        let text = text.to_vec();
        with_key(move |outcome| outcome.and_then(|()| encrypt(&text)))
    }

    pub(crate) fn decrypt_string_async(_: Cx<'_, '_>, encrypted: Vec<u8>) -> JsResult<JSValue> {
        with_key(move |outcome| outcome.and_then(|()| decrypted(decrypt(&encrypted)?)))
    }
}

fn check(method: &str) -> JsResult<()> {
    if !app::is_ready() {
        return Err(error(format_args!(
            "safeStorage cannot be used before app is ready"
        )));
    }
    if !ElectronSafeStorage::is_encryption_available() {
        return Err(error(format_args!(
            "Error while running safeStorage.{method}. Encryption is not available."
        )));
    }
    Ok(())
}

impl ElectronSafeStorage {
    pub(crate) fn is_encryption_available() -> bool {
        app::is_ready() && (os_crypt::has_key() || state().allows_plain_text.get())
    }

    pub(crate) fn is_async_encryption_available(_: Cx<'_, '_>) -> JsResult<JSValue> {
        resolved(Self::is_encryption_available())
    }

    pub(crate) fn encrypt_string(_: Cx<'_, '_>, text: &[u8]) -> JsResult<JSValue> {
        check("encryptString")?;
        let failure = "Error while encrypting the text provided to safeStorage.encryptString.";
        buffer(&os_crypt::encrypt(text).ok_or_else(|| error(format_args!("{failure}")))?)
    }

    pub(crate) fn decrypt_string<'a>(_: Cx<'a, '_>, encrypted: JsLocal<'a>) -> JsResult<String> {
        check("decryptString")?;
        let bytes =
            Some(encrypted.to_js()).filter(|it| it.js_type() == bun_jsc::JSType::Uint8Array);
        let bytes = bytes.and_then(|it| it.as_array_buffer(global()));
        let Some(bytes) = bytes else {
            return Err(type_error(format_args!(
                "Expected the first argument of decryptString() to be a buffer"
            )));
        };
        let failure =
            "Error while decrypting the ciphertext provided to safeStorage.decryptString.";
        match bytes.slice() {
            [] => Ok(String::new()),
            bytes @ [b'v', b'1', b'0' | b'1', ..] => os_crypt::decrypt(bytes)
                .map(|it| string(&it))
                .ok_or_else(|| error(format_args!("{failure}"))),
            _ => Err(error(format_args!(
                "{failure} Ciphertext does not appear to be encrypted."
            ))),
        }
    }

    pub(crate) fn encrypt_string_async(cx: Cx<'_, '_>, text: &[u8]) -> JsResult<JSValue> {
        resolved(Self::encrypt_string(cx, text)?)
    }

    pub(crate) fn decrypt_string_async<'a>(
        cx: Cx<'a, '_>,
        encrypted: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        resolved(decrypted(Self::decrypt_string(cx, encrypted)?)?)
    }

    pub(crate) fn set_use_plain_text_encryption(is_allowed: bool) {
        state()
            .allows_plain_text
            .set(is_allowed && !IS_MAC && !IS_WINDOWS);
    }

    pub(crate) fn get_selected_storage_backend() -> &'static str {
        match (app::is_ready(), os_crypt::has_key()) {
            (false, _) => "unknown",
            (true, true) => "gnome_libsecret",
            (true, false) => "basic_text",
        }
    }
}
