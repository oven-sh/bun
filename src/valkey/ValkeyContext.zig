//! Per-VM Valkey state. The four cached `us_socket_context_t`s that used to
//! live here are gone — connections link into `RareData.valkey_group` /
//! `valkey_tls_group` instead, and the default-TLS `SSL_CTX` is
//! `RareData.defaultClientSslCtx()`.

pub fn deinit(_: *@This()) void {}

const bun = @import("bun");
