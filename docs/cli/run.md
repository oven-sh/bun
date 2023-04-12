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
$ bun index.js
```

Bun supports TypeScript and JSX out of the box. Every file is transpiled on the fly by Bun's fast native transpiler before being executed.

```bash
$ bun index.js
$ bun index.jsx
$ bun index.ts
$ bun index.tsx
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

## Environment variables

Bun automatically loads environment variables from `.env` files before running a file, script, or executable. The following files are checked, in order:

1. `.env.local` (first)
2. `NODE_ENV` === `"production"` ? `.env.production` : `.env.development`
3. `.env`

To debug environment variables, run `bun run env` to view a list of resolved environment variables.
