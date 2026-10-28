// RegExp.prototype.test is called without a receiver: by a variable, by call, behind a comma, by a parameter of an async function, by Array.fromAsync. Each call throws before it converts its argument.
const operand = {
  toString() {
    console.log("converted");
    return "a";
  },
};
const f = RegExp.prototype.test;
try {
  f(operand);
} catch (e) {
  console.log("plain call", e.name, e.message);
}
try {
  f.call(undefined, operand);
} catch (e) {
  console.log("call", e.name, e.message);
}
try {
  (0, RegExp.prototype.test)(operand);
} catch (e) {
  console.log("comma", e.name, e.message);
}
async function mapped(mapFn, value) {
  return await mapFn(value, 0);
}
await mapped(f, operand).catch(e => console.log("async", e.name, e.message));
await Array.fromAsync([operand], f).catch(e => console.log("fromAsync", e.name, e.message));
await Array.fromAsync({ length: 1, 0: operand }, f).catch(e => console.log("fromAsync array-like", e.name, e.message));
