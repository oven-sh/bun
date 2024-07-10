---
name: Build an app with SolidStart and Bun
---

{% callout %}
SolidStart currently relies on Node.js APIs that Bun does not yet implement. The guide below uses Bun to initialize a project and install dependencies, but it uses Node.js to run the dev server.
{% /callout %}

---

Initialize a SolidStart app with `create-solid`.

```sh
$ bun create solid my-app
create-solid version 0.2.31

Welcome to the SolidStart setup wizard!

There are definitely bugs and some feature might not work yet.
If you encounter an issue, have a look at
https://github.com/solidjs/solid-start/issues and open a new one,
if it is not already tracked.

✔ Which template do you want to use? › todomvc
✔ Server Side Rendering? … yes
✔ Use TypeScript? … yes
cloned solidjs/solid-start#main to /path/to/my-app/.solid-start
✔ Copied project files
```

---

As instructed by the `create-solid` CLI, let's install our dependencies.

```sh
$ cd my-app
$ bun install
```

---

Then run the development server.

```sh
$ bun run dev
# or, equivalently
$ bunx solid-start dev
```

---

Open [localhost:3000](http://localhost:3000). Any changes you make to `src/routes/index.tsx` will be hot-reloaded automatically.

{% image src="https://github.com/oven-sh/bun/assets/3084745/1e8043c4-49d1-498c-9add-c1eaab6c7167" alt="SolidStart demo app" /%}

---

Refer to the [SolidStart website](https://start.solidjs.com/getting-started/what-is-solidstart) for complete framework documentation.
