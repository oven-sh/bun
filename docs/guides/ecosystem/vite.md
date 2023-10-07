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

Now you can start the development server with `bun run dev`.

```bash
bun run dev
```

---

This is a stripped down guide to get you started with Vite + Bun. For more information, see the [Vite documentation](https://vitejs.dev/guide/).
