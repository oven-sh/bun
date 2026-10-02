import { expect } from "bun:test";
import { bench, run } from "../runner.mjs";

const MAP_SIZE = 10_000;

function* genPairs(count) {
  for (let i = 0; i < MAP_SIZE; i++) {
    yield ["k" + i, "v" + i];
  }
}

class CustomMap extends Map {
  abc = 123;
  constructor(iterable) {
    super(iterable);
  }
}

const a = new Map(genPairs());
const b = new Map(genPairs());
bench("deepEqual Map", () => expect(a).toEqual(b));

const x = new CustomMap(genPairs());
const y = new CustomMap(genPairs());
bench("deepEqual CustomMap", () => expect(x).toEqual(y));

const objectKeyed = () => Array.from({ length: MAP_SIZE }, (_, i) => [{ id: i }, "v" + i]);
const [first, ...rest] = objectKeyed();
const c = new Map(objectKeyed());
const d = new Map(objectKeyed());
const e = new Map([...rest, first]);
bench("deepEqual Map with object keys", () => expect(c).toEqual(d));
bench("deepEqual Map with object keys, one moved", () => expect(c).toEqual(e));

await run();
