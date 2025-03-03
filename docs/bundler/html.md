Bun's bundler has first-class support for HTML. Build static sites, landing pages, and web applications with zero configuration. Just point Bun at your HTML file and it handles everything else.

```html#index.html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css" />
    <script src="./app.ts" type="module"></script>
  </head>
  <body>
    <img src="./logo.png" />
  </body>
</html>
```

To get started, pass HTML files to `bun`.

{% bunDevServerTerminal alt="bun ./index.html" path="./index.html" routes="" /%}

Bun's development server provides powerful features with zero configuration:

- **Automatic Bundling** - Bundles and serves your HTML, JavaScript, and CSS
- **Multi-Entry Support** - Handles multiple HTML entry points and glob entry points
- **Modern JavaScript** - TypeScript & JSX support out of the box
- **Smart Configuration** - Reads `tsconfig.json` for paths, JSX options, experimental decorators, and more
- **Plugins** - Plugins for TailwindCSS and more
- **ESM & CommonJS** - Use ESM and CommonJS in your JavaScript, TypeScript, and JSX files
- **CSS Bundling & Minification** - Bundles CSS from `<link>` tags and `@import` statements
- **Asset Management**
  - Automatic copying & hashing of images and assets
  - Rewrites asset paths in JavaScript, CSS, and HTML

## Single Page Apps (SPA)

When you pass a single .html file to Bun, Bun will use it as a fallback route for all paths. This makes it perfect for single page apps that use client-side routing:

{% bunDevServerTerminal alt="bun index.html" path="index.html" routes="" /%}

Your React or other SPA will work out of the box — no configuration needed. All routes like `/about`, `/users/123`, etc. will serve the same HTML file, letting your client-side router handle the navigation.

```html#index.html
<!doctype html>
<html>
  <head>
    <title>My SPA</title>
    <script src="./app.tsx" type="module"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

## Multi-page apps (MPA)

Some projects have several separate routes or HTML files as entry points. To support multiple entry points, pass them all to `bun`

{% bunDevServerTerminal alt="bun ./index.html ./about.html" path="./index.html ./about.html" routes="[{\"path\": \"/\", \"file\": \"./index.html\"}, {\"path\": \"/about\", \"file\": \"./about.html\"}]" /%}

This will serve:

- `index.html` at `/`
- `about.html` at `/about`

### Glob patterns

To specify multiple files, you can use glob patterns that end in `.html`:

{% bunDevServerTerminal alt="bun ./**/*.html" path="./**/*.html" routes="[{\"path\": \"/\", \"file\": \"./index.html\"}, {\"path\": \"/about\", \"file\": \"./about.html\"}]" /%}

### Path normalization

The base path is chosen from the longest common prefix among all the files.

{% bunDevServerTerminal alt="bun ./index.html ./about/index.html ./about/foo/index.html" path="./index.html ./about/index.html ./about/foo/index.html" routes="[{\"path\": \"/\", \"file\": \"./index.html\"}, {\"path\": \"/about\", \"file\": \"./about/index.html\"}, {\"path\": \"/about/foo\", \"file\": \"./about/foo/index.html\"}]" /%}

## JavaScript, TypeScript, and JSX

Bun's transpiler natively implements JavaScript, TypeScript, and JSX support. [Learn more about loaders in Bun](/docs/bundler/loaders).

Bun's transpiler is also used at runtime.

### ES Modules & CommonJS

You can use ESM and CJS in your JavaScript, TypeScript, and JSX files. Bun will handle the transpilation and bundling automatically.

There is no pre-build or separate optimization step. It's all done at the same time.

Learn more about [module resolution in Bun](/docs/runtime/modules).

## CSS

Bun's CSS parser is also natively implemented (clocking in around 58,000 lines of Zig).

It's also a CSS bundler. You can use `@import` in your CSS files to import other CSS files.

For example:

```css#styles.css
@import "./abc.css";

.container {
  background-color: blue;
}
```

```css#abc.css
body {
  background-color: red;
}
```

This outputs:

```css#styles.css
body {
  background-color: red;
}

.container {
  background-color: blue;
}
```

### Referencing local assets in CSS

You can reference local assets in your CSS files.

```css#styles.css
body {
  background-image: url("./logo.png");
}
```

This will copy `./logo.png` to the output directory and rewrite the path in the CSS file to include a content hash.

```css#styles.css
body {
  background-image: url("./logo-[ABC123].png");
}
```

### Importing CSS in JavaScript

To associate a CSS file with a JavaScript file, you can import it in your JavaScript file.

```ts#app.ts
import "./styles.css";
import "./more-styles.css";
```

This generates `./app.css` and `./app.js` in the output directory. All CSS files imported from JavaScript will be bundled into a single CSS file per entry point. If you import the same CSS file from multiple JavaScript files, it will only be included once in the output CSS file.

## Plugins

The dev server supports plugins.

### Tailwind CSS

To use TailwindCSS, install the `bun-plugin-tailwind` plugin:

```bash
# Or any npm client
$ bun install --dev bun-plugin-tailwind
```

Then, add the plugin to your `bunfig.toml`:

```toml
[serve.static]
plugins = ["bun-plugin-tailwind"]
```

Then, reference TailwindCSS in your HTML via `<link>` tag, `@import` in CSS, or `import` in JavaScript.

{% codetabs %}

```html#index.html
<!-- Reference TailwindCSS in your HTML -->
<link rel="stylesheet" href="tailwindcss" />
```

```css#styles.css
/* Import TailwindCSS in your CSS */
@import "tailwindcss";
```

```ts#app.ts
/* Import TailwindCSS in your JavaScript */
import "tailwindcss";
```

{% /codetabs %}

Only one of those are necessary, not all three.

## Keyboard Shortcuts

While the server is running:

- `o + Enter` - Open in browser
- `c + Enter` - Clear console
- `q + Enter` (or Ctrl+C) - Quit server

## Build for Production

When you're ready to deploy, use `bun build` to create optimized production bundles:

{% codetabs %}

```bash#CLI
$ bun build ./index.html --minify --outdir=dist
```

```ts#API
Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: {
    whitespace: true,
    identifiers: true,
    syntax: true,
  }
});
```

{% /codetabs %}

Currently, plugins are only supported through `Bun.build`'s API or through `bunfig.toml` with the frontend dev server - not yet supported in `bun build`'s CLI.

### Watch Mode

You can run `bun build --watch` to watch for changes and rebuild automatically. This works nicely for library development.

You've never seen a watch mode this fast.

### Plugin API

Need more control? Configure the bundler through the JavaScript API and use Bun's builtin `HTMLRewriter` to preprocess HTML.

```ts
await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: true,

  plugins: [
    {
      // A plugin that makes every HTML tag lowercase
      name: "lowercase-html-plugin",
      setup({ onLoad }) {
        const rewriter = new HTMLRewriter().on("*", {
          element(element) {
            element.tagName = element.tagName.toLowerCase();
          },
          text(element) {
            element.replace(element.text.toLowerCase());
          },
        });

        onLoad({ filter: /\.html$/ }, async args => {
          const html = await Bun.file(args.path).text();

          return {
            // Bun's bundler will scan the HTML for <script> tags, <link rel="stylesheet"> tags, and other assets
            // and bundle them automatically
            contents: rewriter.transform(html),
            loader: "html",
          };
        });
      },
    },
  ],
});
```

## What Gets Processed?

Bun automatically handles all common web assets:

- Scripts (`<script src>`) are run through Bun's JavaScript/TypeScript/JSX bundler
- Stylesheets (`<link rel="stylesheet">`) are run through Bun's CSS parser & bundler
- Images (`<img>`, `<picture>`) are copied and hashed
- Media (`<video>`, `<audio>`, `<source>`) are copied and hashed
- Any `<link>` tag with an `href` attribute pointing to a local file is rewritten to the new path, and hashed

All paths are resolved relative to your HTML file, making it easy to organize your project however you want.

## This is a work in progress

- No HMR support yet
- Need more plugins
- Need more configuration options for things like asset handling
- Need a way to configure CORS, headers, etc.

If you want to submit a PR, most of the [code is here](https://github.com/oven-sh/bun/blob/main/src/js/internal/html.ts). You could even copy paste that file into your project and use it as a starting point.

## How this works

This is a small wrapper around Bun's support for HTML imports in JavaScript.

### Adding a backend to your frontend

To add a backend to your frontend, you can use the `"routes"` option in `Bun.serve`.

Learn more in [the full-stack docs](/docs/bundler/fullstack).
