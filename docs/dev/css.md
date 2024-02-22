## With `bun dev`

When importing CSS in JavaScript-like loaders, CSS is treated special.

By default, Bun will transform a statement like this:

```js
import "../styles/global.css";
```

### When `platform` is `browser`

```js
globalThis.document?.dispatchEvent(
  new CustomEvent("onimportcss", {
    detail: "http://localhost:3000/styles/globals.css",
  }),
);
```

An event handler for turning that into a `<link>` is automatically registered when HMR is enabled. That event handler can be turned off either in a framework’s `package.json` or by setting `globalThis["Bun_disableCSSImports"] = true;` in client-side code. Additionally, you can get a list of every .css file imported this way via `globalThis["__BUN"].allImportedStyles`.

### When `platform` is `bun`

```js
//@import url("http://localhost:3000/styles/globals.css");
```

Additionally, Bun exposes an API for SSR/SSG that returns a flat list of URLs to css files imported. That function is `Bun.getImportedStyles()`.

```ts
// This specifically is for "framework" in package.json when loaded via `bun dev`
// This API needs to be changed somewhat to work more generally with Bun.js
// Initially, you could only use Bun.js through `bun dev`
// and this API was created at that time
addEventListener("fetch", async (event: FetchEvent) => {
  let route = Bun.match(event);
  const App = await import("pages/_app");

  // This returns all .css files that were imported in the line above.
  // It’s recursive, so any file that imports a CSS file will be included.
  const appStylesheets = bun.getImportedStyles();

  // ...rest of code
});
```

This is useful for preventing flash of unstyled content.

## With `bun bun`

Bun bundles `.css` files imported via `@import` into a single file. It doesn’t auto-prefix or minify CSS today. Multiple `.css` files imported in one JavaScript file will _not_ be bundled into one file. You’ll have to import those from a `.css` file.

This input:

```css
@import url("./hi.css");
@import url("./hello.css");
@import url("./yo.css");
```

Becomes:

```css
/* hi.css */
/* ...contents of hi.css */
/* hello.css */
/* ...contents of hello.css */
/* yo.css */
/* ...contents of yo.css */
```

## CSS runtime

To support hot CSS reloading, Bun inserts `@supports` annotations into CSS that tag which files a stylesheet is composed of. Browsers ignore this, so it doesn’t impact styles.

By default, Bun’s runtime code automatically listens to `onimportcss` and will insert the `event.detail` into a `<link rel="stylesheet" href={${event.detail}}>` if there is no existing `link` tag with that stylesheet. That’s how Bun’s equivalent of `style-loader` works.
