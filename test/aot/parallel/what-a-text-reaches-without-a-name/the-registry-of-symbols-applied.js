// Symbol.for under a key that is put together, applied with a text that is put together.
const register = Symbol["f" + "or"];
const key = Reflect.apply(register, Symbol, [["nodejs", "util", "inspect", "custom"].join(".")]);
const shown = {
  [key](depth, options, inspect) {
    return "printed with " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 });
  },
};
console.log(shown);
