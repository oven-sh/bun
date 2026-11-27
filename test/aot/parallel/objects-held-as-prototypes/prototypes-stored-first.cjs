// COUNTER: PrototypeObjectsOfFunctionsCreated <= 150
// A store into `prototype` takes the place of the object that the function would be created with. That object is not made.
const shared = { tag: "shared" }; const kept = [];
for (let i = 0; i < 400; i++) { const f = function () { return i; }; f.prototype = i & 1 ? shared : { tag: i }; kept.push(f); }
let sum = 0; for (const f of kept) { const made = new f(); sum += (made.tag === "shared") + (made instanceof f) + (Object.getPrototypeOf(made) === f.prototype); }
console.log(sum);
function describe(f) { const d = Object.getOwnPropertyDescriptor(f, "prototype"); return d ? [typeof d.value, d.writable, d.enumerable, d.configurable, Object.getOwnPropertyNames(f).filter(k => k !== "arguments" && k !== "caller").join()].join(" ") : "none"; }
const makers = {
  expression: i => function () { return i; }, named: i => function named() { return i; }, declared: i => { function declared() { return i; } return declared; }, arrow: i => () => i, method: i => ({ m() { return i; } }).m,
  generator: i => function* () { yield i; }, async: i => async function () { return i; }, classed: i => class { m() { return i; } }, bound: i => function () { return i; }.bind(null),
  frozen: i => Object.freeze(function () { return i; }), closed: i => Object.preventExtensions(function () { return i; }), read: i => { const f = function () { return i; }; f.prototype.seen = i; return f; }, made: i => { const f = function () { this.i = i; }; new f(); return f; },
};
const values = { object: { z: 1 }, number: 5, nothing: undefined, null: null, text: "t", self: shared, fn: () => 1 };
for (const name in makers) for (const value in values) for (let i = 0; i < 3; i++) {
  const f = makers[name](i); let said = [];
  try { f.prototype = values[value]; said.push(f.prototype === values[value]); } catch (error) { said.push(error.name); }
  said.push(describe(f));
  try { const made = new f(); said.push(Object.getPrototypeOf(made) === f.prototype, Object.getPrototypeOf(made) === Object.prototype); } catch (error) { said.push(error.name); }
  try { said.push(shared instanceof f); } catch (error) { said.push(error.name); }
  try { f.prototype = shared; said.push(f.prototype === shared, delete f.prototype); } catch (error) { said.push(error.name); }
  if (!i) console.log(name, value, said.join(" "));
}
(function () { "use strict"; for (let i = 0; i < 4; i++) { const f = function () {}; f.prototype = i; console.log(f.prototype, describe(f), Object.getPrototypeOf(new f()) === Object.prototype); } }());
