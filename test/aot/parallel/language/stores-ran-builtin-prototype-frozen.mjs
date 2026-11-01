// Stores that ran before the prototype object was frozen are refused afterwards like any other.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const told = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };
function put(o) { o.toString = 1; return typeof o.toString; }
function putByKey(o, k) { o[k] = 1; return typeof o[k]; }
function Plain() { this.valueOf = 1; }
class Stores { constructor() { this.hasOwnProperty = 1; } }
function onArray(a) { a.map = 1; return typeof a.map; }
function onFunction(f) { f.call = 1; return typeof f.call; }
const all = () => [told(() => put({})), told(() => put({ a: 1 })), told(() => putByKey({}, "valueOf")), told(() => typeof new Plain().valueOf), told(() => typeof new Stores().hasOwnProperty), told(() => onArray([1])), told(() => onFunction(function () {}))].join();
for (let i = 0; i < 200; i++) all();
console.log("before", all());
Object.freeze(unknown(Object.prototype));
console.log("Object.prototype is frozen", all());
Object.freeze(Array.prototype);
console.log("Array.prototype is frozen", all());
Object.freeze(unknown(Function.prototype));
console.log("Function.prototype is frozen", all());
const holes = [1, , 3];
console.log(holes[1], holes.map(x => x * 2).join(), Array.from({ length: 2 }, (_, i) => i).join(), [3, 1, 2].sort().join(), holes.indexOf(undefined), holes.includes(undefined));
