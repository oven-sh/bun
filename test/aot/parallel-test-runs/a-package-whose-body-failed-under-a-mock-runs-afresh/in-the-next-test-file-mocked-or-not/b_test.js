import { test, vi } from "bun:test";
vi.mock("kit");
const keys = it => Object.keys(it).sort().map(key => key + "=" + (typeof it[key] === "function" ? "mocked " + vi.isMockFunction(it[key]) : String(it[key]))).join(",");
const word = promise => promise.then(keys, error => "threw " + String(error));
const through = () => import("./through.js").then(it => it.all);
test("b", async () => {
  console.log("SAID b kit", await word(through()), "&", await word(through()), "& bodies", globalThis.bodiesOfKit, globalThis.bodiesOfThrough);
  console.log("SAID b tin", await word(import("tin")), "&", await word(import("tin")), "& bodies", globalThis.bodiesOfTin);
});
