The `bun` CLI can be used to execute JavaScript/TypeScript files, `package.json` scripts, and [executable packages](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#bin).

## Running a file

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

## Running a package script

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
