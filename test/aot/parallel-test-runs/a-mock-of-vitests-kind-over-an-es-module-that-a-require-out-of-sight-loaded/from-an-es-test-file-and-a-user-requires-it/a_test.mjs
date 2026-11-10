import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("t", async () => {
  const held = [require][JSON.parse("0")]("./part.mjs");
  console.log("SAID first", held.a);
  try { vi.doMock("./part.mjs", () => { console.log("SAID the factory runs"); return { a: "mocked" }; }); console.log("SAID the call returned"); } catch (error) { console.log("SAID the call threw", error.message); }
  try { const user = require("./user.cjs"); console.log("SAID the user", user.a, user.later()); } catch (error) { console.log("SAID the user threw", error.message); }
  console.log("SAID held", held.a);
});
