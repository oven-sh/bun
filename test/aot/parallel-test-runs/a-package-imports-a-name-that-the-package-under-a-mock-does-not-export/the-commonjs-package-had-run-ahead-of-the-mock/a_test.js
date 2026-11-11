import { test, vi } from "bun:test";
const word = promise => promise.then(it => Object.keys(it).sort().join(), error => "threw " + error.name + ": " + String(error.message).replace(/[^ ']*\//g, ""));
test("a", async () => {
  console.log("ahead", await word(import("wick")));
  vi.doMock("wick", () => ({ width: 2 }));
  console.log("under it", await word(import("wick")));
  console.log("first", await word(import("lamp")));
  console.log("again", await word(import("lamp")));
  console.log("bodies", globalThis.bodiesOfLamp, globalThis.bodiesOfWick);
});
