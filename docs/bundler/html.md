As of Bun v1.1.43, Bun's bundler now has first-class support for HTML. Build static sites, landing pages, and web applications with zero configuration. Just point Bun at your HTML file and it handles everything else.

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

One command is all you need (won't be experimental after Bun v1.2):

{% codetabs %}

```bash#CLI
$ bun build --experimental-html --experimental-css ./index.html --outdir=dist
```

```ts#API
Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",

  // On by default in Bun v1.2+
  html: true,
  experimentalCss: true,
});
```

{% /codetabs %}

Bun automatically:

- Bundles, tree-shakes, and optimizes your JavaScript, JSX and TypeScript
- Bundles and optimizes your CSS
- Copies & hashes images and other assets
- Updates all references to local files or packages in your HTML

## Zero Config, Maximum Performance

The HTML bundler is enabled by default after Bun v1.2+. Drop in your existing HTML files and Bun will handle:

- **TypeScript & JSX** - Write modern JavaScript for browsers without the setup
- **CSS** - Bundle CSS stylesheets directly from `<link rel="stylesheet">` or `@import`
- **Images & Assets** - Automatic copying & hashing & rewriting of assets in JavaScript, CSS, and HTML

## Watch mode

You can run `bun build --watch` to watch for changes and rebuild automatically.

You've never seen a watch mode this fast.

## Plugin API

Need more control? Configure the bundler through the JavaScript API and use Bun's builtin `HTMLRewriter` to preprocess HTML.

```ts
await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  html: true,
  experimentalCss: true,
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
