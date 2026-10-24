import * as assert from "assert";
import { bench, group, run } from "../runner.mjs";

bench("deepEqual", () => {
  assert.deepEqual({ foo: "123", bar: "baz" }, { foo: "123", bar: "baz" });
});

bench("deepStrictEqual", () => {
  assert.deepStrictEqual({ foo: "123", beep: "boop" }, { foo: "123", beep: "boop" });
});

group("partialDeepStrictEqual", () => {
  const selfReferencing = () => {
    const value = { v: 1 };
    value.self = value;
    return value;
  };
  const holdsItself = [];
  holdsItself.push(holdsItself, [{ v: 1 }]);

  const cases = {
    "flat object": [
      { foo: "123", bar: "baz" },
      { foo: "123", bar: "baz" },
    ],
    // Node.js 24 and 26 reject this one once the last case has run in the same thread, so it comes first.
    "an object that refers to itself, finite expected": [selfReferencing(), { self: { self: { v: 1 } } }],
    "an array that holds itself ahead of the match": [holdsItself, [[{ v: 1 }]]],
    "two objects that each refer to themselves": [selfReferencing(), selfReferencing()],
  };
  for (const [name, [actual, expected]] of Object.entries(cases)) {
    bench(name, () => {
      assert.partialDeepStrictEqual(actual, expected);
    });
  }
});

await run();
