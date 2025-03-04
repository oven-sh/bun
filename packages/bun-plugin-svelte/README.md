<p align="center">
  <a href="https://bun.sh"><img src="https://github.com/user-attachments/assets/50282090-adfd-4ddb-9e27-c30753c6b161" alt="Logo" height=170></a>
</p>
<h1 align="center"><code>bun-plugin-svelte</code></h1>

The official [Svelte](https://svelte.dev/) plugin for [Bun](https://bun.sh/).

## Installation

```sh
bun add -D bun-plugin-svelte
```

## Dev Server Usage

`bun-plugin-svelte` integrates with Bun's [Fullstack Dev Server](https://bun.sh/docs/bundler/fullstack), giving you
HMR when developing your Svelte app.

```html
<!-- index.html -->
<html>
  <head>
    <script type="module" src="./index.ts"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

```ts
// index.ts

import { mount, unmount } from "svelte";
import App from "./App.svelte";

// mount the application entrypoint to the DOM
const root = document.getElementById("root")!;
const app = mount(App, { target: root });
```

```svelte
<!-- App.svelte -->

<script lang="ts">
  // out-of-the-box typescript support
  let name: string = "Bun";
</script>

<main class="app">
  <h1>Cookin up apps with {name}</h1>
</main>

<style>
  h1 {
      color: #ff3e00;
      text-align: center;
      font-size: 2em;
  }
</style>
```

## Bundler Usage

```ts
// build.ts
// to use: bun run build.ts
import { SveltePlugin } from "bun-plugin-svelte"; // NOTE: not published to npm yet

Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "browser", // use "bun" or "node" to use Svelte components server-side
  sourcemap: true, // sourcemaps not yet supported
  plugins: [
    SveltePlugin({
      development: true, // turn off for prod builds. Defaults to false
    }),
  ],
});
```

## Server-Side Usage

`bun-plugin-svelte` does not yet support server-side imports (e.g. for SSR).
This will be added in the near future.
