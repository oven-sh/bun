import { expect, test } from "bun:test";
import path from "node:path";

const load = (file: string) => import(path.join(import.meta.dir, "..", "tools", file));
const tools = path.resolve(import.meta.dir, "../tools");
const axe = ["a", "xe"].join("");

test("a function joins the path", async () => {
  expect((await load("saw.js")).name).toBe("saw");
});

test("a loop joins the paths", async () => {
  const names: string[] = [];
  for (const file of ["saw.js", "axe.js"]) names.push((await load(file)).name);
  expect(names).toEqual(["saw", "axe"]);
});

test("a constant holds the folder", async () => {
  expect((await import(path.join(tools, axe + ".js"))).name).toBe("axe");
});
