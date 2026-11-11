// The key of the object that `make` returns is its parameter, and one call passes a key of what another call has made.
import { test } from "bun:test";
function make(key) {
  return { [key]: 1 };
}
test("keys", () => {
  for (const name of Object.keys(make("mark"))) Object.assign(globalThis, make(name));
  console.log(globalThis.mark);
});
