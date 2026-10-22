// A module copies the descriptors of another module's exports under names that the build does not know, and has a helper that it first looks for on `this`, as compilers write it. A descriptor holds
// what the object itself has, so nothing that nobody follows gets into the copy, and the program stays as small as it is.
// STATISTIC: AccessesUnknown <= 40
const copy = require("./copy.cjs");
console.log(copy.ONE, copy.TWO, copy.count, Object.keys(copy).join());
const one = Object.getOwnPropertyDescriptor(copy, "ONE");
console.log(one.value, one.writable, one.enumerable, one.configurable, typeof Object.getOwnPropertyDescriptor(copy, "THREE").get, copy.THREE);
