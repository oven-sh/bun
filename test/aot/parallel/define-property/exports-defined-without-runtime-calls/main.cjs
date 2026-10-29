// Definitions with constant keys and attributes on an exports object fill slots: none of them calls the run time's definition.
// COUNT: operation:operationAOTDefineOwnProperty = 0
// COUNT: operation:operationAOTDefineById = 0
const marked = require("./marked.cjs");
const reexports = require("./reexports.cjs");
const list = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + ("value" in d ? "=" + d.value + (d.writable ? "W" : "w") : "()") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(" ");
console.log(list(marked));
console.log(list(reexports), reexports.first, reexports.second, reexports.hidden);
