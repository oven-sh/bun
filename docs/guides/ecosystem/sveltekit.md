---
name: Build an app with SvelteKit and Bun
---

Use `sv create my-app` to create a SvelteKit project with SvelteKit CLI. Answer the prompts to select a template and set up your development environment.

```sh
$ bunx sv create my-app
┌  Welcome to the Svelte CLI! (v0.5.7)
│
◇  Which template would you like?
│  SvelteKit demo
│
◇  Add type checking with Typescript?
│  Yes, using Typescript syntax
│
◆  Project created
│
◇  What would you like to add to your project?
│  none
│
◇  Which package manager do you want to install dependencies with?
│  bun
│
◇  Successfully installed dependencies
│
◇  Project next steps ─────────────────────────────────────────────────────╮
│                                                                          │
│  1: cd my-app                                                            │
│  2: git init && git add -A && git commit -m "Initial commit" (optional)  │
│  3: bun run dev -- --open                                                │
│                                                                          │
│  To close the dev server, hit Ctrl-C                                     │
│                                                                          │
│  Stuck? Visit us at https://svelte.dev/chat                              │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────╯
│
└  You're all set!
```

---

Once the project is initialized, `cd` into the new project. You don't need to run 'bun install' since the dependencies are already installed.

Then start the development server with `bun --bun run dev`.

To run the dev server with Node.js instead of Bun, you can omit the `--bun` flag.

```sh
$ cd my-app
$ bun --bun run dev
  $ vite dev
  Forced re-optimization of dependencies
  
    VITE v5.4.10  ready in 424 ms
  
    ➜  Local:   http://localhost:5173/
    ➜  Network: use --host to expose
    ➜  press h + enter to show help
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
  import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

  /** @type {import('@sveltejs/kit').Config} */
  const config = {
  	// Consult https://svelte.dev/docs/kit/integrations#preprocessors
  	// for more information about preprocessors
  	preprocess: vitePreprocess(),
  
  	kit: {
  		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
  		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
  		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
  		adapter: adapter()
  	}
  };
  
  export default config;
```

---

To build a production bundle:

```sh
$ bun --bun run build
  $ vite build
  vite v5.4.10 building SSR bundle for production...
  "confetti" is imported from external module "@neoconfetti/svelte" but never used in "src/routes/sverdle/+page.svelte".
  ✓ 130 modules transformed.
  vite v5.4.10 building for production...
  ✓ 148 modules transformed.
  ...
  ✓ built in 231ms
  ...
  ✓ built in 899ms
  
  Run npm run preview to preview your production build locally.
  
  > Using svelte-adapter-bun
    ✔ Start server with: bun ./build/index.js
    ✔ done
```
