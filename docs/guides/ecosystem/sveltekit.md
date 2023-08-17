---
name: Build an app with SvelteKit and Bun
---

Use `bunx` to scaffold your app with the `create-svelte` CLI. Answer the prompts to slect a template and set up your development environment.

```sh
$ bunx create-svelte my-app
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
