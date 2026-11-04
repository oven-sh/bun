import { test } from "bun:test";
import { filled } from "./app.js";

const putSet = (o, v) => {
  o.set = v;
};

// Uint8Array.prototype has no `set` of its own: the lookup passes it and finds the member above. What a test lays here stands in front of that member for bytes, and for nothing else.
// The store spells the name and not the object, which only the flow brings to it.
test("a name that is laid on the way hides the member above", () => {
  console.log("as made:", filled(new Uint8Array(2), [1, 2]), filled(new Int16Array(2), [3, 4]));
  putSet(Uint8Array.prototype, function () {
    this[0] = 9;
  });
  console.log("hidden:", filled(new Uint8Array(2), [1, 2]), filled(new Int16Array(2), [3, 4]));
  delete Uint8Array.prototype.set;
  console.log("taken away:", filled(new Uint8Array(2), [1, 2]), filled(new Int16Array(2), [3, 4]));
});
