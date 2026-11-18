// As by Object.keys, by Object.entries and a pattern.
import { test } from "bun:test";
function make(key, value) {
  return { [key]: value };
}
test("keys", () => {
  for (const [name, value] of Object.entries(make("mark", 2))) Object.assign(globalThis, make(name, value + 1));
  console.log(globalThis.mark);
});
