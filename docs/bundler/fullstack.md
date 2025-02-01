As of Bun v1.1.44, we've added initial support for bundling frontend apps directly in Bun's HTTP server: `Bun.serve()`. Run your frontend and backend in the same app with no extra steps.

To get started, import your HTML files and pass them to the `static` option in `Bun.serve()`.

```ts
import dashboard from "./dashboard.html";
import homepage from "./index.html";

const server = Bun.serve({
  // Add HTML imports to `static`
  static: {
    // Bundle & route index.html to "/"
    "/": homepage,
    // Bundle & route dashboard.html to "/dashboard"
    "/dashboard": dashboard,
  },

  // Enable development mode for:
  // - Detailed error messages
  // - Rebuild on request
  development: true,

  // Handle API requests
  async fetch(req) {
    // ...your API code
    if (req.url.endsWith("/api/users")) {
      const users = await Bun.sql`SELECT * FROM users`;
      return Response.json(users);
    }

    // Return 404 for unmatched routes
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Listening on ${server.url}`)
```

```bash
$ bun run app.ts
```

## HTML imports are routes

The web starts with HTML, and so does Bun's fullstack dev server.

To specify entrypoints to your frontend, import HTML files into your JavaScript/TypeScript/TSX/JSX files.

```ts
import dashboard from "./dashboard.html";
import homepage from "./index.html";
```

These HTML files are used as routes in Bun's dev server you can pass to `Bun.serve()`.

```ts
Bun.serve({
  static: {
    "/": homepage,
    "/dashboard": dashboard,
  }

  fetch(req) {
    // ... api requests
  },
});
```

When you make a request to `/dashboard` or `/`, Bun automatically bundles the `<script>` and `<link>` tags in the HTML files, exposes them as static routes, and serves the result.

An index.html file like this:

```html#index.html
<!DOCTYPE html>
<html>
  <head>
    <title>Home</title>
    <link rel="stylesheet" href="./reset.css" />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./sentry-and-preloads.ts"></script>
    <script type="module" src="./my-app.tsx"></script>
  </body>
</html>
```

Becomes something like this:

```html#index.html
<!DOCTYPE html>
<html>
  <head>
    <title>Home</title>
    <link rel="stylesheet" href="/index-[hash].css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/index-[hash].js"></script>
  </body>
</html>
```

### How to use with React

To use React in your client-side code, import `react-dom/client` and render your app.

{% codetabs %}

```ts#src/backend.ts
import dashboard from "../public/dashboard.html";
import { serve } from "bun";

serve({
  static: {
    "/": dashboard,
  },

  async fetch(req) {
    // ...api requests
    return new Response("hello world");
  },
});
```

```ts#src/frontend.tsx
import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";

document.addEventListener("DOMContentLoaded", () => {
  const root = createRoot(document.getElementById("root"));
  root.render(<App />);
});
```

```html#public/dashboard.html
<!DOCTYPE html>
<html>
  <head>
    <title>Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="../src/frontend.tsx"></script>
  </body>
</html>
```

```css#src/styles.css
body {
  background-color: red;
}
```

```tsx#src/app.tsx
export function App() {
  return <div>Hello World</div>;
}
```

{% /codetabs %}

### Development mode

When building locally, enable development mode by setting `development: true` in `Bun.serve()`.

```js-diff
import homepage from "./index.html";
import dashboard from "./dashboard.html";

Bun.serve({
  static: {
    "/": homepage,
    "/dashboard": dashboard,
  }

+ development: true,

  fetch(req) {
    // ... api requests
  },
});
```

When `development` is `true`, Bun will:

- Include the `SourceMap` header in the response so that devtools can show the original source code
- Disable minification
- Re-bundle assets on each request to a .html file

#### Production mode

When serving your app in production, set `development: false` in `Bun.serve()`.

- Enable in-memory caching of bundled assets. Bun will bundle assets lazily on the first request to an `.html` file, and cache the result in memory until the server restarts.
- Enables `Cache-Control` headers and `ETag` headers
- Minifies JavaScript/TypeScript/TSX/JSX files

## Plugins

Bun's [bundler plugins](https://bun.sh/docs/bundler/plugins) are also supported when bundling static routes.

To configure plugins for `Bun.serve`, add a `plugins` array in the `[serve.static]` section of your `bunfig.toml`.

### Using TailwindCSS in HTML routes

For example, enable TailwindCSS on your routes by installing and adding the `bun-plugin-tailwind` plugin:

```sh
$ bun add bun-plugin-tailwind
```
```toml#bunfig.toml
[serve.static]
plugins = ["bun-plugin-tailwind"]
```

This will allow you to use TailwindCSS utility classes in your HTML and CSS files. All you need to do is import `tailwindcss` somewhere:

```html#index.html
<!doctype html>
<html>
  <head>
    <title>Home</title>
    <link rel="stylesheet" href="tailwindcss" />
  </head>
  <body>
    <!-- the rest of your HTML... -->
  </body>
</html>
```

Or in your CSS:

```css#style.css
@import "tailwindcss";
```

### Custom plugins

Any JS file or module which exports a [valid bundler plugin object](https://bun.sh/docs/bundler/plugins#usage) (essentially an object with a `name` and `setup` field) can be placed inside the `plugins` array:

```toml#bunfig.toml
[serve.static]
plugins = ["./my-plugin-implementation.ts"]
```

Bun will lazily resolve and load each plugin and use them to bundle your routes.

## How this works

Bun uses [`HTMLRewriter`](/docs/api/html-rewriter) to scan for `<script>` and `<link>` tags in HTML files, uses them as entrypoints for [Bun's bundler](/docs/bundler), generates an optimized bundle for the JavaScript/TypeScript/TSX/JSX and CSS files, and serves the result.

1. **`<script>` processing**

   - Transpiles TypeScript, JSX, and TSX in `<script>` tags
   - Bundles imported dependencies
   - Generates sourcemaps for debugging
   - Minifies when `development` is not `true` in `Bun.serve()`

   ```html
   <script type="module" src="./counter.tsx"></script>
   ```

2. **`<link>` processing**

   - Processes CSS imports and `<link>` tags
   - Concatenates CSS files
   - Rewrites `url` and asset paths to include content-addressable hashes in URLs

   ```html
   <link rel="stylesheet" href="./styles.css" />
   ```

3. **`<img>` & asset processing**

   - Links to assets are rewritten to include content-addressable hashes in URLs
   - Small assets in CSS files are inlined into `data:` URLs, reducing the total number of HTTP requests sent over the wire

4. **Rewrite HTML**

   - Combines all `<script>` tags into a single `<script>` tag with a content-addressable hash in the URL
   - Combines all `<link>` tags into a single `<link>` tag with a content-addressable hash in the URL
   - Outputs a new HTML file

5. **Serve**

   - All the output files from the bundler are exposed as static routes, using the same mechanism internally as when you pass a `Response` object to [`static` in `Bun.serve()`](/docs/api/http#static-routes).

This works similarly to how [`Bun.build` processes HTML files](/docs/bundler/html).

## This is a work in progress

- Client-side hot reloading isn't wired up yet. It will be in the future.
- This doesn't support `bun build` yet. It also will in the future.
