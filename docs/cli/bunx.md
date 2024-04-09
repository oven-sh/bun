{% callout %}
**Note** — `bunx` is an alias for `bun x`. The `bunx` CLI will be auto-installed when you install `bun`.
{% /callout %}

Use `bunx` to auto-install and run packages from `npm`. It's Bun's equivalent of `npx` or `yarn dlx`.

```bash
$ bunx cowsay "Hello world!"
```

{% callout %}
⚡️ **Speed** — With Bun's fast startup times, `bunx` is [roughly 100x faster](https://twitter.com/jarredsumner/status/1606163655527059458) than `npx` for locally installed packages.
{% /callout %}

Packages can declare executables in the `"bin"` field of their `package.json`. These are known as _package executables_ or _package binaries_.

```jsonc#package.json
{
  // ... other fields
  "name": "my-cli",
  "bin": {
    "my-cli": "dist/index.js"
  }
}
```

These executables are commonly plain JavaScript files marked with a [shebang line](<https://en.wikipedia.org/wiki/Shebang_(Unix)>) to indicate which program should be used to execute them. The following file indicates that it should be executed with `node`.

```js#dist/index.js
#!/usr/bin/env node

console.log("Hello world!");
```

These executables can be run with `bunx`,

```bash
$ bunx my-cli
```

As with `npx`, `bunx` will check for a locally installed package first, then fall back to auto-installing the package from `npm`. Installed packages will be stored in Bun's global cache for future use.

## Arguments and flags

To pass additional command-line flags and arguments through to the executable, place them after the executable name.

```bash
$ bunx my-cli --foo bar
```

## Shebangs

By default, Bun respects shebangs. If an executable is marked with `#!/usr/bin/env node`, Bun will spin up a `node` process to execute the file. However, in some cases it may be desirable to run executables using Bun's runtime, even if the executable indicates otherwise. To do so, include the `--bun` flag.

```bash
$ bunx --bun my-cli
```

The `--bun` flag must occur _before_ the executable name. Flags that appear _after_ the name are passed through to the executable.

```bash
$ bunx --bun my-cli # good
$ bunx my-cli --bun # bad
```

To force bun to always be used with a script, use a shebang.

```
#!/usr/bin/env bun
```

<!-- ## Environment variables

Bun automatically loads environment variables from `.env` files before running a file, script, or executable. The following files are checked, in order:

1. `.env.local` (first)
2. `NODE_ENV` === `"production"` ? `.env.production` : `.env.development`
3. `.env`

To debug environment variables, run `bun --print process.env` to view a list of resolved environment variables. -->
