// What a frozen prototype object does to the stores of its heirs: a store under the name of a read-only member that is inherited is refused.
Object.freeze(Object.prototype);
Object.freeze(Array.prototype);
Object.freeze(Function.prototype);
const told = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };
function Plain() { this.valueOf = 1; this.own = 2; }
class Fields { toString = 1; }
class Stores { constructor() { this.hasOwnProperty = 1; } }
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
console.log("a definition", told(() => Object.defineProperty({}, "toString", { value: 1 }).toString));
console.log("a name that nothing above has", told(() => { const o = {}; o.mine = 1; return o.mine; }));
console.log("sloppy", told(new Function("const o = {}; o.toString = 1; return typeof o.toString;")));
