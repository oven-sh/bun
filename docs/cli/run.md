The `bun` CLI can be used to execute JavaScript/TypeScript files, `package.json` scripts, and [executable packages](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#bin).

## Run a file

{% callout %}
Compare to `node <file>`
{% /callout %}

Bun can execute `.js`, `.jsx`, `.ts`, and `.tsx` files. Every file is transpiled to vanilla JavaScript by Bun's fast native transpiler before being executed. For details on Bun's runtime, refer to the [Bun runtime](/docs/runtime) documentation.

```ts#foo.ts
import { z } from "zod";

const schema = z.string()
const result = schema.parse("Billie Eilish");
console.log(result);
```

To run a file in Bun:

```bash
$ bun foo.ts
Billie Eilish
```

If no `node_modules` directory is found in the working directory or above, Bun will abandon Node.js-style module resolution in favor of the `Bun module resolution algorithm`. Under Bun-style module resolution, all packages are _auto-installed_ on the fly into a [global module cache](/docs/cli/install#global-cache). For full details on this algorithm, refer to [Runtime > Modules](/docs/runtime/modules).

## Run a package script

{% note %}
Compare to `npm run <script>` or `yarn <script>`
{% /note %}

Your `package.json` can define a number of named `"scripts"` that correspond to shell commands.

```jsonc
{
  // ... other fields
  "scripts": {
    "clean": "rm -rf dist && echo 'Done.'",
    "dev": "bun server.ts"
  }
}
```

Use `bun <script>` to execute these scripts.

```bash
$ bun clean
 $ rm -rf dist && echo 'Done.'
 Cleaning...
 Done.
```

Bun executes the script command in a subshell. It checks for the following shells in order, using the first one it finds: `bash`, `sh`, `zsh`.

{% callout %}
⚡️ The startup time for `npm run` on Linux is roughly 170ms; with Bun it is `6ms`.
{% /callout %}

If there is a name conflict between a `package.json` script and a built-in `bun` command (`install`, `dev`, `upgrade`, etc.) Bun's built-in command takes precedence. In this case, use the more explicit `bun run` command to execute your package script.

```bash
$ bun run dev
```

To see a list of available scripts, run `bun run` without any arguments.

```bash
$ bun run
quickstart scripts:

 bun run clean
   rm -rf dist && echo 'Done.'

 bun run dev
   bun server.ts

2 scripts
```

Bun respects lifecycle hooks. For instance, `bun run clean` will execute `preclean` and `postclean`, if defined. If the `pre<script>` fails, Bun will not execute the script itself.

## Run an executable

{% callout %}
Compare to `npx <command>`
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

These executables can be run with `bunx`, Bun's equivalent of `npx`.

{% callout %}
⚡️ **Speed** — With Bun's fast startup times, `bunx` is [roughly 100x faster](https://twitter.com/jarredsumner/status/1606163655527059458) than `npx` for locally installed packages.
{% /callout %}

```bash
$ bunx my-cli
```

As with `npx`, `bunx` will check for a locally installed package first, then fall back to auto-installing the package from `npm`. Installed packages will be stored in Bun's global cache for future use.

### Arguments and flags

To pass additional command-line flags and arguments through to the executable:

```bash
$ bunx my-cli --foo bar
```

### Shebangs

By default, Bun respects shebangs. If an executable is marked with `#!/usr/bin/env node`, Bun will spin up a `node` process to execute the file. However, in some cases it may be desirable to run executables using [Bun's runtime](/docs/runtime), even if the executable indicates otherwise. To do so, include the `--bun` flag.

```bash
$ bunx --bun my-cli
```

{% callout %}
**Note** — The `--bun` flag must occur _before_ the executable name. Flags that appear _after_ the name are passed through to the executable.

```bash
$ bunx --bun my-cli # good
$ bunx my-cli --bun # bad
```

{% /callout %}

## Environment variables

Bun automatically loads environment variables from `.env` files before running a file, script, or executable. The following files are checked, in order:

1. `.env.local` (first)
2. `NODE_ENV` === `"production"` ? `.env.production` : `.env.development`
3. `.env`

To debug environment variables, run `bun run env` to view a list of resolved environment variables.
