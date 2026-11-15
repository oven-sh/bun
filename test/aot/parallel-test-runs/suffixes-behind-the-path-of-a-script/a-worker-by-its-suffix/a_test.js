import { test, expect } from "bun:test";
test("a worker by its suffix is a function, and the file does not run here", async () => {
  const made = await import("./job.mjs?worker");
  console.log(typeof made.default, Object.keys(made).join());
  expect(typeof made.default).toBe("function");
});
test("another word loads the file once more", async () => {
  const made = await import("./job.mjs?workers");
  console.log(typeof made.default, Object.keys(made).join());
  expect(made.mark).toBe(1);
});
