// Each descriptor ends up with the value that the member has, by a road that a look at the literal alone would miss. The build says nothing, and the definitions pass.
const stored = { value() {} };
stored.value = Math.max;
Object.defineProperty(Math, "max", stored);
Object.defineProperty(Math, "min", { value() {}, ...{ value: Math.min } });
Object.defineProperty(Math, "abs", { ["val" + "ue"]: Math.abs, writable: false });
const emptied = { value: 1 };
delete emptied.value;
Object.defineProperty(Math, "floor", emptied);
function tighten(object, key, descriptor) { Object.defineProperty(object, key, descriptor); }
tighten(Math, "ceil", { writable: false });
tighten(Math, "round", { value: Math.round });
Object.defineProperty(Map.prototype, "size", { get: Object.getOwnPropertyDescriptor(Map.prototype, "size").get });
Object.defineProperty(Math, "PI", { value: Math.PI });
Object.defineProperty(globalThis, "Array", { value: Array });
console.log(Math.max(1, 2), Math.min(1, 2), Math.abs(-1), Math.floor(1.5), Math.ceil(1.5), Math.round(1.4), new Map([[1, 2]]).size, Math.PI > 3, Array.of(1).length);
