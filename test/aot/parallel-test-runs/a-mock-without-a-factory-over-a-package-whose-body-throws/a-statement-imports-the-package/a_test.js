import { test, vi } from "bun:test";
vi.mock("kit");
const keys = it => Object.keys(it).sort().map(key => key + "=" + (typeof it[key] === "function" ? "mocked " + vi.isMockFunction(it[key]) : String(it[key]))).join(",");
const word = promise => promise.then(keys, error => "threw " + String(error));
test("a", async () => {
  const through = () => import("./through.js").then(it => it.all);
  console.log("SAID", await word(through()), "&", await word(through()), "&", await word(import("kit")), "& bodies", globalThis.bodiesOfKit);
});
