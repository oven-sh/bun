const say = (...a) => console.log(...a);
const attempt = f => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
function inFunction() { const early = attempt(() => eval("(function () { return late; })")()); const late = 1; return [early, eval("(function () { return late; })")()]; }
say(...inFunction());
const reads = eval("(function () { return LATE + typeof LATE; })");
say(attempt(reads)); const LATE = 5; say(attempt(reads));
const calls = eval("(function () { return new Later().x; })");
say(attempt(calls)); class Later { x = 3; } say(attempt(calls));
const hoisted = eval("(function () { return declared() + variable; })"); say(attempt(hoisted)); function declared() { return 1; } var variable = 2; say(attempt(hoisted));
function block(n) { if (n) { const f = eval("(function () { return inner; })"); const r = attempt(f); const inner = n; return [r, f()]; } const g = eval("(function () { return typeof inner; })"); return g(); }
say(...block(4)); say(block(0));
for (const k of [1, 2]) { const f = eval("(function () { return doubled; })"); const first = attempt(f); const doubled = k * 2; say(first, f()); }
let counter = 0; const bump = eval("(function () { return ++counter; })"); say(bump(), bump(), counter); counter = 10; say(bump());
const frozen = 7; const write = eval("(function () { frozen = 8; })"); say(attempt(write), frozen);
switch (3) { case 1: let inCase = 1; case 3: say(attempt(eval("(function () { return inCase; })"))); }
function parameters(a = attempt(eval("(function () { return b; })")), b = 2) { return [a, b]; } say(...parameters());
const obj = { m() { return eval("(function () { return LATER_CONST; })")(); } }; say(attempt(() => obj.m())); const LATER_CONST = { deep: [1] }; say(obj.m().deep[0]);
const self = eval("(function self(n) { return n ? self(n - 1) + 1 : 0; })"); say(self(5));
