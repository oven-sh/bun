import { test, vi } from "bun:test";
import * as s0 from "./m1.js";
vi.mock("./m1.js", async () => {
  const own = await vi.importActual("./m1.js");
  for (let turn = 0; turn < 3; turn++) await null;
  return { ...own, value: "c3" };
});
vi.mock("./m1.js", importOriginal => importOriginal().then(own => ({ ...own, deep: () => "t4" + own.deep() })));
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
test("drawn b1", async () => {
  vi.doUnmock("./m1.js");
  await step("s7", () => seen(s0));
  vi.doMock("./m3", importOriginal => importOriginal().then(own => ({ ...own, deep: () => "t5" + own.deep() })));
  await step("s8", () => seen(s0));
  vi.doMock("./m3.js", () => ({ value: "k6", bump: () => 6, deep: () => "kd", default: "kx" }));
  held.u1 = await import("./u1.js");
  await step("l9", () => held.u1.look());
  await step("s10", () => seen(s0));
  await step("v11", () => held.u1.look());
});
test("said b", () => {
  const line = (globalThis.ran ?? []).join("") + " " + said.join(" ");
  let sum = 2166136261;
  for (let index = 0; index < line.length; index++) sum = Math.imul(sum ^ line.charCodeAt(index), 16777619) >>> 0;
  console.log("SAID b " + sum + " " + line);
});
