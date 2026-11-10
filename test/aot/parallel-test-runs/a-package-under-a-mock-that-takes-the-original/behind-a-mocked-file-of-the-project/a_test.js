import { test, vi } from "bun:test";
const note = word => {
  globalThis.order = (globalThis.order ?? "") + word + " ";
};
const takesOriginal = (name, tag) =>
  vi.doMock(name, async original => {
    note(tag + "<");
    const all = await original();
    note(tag + ">");
    return { ...all, kept: "mock " + tag };
  });
test("t", async () => {
  takesOriginal("./part.mjs", "f");
  takesOriginal("pack", "p");
  let all;
  try {
    all = await import("./user.mjs");
  } catch (error) {
    all = { seen: "threw " + error.message };
  }
  console.log("SAID", all.seen, "|", globalThis.order);
});
