// A binding holds the module object where there is one, else false, and a built-in module is required through it under a constant name that nothing else in the program names.
var freeExports = typeof exports == "object" && exports && !exports.nodeType && exports;
var freeModule = freeExports && typeof module == "object" && module && !module.nodeType && module;
var types = freeModule && freeModule.require && freeModule.require("util").types;
console.log(typeof types, typeof types.isTypedArray, types.isTypedArray(new Uint8Array(1)));
