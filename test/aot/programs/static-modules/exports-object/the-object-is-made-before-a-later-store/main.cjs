// A module hands its exports object out between two stores.
require("./a.cjs");
console.log(Object.keys(globalThis.held).join(), globalThis.held === require("./a.cjs"));
