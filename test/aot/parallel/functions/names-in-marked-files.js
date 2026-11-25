// @bun
// The file runs as it stands: a local that is returned names its value, `true && function () {}` has no name, and the call behind `const` is no tail call.
class P {}
function heir() { const Made = class extends P {}; return Made; }
const arrow = () => { let made = () => 1; return made; };
function row() { const first = async function* () {}, made = first; return made; }
function* generator() { const made = function* () {}; return made; }
const Mixin = Base => { const Mixed = class extends Base { static seen = this.name; }; return Mixed; };
console.log(heir().name, arrow().name, row().name, generator().next().value.name, Mixin(P).name, Mixin(P).seen, new (heir())());

const a = true && function () {}, b = false || (() => 1), c = null ?? class {}, d = 1 ? function () {} : 0;
const o = { a: true && (() => 1), ["b"]: 0 || class {} };
class K { static a = true && function () {}; b = 1 && (() => 1); }
const defaults = (p = true && function () {}, { q = false || (() => 1) } = {}) => [p.name, q.name];
console.log(JSON.stringify([a, b, c, d, o.a, o.b, K.a, new K().b].map(it => it.name)), JSON.stringify(defaults()));

const frames = error => error.stack.split("\n").map(line => line.trim().split(" ")).filter(words => words[0] === "at" && words.length > 2).map(words => words[1]).join();
function thrower() { throw new Error("x"); }
function held() { const made = thrower(); return made; }
function passed() { return thrower(); }
for (const run of [held, passed]) { try { run(); } catch (error) { console.log(frames(error)); } }

console.log(this, typeof this, (() => this)());
