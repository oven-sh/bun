<!-- status -->
**Reproduced** on a debug build of main `5866b5f13d` (linux-x64, local registries):

1. A project `bunfig.toml` with `[install.scopes] bun13247test = { url = "<scope registry>" }`, and `npm_config_registry=<default registry>`.
2. `bun create @bun13247test/package` prints `error: GET <default registry>/@bun13247test%2fcreate-package - 404`. The scope registry gets no request.
3. `bunx` does the same with a registry or a scope in the project's `bunfig.toml` or `.npmrc`.

With this PR the request goes to the registry that the project names.

**State:** reworked on top of #45307. The two earlier versions of this PR are gone. Tests: `test/cli/install/bunx.test.ts` (`the project's registries`, 62 tests, 37 fail on main) and `test/cli/install/bun-create.test.ts` (4 tests, 4 fail on main). The PR body lists four choices that need a maintainer's decision.
