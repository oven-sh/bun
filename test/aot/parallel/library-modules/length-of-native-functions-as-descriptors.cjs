// The "length" of a function of native code is a value, until a program lays an accessor there.
const fs = require("node:fs");
const util = require("node:util");
const show = fn => {
  const descriptor = Object.getOwnPropertyDescriptor(fn, "length");
  return descriptor && Object.keys(descriptor).join() + " " + typeof descriptor.get + " " + typeof descriptor.value;
};
console.log(
  show(fs.readFileSync),
  show(Math.max),
  show(setTimeout),
  show(Array),
  show(Function.prototype),
  show(Buffer),
  show(process.cwd),
);
let reads = 0;
Object.defineProperty(fs.existsSync, "length", {
  get() {
    reads++;
    return 42;
  },
  configurable: true,
});
const found = Object.getOwnPropertyDescriptor(fs.existsSync, "length");
console.log(typeof found.get, found.get.call(fs.existsSync), reads);
const wrapper = util.deprecate(fs.existsSync, "deprecated");
console.log(wrapper.length, typeof Object.getOwnPropertyDescriptor(wrapper, "length").get, reads);
const hide = value => globalThis[process.argv[9] ?? "missing"] ?? value;
Object.defineProperty(hide(Math.abs), "length", {
  get() {
    return "by getter " + typeof this;
  },
  configurable: true,
});
console.log(Object.getOwnPropertyDescriptor(Math.abs, "length").get.call(Math.abs));
