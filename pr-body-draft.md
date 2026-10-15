### Problem
- A script that auto-installs from a registry behind a private CA fails, although `bunfig.toml` names the CA: `error: Cannot find module '@corp/thing'` with `note: DEPTH_ZERO_SELF_SIGNED_CERT downloading package manifest @corp/thing`. `bun install` in the same directory works.
- Only `PackageManager::init` (the CLI) reads `ca` / `cafile`, and it puts them on the HTTP thread. The runtime starts that thread with no options (`src/install/auto_installer.rs:504`).

### Fix
- The runtime builds one TLS config from `ca` / `cafile` of `bunfig.toml` and `.npmrc` (`request_tls_props` in `src/install/PackageManager.rs`). `NetworkTask` attaches it to each registry request. `fetch()` keeps the default certificates.
- A CA that does not load fails the import once and says why: `note: FailedToOpenSocket (could not find CA file: '/app/missing.pem') downloading package manifest @corp/thing`. The HTTP thread reports the cause in the new `HTTPClientResult::tls_init_error`.
- `bun install --cafile` no longer moves a request to HTTP/3 on `Alt-Svc`, because the HTTP/3 client does not read the CA.
- Verified: `test/cli/run/run-autoinstall.test.ts` (18 new tests, 17 fail without the fix) and `test/cli/install/bun-install-registry.test.ts` (1 new test). Also `npmrc.test.ts` and the fetch TLS, proxy and HTTP/3 suites.

### Background
- Auto-install: a script in a directory with no `node_modules` downloads the packages it imports.
- All requests of a process share one HTTP thread. Its default TLS context verifies `fetch()`. A CA on that context replaces the default certificates, which is correct only for `bun install`.
- A request can carry its own TLS config (`tls_props`). The HTTP thread keeps one TLS context per distinct config.
- Considered starting the runtime's HTTP thread with the CA, as `bun install` does. `fetch()` would then trust the install CA only, and a `fetch()` before the first import would start the thread without it.

### Downsides
- Auto-install with `ca` / `cafile` now trusts only that CA. A `cafile` that does not cover the registry, or `NODE_EXTRA_CA_CERTS` next to an unrelated `cafile`, installed before and fails now.
- With a CA, the process builds TLS contexts it did not build before: MEASUREMENT PENDING.
- Binary size: +2,816 bytes of text (release, linux-x64).
