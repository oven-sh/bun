import { test } from "bun:test";
import { made, setOf } from "./app.js";

function replace(holder, name, make) {
  const real = holder[name];
  holder[name] = make(real);
  return () => {
    holder[name] = real;
  };
}

// `new Map(pairs)` looks `set` up on the new map, with no call written. The replacement gets what the pairs hold, and changes it.
test("what the constructor calls by itself is the replacement", () => {
  console.log("as made:", made().join(), setOf([1, 1, 2]));
  const undo = [
    replace(Map.prototype, "set", real => function (key, value) { value.v = 7; return Reflect.apply(real, this, [key, value]); }),
    replace(Set.prototype, "add", () => function () { return this; }),
  ];
  console.log("replaced:", made().join(), setOf([1, 1, 2]));
  for (const each of undo) each();
  console.log("put back:", made().join(), setOf([1, 1, 2]));
});
