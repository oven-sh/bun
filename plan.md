# 0831da79: runtime auto-install honors install ca / cafile

Branch: robobun/0831da79/autoinstall-install-ca (rebuild on main a407eae88a or later).
Old work (base bd599f5af9, before #44968): refs/robobun-backup/0831da79-autoinstall-install-ca = d91f8b57c3 (4 commits).

## Design (review run ea2dd2bd7f5c): pick one-ca-derivation-two-carriers
- runtime: one interned SSLConfig from options.ca / ca_file_name, attached as tls_props by NetworkTask::for_manifest / for_tarball.
- bun install stays on the HTTP thread InitOpts.
- relative cafile base = start directory (initial_top_level_dir() exists on main since #44968).
- bad CA at runtime: lazy, fail closed, named, not retried, not process-fatal.
- h3 gate: thread-level CA => no Alt-Svc h3 upgrade (has_tls_options_unsupported_by_h3).

## Self-review (run 47c2326e88a9) verdict: rework, wanted-in-a-different-shape
- keep the core runtime fix.
- drop the connect-path refactor (old commit 3: custom_ssl_context shared with ProxyTunnel, ensure_https_context_init move). Collides with #40385.
- carry the bad-CA cause from the HTTP thread in the result; do not rebuild an SSL_CTX on the JS thread.
- sequencing with #44754: moot, merged through #44968. But registry + cafile both in .npmrc must work at runtime => take .npmrc ca / cafile at runtime.
- docs sentence must match what is honored.

## New main facts (a407eae88a)
- #44968 merged: runtime reads .npmrc registries + credentials (not ca / cafile), initial_top_level_dir(), retry backoff, cert errors not retried,
  auto-install failure prints "note: <log line>" under the resolve error.
- CLI cafile join already checked (join_abs_string_buf_checked). Do not touch PackageManager::init.
- repro: /tmp/notes/repro/repro.ts <exe>. On main debug: runtime rows with bunfig cafile / ca / npmrc cafile all fail with
  "note: DEPTH_ZERO_SELF_SIGNED_CERT downloading package manifest @corp/thing".
