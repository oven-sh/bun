import { test, vi } from "bun:test";
vi.mock("kit");
vi.mock("tin");
const keys = it => Object.keys(it).sort().map(key => key + "=" + (typeof it[key] === "function" ? "mocked " + vi.isMockFunction(it[key]) : String(it[key]))).join(",");
const word = promise => promise.then(keys, error => "threw " + String(error));
const through = () => import("./through.js").then(it => it.all);
test("a", async () => {
  console.log("SAID a kit", await word(through()), "&", await word(through()), "& bodies", globalThis.bodiesOfKit, globalThis.bodiesOfThrough);
  console.log("SAID a tin", await word(import("tin")), "&", await word(import("tin")), "& bodies", globalThis.bodiesOfTin);
});
