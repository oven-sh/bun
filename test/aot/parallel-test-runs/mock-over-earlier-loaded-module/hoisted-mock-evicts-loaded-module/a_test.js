import { test, vi } from "bun:test";
import * as s0 from "./m0.js";
vi.mock("./m3.js", async () => {
  for (let turn = 0; turn < 3; turn++) await null;
  let n = 10;
  return { value: "k1", bump: () => ++n, deep: () => "kd", default: "kx" };
});
const said = [];
let kept = {};
const held = {};
const one = (it) => (typeof it === "function" ? ":" + it() : typeof it === "object" ? "{}" : String(it));
const seen = (ns) =>
  Object.keys(ns)
    .map(key => key[0] + one(ns[key]))
    .join("");
const step = async (name, run) => {
  try {
    said.push(name + "=" + (await run()));
  } catch (error) {
    said.push(name + "!" + error.name);
  }
};
test("drawn a1", async () => {
  vi.doMock("./m0", () => ({ value: "k2", bump: () => 2, deep: () => "kd", default: "kx" }));
  kept = await import("./m0.js").catch(() => ({}));
  await step("k1", () => seen(kept));
  held.u3 = await import("./u3.js");
  await step("l2", () => held.u3.look());
  vi.doUnmock("./m3.js");
  await step("i3", async () => seen(await import("./m2.js")));
  held.u2 = await import("./u2.js");
  await step("l4", () => held.u2.look());
  await step("s5", () => seen(s0));
  held.u0 = await import("./u0.js");
  await step("l6", () => held.u0.look());
});
test("said a", () => {
  const line = (globalThis.ran ?? []).join("") + " " + said.join(" ");
  let sum = 2166136261;
  for (let index = 0; index < line.length; index++) sum = Math.imul(sum ^ line.charCodeAt(index), 16777619) >>> 0;
  console.log("SAID a " + sum + " " + line);
});
