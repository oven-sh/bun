//! Cloud credentials without an SDK: the AWS default credential provider
//! chain + SigV4 (`Bun.s3`, `fetch("s3://…")`, `fetch(url, { aws })`,
//! `Bun.aws`) and Google application default credentials (`fetch(url, { gcp })`,
//! `Bun.gcp`). `http_sync`/`json`/`env`/`cache` are the shared plumbing.

pub mod aws;
pub mod cache;
pub mod env;
pub mod gcp;
pub mod http_sync;
pub mod json;
