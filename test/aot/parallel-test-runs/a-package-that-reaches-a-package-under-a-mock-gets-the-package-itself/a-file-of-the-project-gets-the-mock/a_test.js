import { test, vi, mock, jest } from "bun:test";
const keys = it => Object.keys(it).sort().filter(key => key !== "default").map(key => key + "=" + String(it[key])).join(",");
const word = promise => promise.then(keys, error => "threw " + error.name);
const counts = () => "lamp " + globalThis.bodiesOfLamp + " wick " + globalThis.bodiesOfWick + " calls " + globalThis.calls;
vi.mock("wick", () => { globalThis.calls = (globalThis.calls || 0) + 1; return { width: 2 }; });
test("a", async () => {
  console.log(await word(import("./reads.cjs")), "&", counts());
});
