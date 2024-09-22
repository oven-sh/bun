---
name: Migrate from npm install to bun install
---

`bun install` is a Node.js compatible npm client designed to be an incredibly fast replacement for `npm install`.

We've put a lot of work into making sure that the migration path from `npm install` to `bun install` is smooth and automatic.

- **Designed for Node.js & Bun**: `bun install` installs a Node.js compatible `node_modules` folder. You can use it in place of `npm install` for Node.js projects without any code changes.
- `bun install` automatically converts `package-lock.json` to bun's `bun.lockb` lockfile format, preserving your existing resolved dependency versions without any manual work on your part
- `bun install` reads npm registry configuration from npm's `.npmrc` as well as Bun's bunfig.toml
- On Windows and Linux, `bun install` uses hardlinks to conserve disk space and install times

To migrate from `npm install` to `bun install`, run `bun install`:

```bash
bun i
```

## Run package.json scripts and executables with `bun run`

To run a package.json script, you can use `bun <package.json script>`.

```sh
bun my-script

# This also works:
bun run my-script
```

This works for:

- package.json `"scripts"` (`npm run` equivalent)
- executables in `node_modules/.bin` (`npx` equivalent, for already-installed packages)
- JavaScript & TypeScript files (just like `node`)

If you're coming from npm, you might be used to running scripts with `npm run <script>` and packages with `npx <package>`. In Bun, we also support `bunx <package>`, but it's only needed when running executables which may not already be installed on your system or in your `node_modules/.bin`.

### Filter scripts by workspace name

In Bun, the `--filter` flag accepts a glob pattern, and will run the command concurrently for all workspace packages with a `name` that matches the pattern, respecting dependency order.

```sh
# equivalent to:
# npm run --workspace=@scope/frontend-app --workspace=@scope/frontend-design-system my-script
bun run --filter @scope/frontend* my-script
```

## Workspaces

`bun install` supports workspaces similarly to npm.

In package.json, you can set `"workspaces"` to an array of relative paths:

```json
{
  "name": "my-app",
  "workspaces": ["packages/*", "apps/*"]
}`
```

Then, run `bun install` in the root directory:

```bash
bun i
```

This will install the dependencies for all the workspaces, and symlink them together into the root `node_modules` folder.

We have some more information about workspaces in the [workspaces guide](/docs/install/workspaces).

## Update dependencies

To update a dependency, you can use `bun update <package>`. This will update the dependency to the latest version that satisfies the semver range specified in package.json.

```sh
bun update @types/bun
```

If you want to update all the dependencies in your project, you can use `bun update`. This will update all the dependencies in your project to the latest versions that satisfy the semver ranges specified in package.json.

```sh
bun update
```

If you want to forcefully update a dependency to the latest version, you can use `bun update --latest <package>`. This will ignore the semver range specified in package.json and update the dependency to the latest version.

```sh
bun update @types/bun --latest
```

## View outdated dependencies

To view outdated dependencies, run `bun outdated`. This is like `npm outdated` but with more compact output.

```sh
$ bun outdated
┌────────────────────────────────────────┬─────────┬────────┬────────┐
│ Package                                │ Current │ Update │ Latest │
├────────────────────────────────────────┼─────────┼────────┼────────┤
│ @types/bun (dev)                       │ 1.1.6   │ 1.1.10 │ 1.1.10 │
├────────────────────────────────────────┼─────────┼────────┼────────┤
│ @types/react (dev)                     │ 18.3.3  │ 18.3.8 │ 18.3.8 │
├────────────────────────────────────────┼─────────┼────────┼────────┤
│ @typescript-eslint/eslint-plugin (dev) │ 7.16.1  │ 7.18.0 │ 8.6.0  │
├────────────────────────────────────────┼─────────┼────────┼────────┤
│ @typescript-eslint/parser (dev)        │ 7.16.1  │ 7.18.0 │ 8.6.0  │
├────────────────────────────────────────┼─────────┼────────┼────────┤
│ @vscode/debugadapter (dev)             │ 1.66.0  │ 1.67.0 │ 1.67.0 │
├────────────────────────────────────────┼─────────┼────────┼────────┤
│ esbuild (dev)                          │ 0.21.5  │ 0.21.5 │ 0.24.0 │
├────────────────────────────────────────┼─────────┼────────┼────────┤
│ eslint (dev)                           │ 9.7.0   │ 9.11.0 │ 9.11.0 │
├────────────────────────────────────────┼─────────┼────────┼────────┤
│ mitata (dev)                           │ 0.1.11  │ 0.1.14 │ 1.0.2  │
├────────────────────────────────────────┼─────────┼────────┼────────┤
│ prettier-plugin-organize-imports (dev) │ 4.0.0   │ 4.1.0  │ 4.1.0  │
├────────────────────────────────────────┼─────────┼────────┼────────┤
│ source-map-js (dev)                    │ 1.2.0   │ 1.2.1  │ 1.2.1  │
├────────────────────────────────────────┼─────────┼────────┼────────┤
│ typescript (dev)                       │ 5.5.3   │ 5.6.2  │ 5.6.2  │
└────────────────────────────────────────┴─────────┴────────┴────────┘
```

## Create a package tarball

To create a package tarball, you can use `bun pack`. This will create a tarball of the package in the current directory.

```sh
bun pack
```
