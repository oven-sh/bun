<!-- This document is a work in progress. It's not currently included in the actual docs. -->

The goal of this document is to break down why bundling is necessary, how it works, and how the bundler became such a key part of modern JavaScript development. The content is not specific to Bun's bundler, but is rather aimed at anyone looking for a greater understanding of how bundlers work and, by extension, how most modern frameworks are implemented.

## What is bundling

With the adoption of ECMAScript modules (ESM), browsers can now resolve `import`/`export` statements in JavaScript files loaded via `<script>` tags.

{% codetabs %}

```html#index.html
<html>
  <head>
    <script type="module" src="/index.js" ></script>
  </head>
</html>
```

```js#index.js
import {sayHello} from "./hello.js";

sayHello();
```

```js#hello.js
export function sayHello() {
  console.log("Hello, world!");
}
```

{% /codetabs %}

When a user visits this website, the files are loaded in the following order:

{% image src="/images/module_loading_unbundled.png" /%}

{% callout %}
**Relative imports** — Relative imports are resolved relative to the URL of the importing file. Because we're importing `./hello.js` from `/index.js`, the browser resolves it to `/hello.js`. If instead we'd imported `./hello.js` from `/src/index.js`, the browser would have resolved it to `/src/hello.js`.
{% /callout %}

This approach works, it requires three round-trip HTTP requests before the browser is ready to render the page. On slow internet connections, this may add up to a non-trivial delay.

This example is extremely simplistic. A modern app may be loading dozens of modules from `node_modules`, each consisting of hundred of files. Loading each of these files with a separate HTTP request becomes untenable very quickly. While most of these requests will be running in parallel, the number of round-trip requests can still be very high; plus, there are limits on how many simultaneous requests a browser can make.

{% callout %}
Some recent advances like modulepreload and HTTP/3 are intended to solve some of these problems, but at the moment bundling is still the most performant approach.
{% /callout %}

The answer: bundling.

## Entrypoints

A bundler accepts an "entrypoint" to your source code (in this case, `/index.js`) and outputs a single file containing all of the code needed to run your app. If does so by parsing your source code, reading the `import`/`export` statements, and building a "module graph" of your app's dependencies.

{% image src="/images/bundling.png" /%}

We can now load `/bundle.js` from our `index.html` file and eliminate a round trip request, decreasing load times for our app.

{% image src="/images/module_loading_bundled.png" /%}

## Loaders

Bundlers typically have some set of built-in "loaders".

## Transpilation

The JavaScript files above are just that: plain JavaScript. They can be directly executed by any modern browser.

But modern tooling goes far beyond HTML, JavaScript, and CSS. JSX, TypeScript, and PostCSS/CSS-in-JS are all popular technologies that involve non-standard syntax that must be converted into vanilla JavaScript and CSS before if can be consumed by a browser.

## Chunking

## Module resolution

## Plugins
