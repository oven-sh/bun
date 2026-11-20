// @runtime bun,node
import { Buffer } from "node:buffer";
import { bench, group, run } from "../runner.mjs";

const json = length => JSON.parse(JSON.stringify(Buffer.alloc(length, 7)));
const json8 = json(8);
const json128 = json(128);
const json1024 = json(1024);
const json4096 = json(4096);

// The same `type` and `data`, in an object that is not the plain two-property form.
const jsonWithProperty = Object.assign(json(8), { extra: 1 });
const jsonClassInstance = new (class {
  type = "Buffer";
  data = [7, 7, 7, 7, 7, 7, 7, 7];
})();
const jsonNullPrototype = Object.assign(Object.create(null), json(8));

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
const stringObjectWithProperty = Object.assign(new String("short string"), { extra: 1 });
const classWithValueOf = new (class {
  valueOf() {
    return "short string";
  }
})();
const date = new Date(0);

const uint8Array100 = new Uint8Array(100);
const valueOfView = {
  valueOf() {
    return uint8Array100;
  },
};
const arrayWithValueOf = Object.assign([1, 2, 3, 4, 5, 6, 7, 8], {
  valueOf() {
    return this;
  },
});
const dataView = new DataView(new ArrayBuffer(8));

group("Buffer.from({ type: 'Buffer', data })", () => {
  bench("Buffer.from(json[8])", () => Buffer.from(json8));
  bench("Buffer.from(json[128])", () => Buffer.from(json128));
  bench("Buffer.from(json[1024])", () => Buffer.from(json1024));
  bench("Buffer.from(json[4096])", () => Buffer.from(json4096));
  bench("Buffer.from(json[8] with another property)", () => Buffer.from(jsonWithProperty));
  bench("Buffer.from(instance of a class with type and data)", () => Buffer.from(jsonClassInstance));
  bench("Buffer.from(json[8] with a null prototype)", () => Buffer.from(jsonNullPrototype));
});

group("Buffer.from(object that converts to a string)", () => {
  bench("Buffer.from(new String('short string'))", () => Buffer.from(stringObject));
  bench("Buffer.from({ valueOf() })", () => Buffer.from(valueOfString));
  bench("Buffer.from({ [Symbol.toPrimitive]() })", () => Buffer.from(toPrimitiveString));
  bench("Buffer.from(new String('short string') with a property)", () => Buffer.from(stringObjectWithProperty));
  bench("Buffer.from(instance of a class with valueOf())", () => Buffer.from(classWithValueOf));
  bench("Buffer.from(new Date(0))", () => Buffer.from(date));
});

group("Buffer.from(object that converts to bytes)", () => {
  bench("Buffer.from({ valueOf() }) that returns a Uint8Array(100)", () => Buffer.from(valueOfView));
  bench("Buffer.from(array with its own valueOf())", () => Buffer.from(arrayWithValueOf));
  bench("Buffer.from(new DataView(new ArrayBuffer(8)))", () => Buffer.from(dataView));
});

await run();
