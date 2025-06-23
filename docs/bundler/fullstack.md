To get started, import HTML files and pass them to the `routes` option in `Bun.serve()`.

```ts
import { sql, serve } from "bun";
import dashboard from "./dashboard.html";
import homepage from "./index.html";

const server = serve({
  routes: {
    // ** HTML imports **
    // Bundle & route index.html to "/". This uses HTMLRewriter to scan the HTML for `<script>` and `<link>` tags, run's Bun's JavaScript & CSS bundler on them, transpiles any TypeScript, JSX, and TSX, downlevels CSS with Bun's CSS parser and serves the result.
    "/": homepage,
    // Bundle & route dashboard.html to "/dashboard"
    "/dashboard": dashboard,

    // ** API endpoints ** (Bun v1.2.3+ required)
    "/api/users": {
      async GET(req) {
        const users = await sql`SELECT * FROM users`;
        return Response.json(users);
      },
      async POST(req) {
        const { name, email } = await req.json();
        const [user] =
          await sql`INSERT INTO users (name, email) VALUES (${name}, ${email})`;
        return Response.json(user);
      },
    },
    "/api/users/:id": async req => {
      const { id } = req.params;
      const [user] = await sql`SELECT * FROM users WHERE id = ${id}`;
      return Response.json(user);
    },
  },

  // Enable development mode for:
  // - Detailed error messages
  // - Hot reloading (Bun v1.2.3+ required)
  development: true,

  // Prior to v1.2.3, the `fetch` option was used to handle all API requests. It is now optional.
  // async fetch(req) {
  //   // Return 404 for unmatched routes
  //   return new Response("Not Found", { status: 404 });
  // },
});

console.log(`Listening on ${server.url}`);
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
  routes: {
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
  routes: {
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
  routes: {
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
- Enable hot module reloading (unless `hmr: false` is set)

#### Echo console logs from browser to terminal

Bun.serve() supports echoing console logs from the browser to the terminal.

To enable this, pass `console: true` in the `development` object in `Bun.serve()`.

```ts
import homepage from "./index.html";

Bun.serve({
  // development can also be an object.
  development: {
    // Enable Hot Module Reloading
    hmr: true,

    // Echo console logs from the browser to the terminal
    console: true,
  },

  routes: {
    "/": homepage,
  },
});
```

When `console: true` is set, Bun will stream console logs from the browser to the terminal. This reuses the existing WebSocket connection from HMR to send the logs.

#### Production mode

Hot reloading and `development: true` helps you iterate quickly, but in production, your server should be as fast as possible and have as few external dependencies as possible.

##### Ahead of time bundling (recommended)

As of Bun v1.2.17, you can use `Bun.build` or `bun build` to bundle your full-stack application ahead of time.

```sh
$ bun build --target=bun --production --outdir=dist ./src/index.ts
```

When Bun's bundler sees an HTML import from server-side code, it will bundle the referenced JavaScript/TypeScript/TSX/JSX and CSS files into a manifest object that Bun.serve() can use to serve the assets.

```ts
import { serve } from "bun";
import index from "./index.html";

serve({
  routes: { "/": index },
});
```

{% details summary="Internally, the `index` variable is a manifest object that looks something like this" %}

```json
{
  "index": "./index.html",
  "files": [
    {
      "input": "index.html",
      "path": "./index-f2me3qnf.js",
      "loader": "js",
      "isEntry": true,
      "headers": {
        "etag": "eet6gn75",
        "content-type": "text/javascript;charset=utf-8"
      }
    },
    {
      "input": "index.html",
      "path": "./index.html",
      "loader": "html",
      "isEntry": true,
      "headers": {
        "etag": "r9njjakd",
        "content-type": "text/html;charset=utf-8"
      }
    },
    {
      "input": "index.html",
      "path": "./index-gysa5fmk.css",
      "loader": "css",
      "isEntry": true,
      "headers": {
        "etag": "50zb7x61",
        "content-type": "text/css;charset=utf-8"
      }
    },
    {
      "input": "logo.svg",
      "path": "./logo-kygw735p.svg",
      "loader": "file",
      "isEntry": false,
      "headers": {
        "etag": "kygw735p",
        "content-type": "application/octet-stream"
      }
    },
    {
      "input": "react.svg",
      "path": "./react-ck11dneg.svg",
      "loader": "file",
      "isEntry": false,
      "headers": {
        "etag": "ck11dneg",
        "content-type": "application/octet-stream"
      }
    }
  ]
}
```

{% /details %}

##### Runtime bundling

When adding a build step is too complicated, you can set `development: false` in `Bun.serve()`.

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

Note: this is currently in `bunfig.toml` to make it possible to know statically which plugins are in use when we eventually integrate this with the `bun build` CLI. These plugins work in `Bun.build()`'s JS API, but are not yet supported in the CLI.

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

- This doesn't support `bun build` yet. It also will in the future.
