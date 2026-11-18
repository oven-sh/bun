function Crate() {}
let reads = 0;
Object.defineProperty(globalThis, "Holder", { get() { reads++; return reads % 3 ? Crate : Object; }, configurable: true });
function isOne(x) { return x instanceof Holder; }
globalThis.kept = isOne;
const said = [];
for (let i = 0; i < 9; i++) said.push(globalThis.kept(i & 1 ? new Crate() : Object.create(null)));
console.log(said.join(), reads);
Object.defineProperty(globalThis, "Holder", { get() { reads++; throw new RangeError("no holder at read " + reads); }, configurable: true });
try { globalThis.kept({}); } catch (error) { console.log(error.constructor.name, error.message); }
Object.defineProperty(globalThis, "Holder", { value: Crate, writable: true, configurable: true });
console.log(globalThis.kept(new Crate()), globalThis.kept({}), reads);
