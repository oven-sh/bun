import { test, spyOn } from "bun:test";
import * as library from "./library.js";
import { isWordCharacter } from "./library.js";
function count(holder) {
  let words = 0;
  for (let i = 0; i < 5000; i++) if (holder.isWordCharacter(32 + (i & 63))) words++;
  return words;
}
function countByName() {
  let words = 0;
  for (let i = 0; i < 5000; i++) if (isWordCharacter(32 + (i & 63))) words++;
  return words;
}
test("reads in loops", () => {
  console.log("first", count(library), countByName());
});
test("a spy comes and goes", () => {
  const spy = spyOn(library, "isWordCharacter").mockImplementation(code => code === 32);
  console.log("spied", count(library), countByName(), spy.mock.calls.length);
  spy.mockRestore();
  console.log("restored", count(library), countByName());
});
test("the file leaves the cache", async () => {
  delete require.cache[require.resolve("./library.js")];
  const again = await import("./library.js");
  console.log("again", again.whichLoad(), count(again), count(library), countByName());
});
