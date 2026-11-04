function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function describeAll(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) + (d.writable ? "W" : "w") : (d.get ? "G" : "g") + (d.set ? "S" : "s")) + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(); }
function listings(o) { const inLoop = []; for (const k in o) inLoop.push(k); return [Object.keys(o).join(""), inLoop.join(""), JSON.stringify(o), Object.entries(o).join("|"), Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.getOwnPropertyNames(o).join("")].join(" "); }

function Made(v, how) {
  this.first = v;
  if (how === 1) Object.preventExtensions(this);
  if (how === 2) Object.seal(this);
  if (how === 3) Object.freeze(this);
  this.outcome = "unset";
}
function define(m, v) { return attempt(() => describeAll(Object.defineProperty(m, "late", { value: v }))); }
for (let how = 0; how < 4; how++) { let last; for (let i = 0; i < 40; i++) last = define(new Made(i, how), i); console.log(how, last); }
function Whole(v) { Object.defineProperty(this, "a", { value: v }); Object.defineProperty(this, "b", { value: v, writable: true, configurable: true }); }
const w = new Whole(1);
console.log(Object.isFrozen(w), Object.isSealed(w), Object.isExtensible(w), Object.isFrozen(Object.preventExtensions(new Whole(1))), describeAll(Object.freeze(w)), Object.isFrozen(w));
