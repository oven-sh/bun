Let's write a simple HTTP server using the built-in `Bun.serve` API. First, create a fresh directory.

```bash
$ mkdir quickstart
$ cd quickstart
```

Run `bun init` to scaffold a new project. It's an interactive tool; for this tutorial, just press `enter` to accept the default answer for each prompt.

```bash
$ bun init
bun init helps you get started with a minimal project and tries to
guess sensible defaults. Press ^C anytime to quit.

package name (quickstart):
entry point (index.ts):

Done! A package.json file was saved in the current directory.
 + index.ts
 + .gitignore
 + tsconfig.json (for editor auto-complete)
 + README.md

To get started, run:
  bun run index.ts
```

Since our entry point is a `*.ts` file, Bun generates a `tsconfig.json` for you. If you're using plain JavaScript, it will generate a [`jsconfig.json`](https://code.visualstudio.com/docs/languages/jsconfig) instead.

## Run a file

Open `index.ts` and paste the following code snippet, which implements a simple HTTP server with [`Bun.serve`](https://bun.sh/docs/api/http).

```ts
const server = Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Bun!");
  },
});

console.log(`Listening on http://localhost:${server.port} ...`);
```

{% details summary="Seeing TypeScript errors on `Bun`?" %}
If you used `bun init`, Bun will have automatically installed Bun's TypeScript declarations and configured your `tsconfig.json`. If you're trying out Bun in an existing project, you may see a type error on the `Bun` global.

To fix this, first install `@types/bun` as a dev dependency.

```sh
$ bun add -d @types/bun
```

Then add the following to your `compilerOptions` in `tsconfig.json`:

```json#tsconfig.json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
  }
}
```

{% /details %}

Run the file from your shell.

```bash
$ bun index.ts
Listening on http://localhost:3000 ...
```

Visit [http://localhost:3000](http://localhost:3000) to test the server. You should see a simple page that says "Bun!".

## Run a script

Bun can also execute `"scripts"` from your `package.json`. Add the following script:

```json-diff
  {
    "name": "quickstart",
    "module": "index.ts",
    "type": "module",
+   "scripts": {
+     "start": "bun run index.ts"
+   },
    "devDependencies": {
      "@types/bun": "latest"
    }
  }
```

Then run it with `bun run start`.

```bash
$ bun run start
  $ bun run index.ts
  Listening on http://localhost:3000 ...
```

{% callout %}
⚡️ **Performance** — `bun run` is roughly 28x faster than `npm run` (6ms vs 170ms of overhead).
{% /callout %}

## Install a package

Let's make our server a little more interesting by installing a package. First install the `figlet` package and its type declarations. Figlet is a utility for converting strings into ASCII art.

```bash
$ bun add figlet
$ bun add -d @types/figlet # TypeScript users only
```

Update `index.ts` to use `figlet` in the `fetch` handler.

```ts-diff
+ import figlet from "figlet";

  const server = Bun.serve({
    port: 3000,
    fetch(req) {
+     const body = figlet.textSync("Bun!");
+     return new Response(body);
-     return new Response("Bun!");
    },
  });
```

Restart the server and refresh the page. You should see a new ASCII art banner.

```txt
  ____              _
 | __ ) _   _ _ __ | |
 |  _ \| | | | '_ \| |
 | |_) | |_| | | | |_|
 |____/ \__,_|_| |_(_)
```
