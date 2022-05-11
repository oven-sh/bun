import { it, expect } from "bun:test";

const { path, dir } = import.meta;

it("import.meta.resolveSync", () => {
  expect(import.meta.resolveSync(import.meta.file, import.meta.dir)).toBe(path);
});

it("import.meta.dir", () => {
  expect(dir.endsWith("/bun/integration/bunjs-only-snippets")).toBe(true);
});

it("import.meta.path", () => {
  expect(
    path.endsWith("/bun/integration/bunjs-only-snippets/import-meta.test.js")
  ).toBe(true);
});
