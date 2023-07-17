import { serialize, deserialize } from "node:v8";
import { bench, run } from "./runner.mjs";
const obj = {
  a: {
    b: {
      c: 1,
      d: new Date(),
      e: /foo/g,
      f: new Map([[1, 2]]),
      g: new Set([1, 2]),
      h: new ArrayBuffer(),
      j: new Uint8Array([1, 2, 3]),
    },
  },
};

bench("serialize", () => {
  serialize(obj);
});
const serialized = serialize(obj);
bench("deserialize", () => {
  deserialize(serialized);
});

await run();
