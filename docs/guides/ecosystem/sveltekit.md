---
name: Build an app with SvelteKit and Bun
---

Use `bun create` to scaffold your app with the `svelte` package. Answer the prompts to select a template and set up your development environment.

```sh
$ bun create svelte@latest my-app
┌  Welcome to SvelteKit!
│
◇  Which Svelte app template?
│  SvelteKit demo app
│
◇  Add type checking with TypeScript?
│  Yes, using TypeScript syntax
│
◇  Select additional options (use arrow keys/space bar)
│  None
│
└  Your project is ready!

✔ Typescript
  Inside Svelte components, use <script lang="ts">

Install community-maintained integrations:
  https://github.com/svelte-add/svelte-add
```

---

Once the project is initialized, `cd` into the new project and install dependencies.

```sh
$ cd my-app
$ bun install
```

---

Then start the development server with `bun --bun run dev`.

To run the dev server with Node.js instead of Bun, you can omit the `--bun` flag.

```sh
$ bun --bun run dev
  $ vite dev

  Forced re-optimization of dependencies

    VITE v4.4.9  ready in 895 ms

    ➜  Local:   http://localhost:5173/
    ➜  Network: use --host to expose
    ➜  press h to show help
```

---

Visit [http://localhost:5173](http://localhost:5173/) in a browser to see the template app.

{% image src="https://github.com/oven-sh/bun/assets/3084745/7c76eae8-78f9-44fa-9f15-1bd3ca1a47c0" /%}

---

If you edit and save `src/routes/+page.svelte`, you should see your changes hot-reloaded in the browser.

---

To build for production, you'll need to add the right SvelteKit adapter. Currently we recommend the

`bun add -D svelte-adapter-bun`.

Now, make the following changes to your `svelte.config.js`.

```ts-diff
- import adapter from "@sveltejs/adapter-auto";
+ import adapter from "svelte-adapter-bun";
  import { vitePreprocess } from "@sveltejs/kit/vite";

  /** @type {import('@sveltejs/kit').Config} */
  const config = {
    kit: {
      adapter: adapter(),
    },
    preprocess: vitePreprocess(),
  };

  export default config;
```

---

To build a production bundle:

```sh
$ bun run build
 $ vite build

vite v4.4.9 building SSR bundle for production...
transforming (60) node_modules/@sveltejs/kit/src/utils/escape.js

✓ 98 modules transformed.
Generated an empty chunk: "entries/endpoints/waitlist/_server.ts".

vite v4.4.9 building for production...
✓ 92 modules transformed.
Generated an empty chunk: "7".
.svelte-kit/output/client/_app/version.json      0.03 kB │ gzip:  0.05 kB

...

.svelte-kit/output/server/index.js               86.47 kB

Run npm run preview to preview your production build locally.

> Using svelte-adapter-bun
  ✔ Start server with: bun ./build/index.js
  ✔ done
✓ built in 7.81s
```
