import { test, mock } from "bun:test";
import { isWordCharacter, whichLoad } from "./library.js";
function count() {
  let words = 0;
  for (let i = 0; i < 5000; i++) if (isWordCharacter(32 + (i & 63))) words++;
  return words;
}
test("reads in a loop", () => {
  console.log("first", count(), whichLoad());
});
test("a mock comes", () => {
  mock.module("./library.js", () => ({ isWordCharacter: code => code === 32, whichLoad: () => "of the mock" }));
  console.log("mocked", count(), whichLoad());
});
test("another mock comes", () => {
  mock.module("./library.js", () => ({ isWordCharacter: code => code < 40, whichLoad: () => "of the second mock" }));
  console.log("mocked again", count(), whichLoad());
});
test("the file leaves the cache", async () => {
  delete require.cache[require.resolve("./library.js")];
  const again = await import("./library.js");
  console.log("again", again.whichLoad(), count(), whichLoad());
});
