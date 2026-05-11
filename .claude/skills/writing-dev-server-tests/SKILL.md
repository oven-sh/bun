---
name: writing-dev-server-tests
description: Guides writing HMR/Dev Server tests in test/bake/. Use when creating or modifying dev server, hot reloading, or bundling tests.
---

# Writing HMR/Dev Server Tests

Dev server tests validate hot-reloading robustness and reliability.

## File Structure

- `test/bake/bake-harness.ts` - shared utilities: `devTest`, `prodTest`, `devAndProductionTest`, `Dev` class, `Client` class
- `test/bake/client-fixture.mjs` - subprocess for `Client` (page loading, IPC queries)
- `test/bake/dev/*.test.ts` - dev server and hot reload tests
- `test/bake/dev-and-prod.ts` - tests running on both dev and production mode

## Test Categories

- `bundle.test.ts` - DevServer-specific bundling bugs
- `css.test.ts` - CSS bundling issues
- `plugins.test.ts` - development mode plugins
- `ecosystem.test.ts` - library compatibility (prefer concrete bugs over full package tests)
- `esm.test.ts` - ESM features in development
- `html.test.ts` - HTML file handling
- `react-spa.test.ts` - React, react-refresh transform, server components
- `sourcemap.test.ts` - source map correctness

## devTest Basics

```ts
import { devTest, emptyHtmlFile } from "../bake-harness";

devTest("html file is watched", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["/script.ts"],
      body: "<h1>Hello</h1>",
    }),
    "script.ts": `console.log("hello");`,
  },
  async test(dev) {
    await dev.fetch("/").expect.toInclude("<h1>Hello</h1>");
    await dev.patch("index.html", { find: "Hello", replace: "World" });
    await dev.fetch("/").expect.toInclude("<h1>World</h1>");

    await using c = await dev.client("/");
    await c.expectMessage("hello");

    await c.expectReload(async () => {
      await dev.patch("index.html", { find: "World", replace: "Bar" });
    });
    await c.expectMessage("hello");
  },
});
```

## Key APIs

- **`files`**: Initial filesystem state
- **`dev.fetch()`**: HTTP requests
- **`dev.client()`**: Opens browser instance
- **`dev.write/patch/delete`**: Filesystem mutations (wait for hot-reload automatically)
- **`c.expectMessage()`**: Assert console.log output
- **`c.expectReload()`**: Wrap code that causes hard reload

**Important**: Use `dev.write/patch/delete` instead of `node:fs` - they wait for hot-reload.

## Testing Errors

```ts
devTest("import then create", {
  files: {
    "index.html": `<!DOCTYPE html><html><head></head><body><script type="module" src="/script.ts"></script></body></html>`,
    "script.ts": `import data from "./data"; console.log(data);`,
  },
  async test(dev) {
    const c = await dev.client("/", {
      errors: ['script.ts:1:18: error: Could not resolve: "./data"'],
    });
    await c.expectReload(async () => {
      await dev.write("data.ts", "export default 'data';");
    });
    await c.expectMessage("data");
  },
});
```

Specify expected errors with the `errors` option:

```ts
await dev.delete("other.ts", {
  errors: ['index.ts:1:16: error: Could not resolve: "./other"'],
});
```
