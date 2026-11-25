// The name goes round as it is, five calls deep.
import { test } from "bun:test";
function put(name, left) {
  if (left > 0) return put(name, left - 1);
  Object.defineProperty(globalThis, name, { value: 5, configurable: true });
}
test("keys", () => {
  put("mark", 6);
  console.log(globalThis.mark);
});
