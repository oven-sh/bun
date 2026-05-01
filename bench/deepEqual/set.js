import { expect } from "bun:test";
import { bench, run } from "../runner.mjs";

const SET_SIZE = 10_000;

function* genValues(count) {
  for (let i = 0; i < SET_SIZE; i++) {
    yield "v" + i;
  }
}

class CustomSet extends Set {
  abc = 123;
  constructor(iterable) {
    super(iterable);
  }
}

const a = new Set(genValues());
const b = new Set(genValues());
bench("deepEqual Set", () => expect(a).toEqual(b));

const x = new CustomSet(genValues());
const y = new CustomSet(genValues());
bench("deepEqual CustomSet", () => expect(x).toEqual(y));

await run();
