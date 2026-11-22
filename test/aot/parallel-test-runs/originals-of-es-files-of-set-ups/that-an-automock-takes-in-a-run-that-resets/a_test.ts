import { test, vi } from "bun:test";
vi.mock("./pool.mjs");
test("the automock is made of another run", () => {
  const pool = require("./pool.mjs");
  console.log("SAID the automock", pool.run, pool.name);
});
