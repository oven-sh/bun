The `bun` CLI can be used to execute JavaScript/TypeScript files, `package.json` scripts, and [executable packages](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#bin).

<!-- ## Speed -->

<!--
Performance sensitive APIs like `Buffer`, `fetch`, and `Response` are heavily profiled and optimized. Under the hood Bun uses the [JavaScriptCore engine](https://developer.apple.com/documentation/javascriptcore), which is developed by Apple for Safari. It starts and runs faster than V8, the engine used by Node.js and Chromium-based browsers. -->

## Run a file

{% callout %}
Compare to `node <file>`
{% /callout %}

Use `bun run` to execute a source file.

```bash
$ bun run index.js
```

Bun supports TypeScript and JSX out of the box. Every file is transpiled on the fly by Bun's fast native transpiler before being executed.

```bash
$ bun run index.js
$ bun run index.jsx
$ bun run index.ts
$ bun run index.tsx
```

Alternatively, you can omit the `run` keyword and use the "naked" command; it behaves identically.

```bash
$ bun index.tsx
$ bun index.js
```

### `--watch`

To run a file in watch mode, use the `--watch` flag.

```bash
$ bun --watch run index.tsx
```

### `--smol`

In memory-constrained environments, use the `--smol` flag to reduce memory usage at a cost to performance.

```bash
$ bun --smol run index.tsx
```

## Run a `package.json` script

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

Use `bun <script>` or `bun run <script>` to execute these scripts.

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

### `--bun`

It's common for `package.json` scripts to reference locally-installed CLIs like `vite` or `next`. These CLIs are often JavaScript files marked with a [shebang](<https://en.wikipedia.org/wiki/Shebang_(Unix)>) to indicate that they should be executed with `node`.

```js
#!/usr/bin/env node

// do stuff
```

By default, Bun respects this shebang and executes the script with `node`. However, you can override this behavior with the `--bun` flag. For Node.js-based CLIs, this will run the CLI with Bun instead of Node.js.

```bash
$ bun run --bun vite
```

## Environment variables

Bun automatically loads environment variables from `.env` files before running a file, script, or executable. The following files are checked, in order:

1. `.env.local` (first)
2. `NODE_ENV` === `"production"` ? `.env.production` : `.env.development`
3. `.env`

To debug environment variables, run `bun run env` to view a list of resolved environment variables.

## Performance

Bun is designed to start fast and run fast.

Under the hood Bun uses the [JavaScriptCore engine](https://developer.apple.com/documentation/javascriptcore), which is developed by Apple for Safari. In most cases, the startup and running performance is faster than V8, the engine used by Node.js and Chromium-based browsers. Its transpiler and runtime are written in Zig, a modern, high-performance language. On Linux, this translates into startup times [4x faster](https://twitter.com/jarredsumner/status/1499225725492076544) than Node.js.

{% image src="/images/bun-run-speed.jpeg" caption="Bun vs Node.js vs Deno running Hello World" /%}

<!-- If no `node_modules` directory is found in the working directory or above, Bun will abandon Node.js-style module resolution in favor of the `Bun module resolution algorithm`. Under Bun-style module resolution, all packages are _auto-installed_ on the fly into a [global module cache](/docs/install/cache). For full details on this algorithm, refer to [Runtime > Modules](/docs/runtime/modules). -->
