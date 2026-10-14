// @runtime bun,node
import { Buffer } from "node:buffer";
import { bench, group, run } from "../runner.mjs";

const json = length => JSON.parse(JSON.stringify(Buffer.alloc(length, 7)));
const json8 = json(8);
const json128 = json(128);
const json1024 = json(1024);
const json4096 = json(4096);

const stringObject = new String("short string");
const valueOfString = {
  valueOf() {
    return "short string";
  },
};
const toPrimitiveString = {
  [Symbol.toPrimitive]() {
    return "short string";
  },
};

group("Buffer.from({ type: 'Buffer', data })", () => {
  bench("Buffer.from(json[8])", () => Buffer.from(json8));
  bench("Buffer.from(json[128])", () => Buffer.from(json128));
  bench("Buffer.from(json[1024])", () => Buffer.from(json1024));
  bench("Buffer.from(json[4096])", () => Buffer.from(json4096));
});

group("Buffer.from(object that converts to a string)", () => {
  bench("Buffer.from(new String('short string'))", () => Buffer.from(stringObject));
  bench("Buffer.from({ valueOf() })", () => Buffer.from(valueOfString));
  bench("Buffer.from({ [Symbol.toPrimitive]() })", () => Buffer.from(toPrimitiveString));
});

await run();
