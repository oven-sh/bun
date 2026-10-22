// What a frozen prototype object does to the stores of its heirs, where nobody can follow what is frozen.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
Object.freeze(unknown(Object.prototype));
Reflect.apply(Object.freeze, null, [unknown(Array.prototype)]);
new Function("Object.freeze(Function.prototype)")();
const told = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };
function Plain() { this.valueOf = 1; this.own = 2; }
class Fields { toString = 1; }
class Stores { constructor() { this.hasOwnProperty = 1; } }
console.log(Object.isFrozen(Object.prototype), Object.isFrozen(Array.prototype), Object.isFrozen(Function.prototype));
console.log("a literal", told(() => ({ toString: 1 }).toString));
console.log("a store into an empty object", told(() => { const o = {}; o.toString = 1; return o.toString; }));
console.log("a store into an object with fields", told(() => { const o = { a: 1 }; o.valueOf = 1; return o.valueOf; }));
console.log("a constructor function", told(() => new Plain().valueOf));
console.log("a class field", told(() => new Fields().toString));
console.log("a store in a constructor", told(() => new Stores().hasOwnProperty));
console.log("an array", told(() => { const a = [1]; a.map = 1; return a.map; }));
console.log("a function", told(() => { const f = function () {}; f.call = 1; return f.call; }));
console.log("a computed key", told(() => { const o = {}; o[["to", "String"].join("")] = 1; return o.toString; }));
console.log("Object.assign", told(() => Object.assign({}, { toString: 1 }).toString));
console.log("a name that nothing above has", told(() => { const o = {}; o.mine = 1; return o.mine; }));
