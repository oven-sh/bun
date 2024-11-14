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

await run();
