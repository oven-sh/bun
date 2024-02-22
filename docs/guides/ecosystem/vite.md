---
name: Build a frontend using Vite and Bun
---

{% callout %}
While Vite currently works with Bun, it has not been heavily optimized, nor has Vite been adapted to use Bun's bundler, module resolver, or transpiler.
{% /callout %}

---

Vite works out of the box with Bun. Get started with one of Vite's templates.

```bash
$ bun create vite my-app
✔ Select a framework: › React
✔ Select a variant: › TypeScript + SWC
Scaffolding project in /path/to/my-app...
```

---

Then `cd` into the project directory and install dependencies.

```bash
cd my-app
bun install
```

---

Start the development server with the `vite` CLI using `bunx`.

The `--bun` flag tells Bun to run Vite's CLI using `bun` instead of `node`; by default Bun respects Vite's `#!/usr/bin/env node` [shebang line](<https://en.wikipedia.org/wiki/Shebang_(Unix)>).
```bash
bunx --bun vite
```

---

To simplify this command, update the `"dev"` script in `package.json` to the following.

```json-diff#package.json
  "scripts": {
-   "dev": "vite",
+   "dev": "bunx --bun vite",
    "build": "vite build",
    "serve": "vite preview"
  },
  // ...
```

---

Now you can start the development server with `bun run dev`.

```bash
bun run dev
```

---

The following command will build your app for production.

```sh
$ bunx --bun vite build
```

---

This is a stripped down guide to get you started with Vite + Bun. For more information, see the [Vite documentation](https://vitejs.dev/guide/).
