//! What `autoUpdater` loads and `crashReporter` sends.

use bun_web::headers::HeaderList;
use bun_web::net::NetError;
use bun_web::net::body::{Body, Data};
use bun_web::net::fetch::Controller;
use bun_web::request::{CacheMode, Credentials, Redirect, RequestBody};

use super::load::{Sender, or_failure, request_for};
use crate::task;

async fn load(
    url: &str,
    headers: HeaderList,
    posted: Option<Vec<u8>>,
) -> Result<(u16, Body), NetError> {
    let mut request = request_for(url)?;
    if let Some(posted) = posted {
        request.method = b"POST"[..].into();
        request.body = Some(RequestBody::Data(Data::Bytes(posted.into())));
        request.redirect = Redirect::Error;
    }
    (request.headers, request.cache) = (headers, CacheMode::NoStore);
    request.credentials = Credentials::Omit;
    let sender = Sender {
        bypasses_handlers: true,
        ..Default::default()
    };
    let loaded = or_failure(super::default())?
        .load(request, sender, &(), &Controller::default())
        .await?;
    Ok((loaded.head.status, loaded.body.unwrap_or_default()))
}

#[cfg(unix)]
pub(crate) async fn read_url(url: &str, headers: HeaderList) -> Result<(u16, Vec<u8>), String> {
    read_answer(url, headers, None).await
}

#[cfg(any(target_os = "linux", target_os = "macos", windows))]
pub(crate) async fn post(
    url: &str,
    headers: HeaderList,
    body: Vec<u8>,
) -> Result<(u16, Vec<u8>), String> {
    read_answer(url, headers, Some(body)).await
}

async fn read_answer(
    url: &str,
    headers: HeaderList,
    posted: Option<Vec<u8>>,
) -> Result<(u16, Vec<u8>), String> {
    let read = async {
        let (status, body) = load(url, headers, posted).await?;
        Ok((status, body.read_to_end().await?.into_vec()))
    };
    let read = task::within(60_000, read).await;
    (read.unwrap_or(Err(NetError::TimedOut))).map_err(|it| it.message().into())
}

/// Returns the status, the size and the SHA-256.
#[cfg(unix)]
pub(crate) async fn save_url(url: &str, path: &str) -> Result<(u16, u64, [u8; 32]), String> {
    use bun_sha_hmac::sha::evp::SHA256;
    use bun_sys::{Fd, File, O};
    use bun_web::exec::blocking;
    use std::sync::Arc;

    let save = async {
        let (status, mut body) = load(url, HeaderList::default(), None).await?;
        let how = O::WRONLY | O::CREAT | O::CLOEXEC | O::EXCL;
        let file = File::openat(Fd::cwd(), path.as_bytes(), how, 0o600);
        let file = Arc::new(file.map_err(|_| NetError::AccessDenied)?);
        let (mut size, mut hasher, mut digest) = (0, SHA256::init(), [0; 32]);
        while let Some(chunk) =
            (task::within(60_000, body.read()).await).unwrap_or(Err(NetError::TimedOut))?
        {
            size += chunk.len() as u64;
            hasher.update(&chunk);
            let file = Arc::clone(&file);
            let written = blocking(move || file.write_all(&chunk)).await;
            written.and_then(Result::ok).ok_or(NetError::Failed)?;
        }
        hasher.r#final(&mut digest);
        Ok((status, size, digest))
    };
    save.await.map_err(|it: NetError| it.message().into())
}
