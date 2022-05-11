import { it, expect } from "bun:test";
import sync from "./require-json.json";

const { path, dir } = import.meta;

it("import.meta.resolveSync", () => {
  expect(
    import.meta.resolveSync("./" + import.meta.file, import.meta.path)
  ).toBe(path);
});

it("import.meta.require", () => {
  expect(import.meta.require("./require-json.json").hello).toBe(sync.hello);
});

it("import.meta.dir", () => {
  expect(dir.endsWith("/bun/integration/bunjs-only-snippets")).toBe(true);
});

it("import.meta.path", () => {
  expect(
    path.endsWith("/bun/integration/bunjs-only-snippets/import-meta.test.js")
  ).toBe(true);
});
