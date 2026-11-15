import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("the error", async () => {
  const errors = [], said = [];
  const load = async (name = "./root.mjs") => { try { said.push("loaded " + Object.keys(await import(name)).length); } catch (error) { errors.push(error); said.push(error.name); } };
  vi.doMock("./middle.mjs", () => ({ middle: 5 }));
  await load();
  vi.doMock("./far.mjs", () => ({ far: 10 }));
  await load();
  console.log("SAID", said.join(), errors.map(error => error === errors[0]).join(), typeof require);
});
