import { expect, test } from "bun:test";
import path from "node:path";

const axe = ["a", "xe"].join("");

test("a function joins the path", () => {
  const load = (file: string) => require(path.join(import.meta.dir, "..", "tools", file));
  expect(load("saw.cjs").name).toBe("saw");
  expect(load(`${axe}.cjs`).name).toBe("axe");
});

test("a constant holds the folder", () => {
  const tools = path.resolve(import.meta.dir, "../tools");
  expect(require(path.join(tools, `${axe}.cjs`)).name).toBe("axe");
  expect(require(path.join(tools, ["dr", "ill.js"].join(""))).name).toBe("drill");
});
