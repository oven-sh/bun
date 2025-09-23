Context
- Repo: oven-sh/bun (workspace path: packages/bun-vscode)
- Feature: VS Code extension test runner (Bun Test Explorer)
- Issue: Tests timed out with “Timeout waiting for Bun to connect” on Unix.

Root Cause
- Extension created a UNIX-domain socket server but also launched Bun with `--inspect-wait=unix://…`.
- Both sides ended up LISTENING on a UNIX socket with no client to connect → Bun waited forever, extension timed out.

Fix Implemented
- Always use a TCP reverse-connection socket for the test runner on all platforms.
- Pass inspector target via env: `BUN_INSPECT=tcp://127.0.0.1:<port>?wait=1` so Bun connects back to us and waits before executing tests.
- File changed: `packages/bun-vscode/src/features/tests/bun-test-controller.ts`
  - `createSignal()` now returns `new TCPSocketSignal(await getAvailablePort())` on all platforms.
  - `inspectorUrl` becomes `tcp://127.0.0.1:<port>?wait=1`, so `BUN_INSPECT` is set and we do not rely on `--inspect-wait`.
- Unrelated edits reverted (version, build script).

Branch/PR
- Branch: `claude/fix-vscode-test-runner-inspect-timeout` (pushed to fork)
- Fork: https://github.com/the-vindex/bun
- PR: https://github.com/oven-sh/bun/pull/22908

How to Verify Locally
1) Install the extension VSIX or run from source.
2) Trigger a test run from the Testing panel.
3) Ensure spawned Bun process does NOT include `--inspect-wait=unix://…`.
4) Observe that the run proceeds without the 10s timeout and test events stream in.

Packaging commands
- Bun: `bun run build` (packages + VSIX under `packages/bun-vscode/extension/*.vsix`)
- Node: `node scripts/build.mjs`
- Install into Cursor: `cursor --install-extension extension/*.vsix`

Follow-ups (optional)
- Add a short “Test plan” section to PR.
- Consider logging the effective `BUN_INSPECT` URL in the test run output for easier diagnostics.
- Double-check Windows behavior (should be unchanged, still TCP).

Notes
- The diagnostics socket feature separately injects `BUN_INSPECT_NOTIFY` etc.; not modified here.
