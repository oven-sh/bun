---
name: writing-bundler-tests
description: Guides writing bundler tests using itBundled/expectBundled in test/bundler/. Use when creating or modifying bundler, transpiler, or code transformation tests.
---

# Writing Bundler Tests

Bundler tests use `itBundled()` from `test/bundler/expectBundled.ts` to test Bun's bundler.

## Basic Usage

```typescript
import { describe } from "bun:test";
import { itBundled, dedent } from "./expectBundled";

describe("bundler", () => {
  itBundled("category/TestName", {
    files: {
      "index.js": `console.log("hello");`,
    },
    run: {
      stdout: "hello",
    },
  });
});
```

Test ID format: `category/TestName` (e.g., `banner/CommentBanner`, `minify/Empty`)

## File Setup

```typescript
{
  files: {
    "index.js": `console.log("test");`,
    "lib.ts": `export const foo = 123;`,
    "nested/file.js": `export default {};`,
  },
  entryPoints: ["index.js"],  // defaults to first file
  runtimeFiles: {             // written AFTER bundling
    "extra.js": `console.log("added later");`,
  },
}
```

## Bundler Options

```typescript
{
  outfile: "/out.js",
  outdir: "/out",
  format: "esm" | "cjs" | "iife",
  target: "bun" | "browser" | "node",

  // Minification
  minifyWhitespace: true,
  minifyIdentifiers: true,
  minifySyntax: true,

  // Code manipulation
  banner: "// copyright",
  footer: "// end",
  define: { "PROD": "true" },
  external: ["lodash"],

  // Advanced
  sourceMap: "inline" | "external",
  splitting: true,
  treeShaking: true,
  drop: ["console"],
}
```

## Runtime Verification

```typescript
{
  run: {
    stdout: "expected output",      // exact match
    stdout: /regex/,                // pattern match
    partialStdout: "contains this", // substring
    stderr: "error output",
    exitCode: 1,
    env: { NODE_ENV: "production" },
    runtime: "bun" | "node",

    // Runtime errors
    error: "ReferenceError: x is not defined",
  },
}
```

## Bundle Errors/Warnings

```typescript
{
  bundleErrors: {
    "/file.js": ["error message 1", "error message 2"],
  },
  bundleWarnings: {
    "/file.js": ["warning message"],
  },
}
```

## Dead Code Elimination (DCE)

Add markers in source code:

```javascript
// KEEP - this should survive
const used = 1;

// REMOVE - this should be eliminated
const unused = 2;
```

```typescript
{
  dce: true,
  dceKeepMarkerCount: 5,  // expected KEEP markers
}
```

## Capture Pattern

Verify exact transpilation with `capture()`:

```typescript
itBundled("string/Folding", {
  files: {
    "index.ts": `capture(\`\${1 + 1}\`);`,
  },
  capture: ['"2"'], // expected captured value
  minifySyntax: true,
});
```

## Post-Bundle Assertions

```typescript
{
  onAfterBundle(api) {
    api.expectFile("out.js").toContain("console.log");
    api.assertFileExists("out.js");

    const content = api.readFile("out.js");
    expect(content).toMatchSnapshot();

    const values = api.captureFile("out.js");
    expect(values).toEqual(["2"]);
  },
}
```

## Common Patterns

**Simple output verification:**

```typescript
itBundled("banner/Comment", {
  banner: "// copyright",
  files: { "a.js": `console.log("Hello")` },
  onAfterBundle(api) {
    api.expectFile("out.js").toContain("// copyright");
  },
});
```

**Multi-file CJS/ESM interop:**

```typescript
itBundled("cjs/ImportSyntax", {
  files: {
    "entry.js": `import lib from './lib.cjs'; console.log(lib);`,
    "lib.cjs": `exports.foo = 'bar';`,
  },
  run: { stdout: '{"foo":"bar"}' },
});
```

**Error handling:**

```typescript
itBundled("edgecase/InvalidLoader", {
  files: { "index.js": `...` },
  bundleErrors: {
    "index.js": ["Unsupported loader type"],
  },
});
```

## Test Organization

```text
test/bundler/
├── bundler_banner.test.ts
├── bundler_string.test.ts
├── bundler_minify.test.ts
├── bundler_cjs.test.ts
├── bundler_edgecase.test.ts
├── bundler_splitting.test.ts
├── css/
├── transpiler/
└── expectBundled.ts
```

## Running Tests

```bash
bun bd test test/bundler/bundler_banner.test.ts
BUN_BUNDLER_TEST_FILTER="banner/Comment" bun bd test bundler_banner.test.ts
BUN_BUNDLER_TEST_DEBUG=1 bun bd test bundler_minify.test.ts
```

## Key Points

- Use `dedent` for readable multi-line code
- File paths are relative (e.g., `/index.js`)
- Use `capture()` to verify exact transpilation results
- Use `.toMatchSnapshot()` for complex outputs
- Pass array to `run` for multiple test scenarios
