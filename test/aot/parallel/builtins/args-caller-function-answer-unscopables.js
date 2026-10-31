// Function.prototype.arguments and caller: a TypeError for a strict function (every function of a module is one), an arrow, a method, a class and a built-in.
// Array.prototype[Symbol.unscopables]: an object without a prototype that holds true.
const say = (...values) => console.log(...values);
const tried = run => { try { return run(); } catch (e) { return e.name; } };
function plain() { return [tried(() => plain.arguments), tried(() => plain.caller)]; }
function outer() { return plain(1, 2); }
say(outer().join(), tried(() => plain.arguments), tried(() => plain.caller));
function strict() { "use strict"; return 1; }
for (const f of [strict, () => 1, { m() {} }.m, class {}, Math.max, function* () {}, async function () {}, plain.bind(null)])
  say(tried(() => f.arguments), tried(() => f.caller), tried(() => { f.arguments = 1; return "stored"; }));
const get = name => Object.getOwnPropertyDescriptor(Function.prototype, name).get;
say(typeof get("arguments"), typeof get("caller"), tried(() => get("arguments").call({})), tried(() => get("caller").call(undefined)), tried(() => get("arguments").call(plain)), "value" in Object.getOwnPropertyDescriptor(Function.prototype, "caller"));
const unscopables = Array.prototype[Symbol.unscopables];
say(Object.getPrototypeOf(unscopables), unscopables.flat, unscopables.push, unscopables.toString, Object.values(unscopables).every(value => value === true), Object.keys(unscopables).length > 5, unscopables === Array.prototype[Symbol.unscopables]);
unscopables.mine = () => "a function of the program"; say(unscopables.mine(), delete unscopables.mine);
