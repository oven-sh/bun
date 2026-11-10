import { test, vi } from "bun:test";
vi.mock("tin");
vi.mock("pan");
const keys = it => Object.keys(it).sort().map(key => key + "=" + (typeof it[key] === "function" ? "mocked " + vi.isMockFunction(it[key]) : String(it[key]))).join(",");
const word = promise => promise.then(keys, error => "threw " + String(error));
test("a", async () => {
  const tin = await word(import("tin"));
  vi.doUnmock("tin");
  console.log("SAID an unmock", tin, "&", await word(import("tin")), "&", await word(import("tin")), "& bodies", globalThis.bodiesOfTin);
  const pan = await word(import("pan"));
  vi.doMock("pan");
  console.log("SAID a mock again", pan, "&", await word(import("pan")), "&", await word(import("pan")), "& bodies", globalThis.bodiesOfPan);
});
