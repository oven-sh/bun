// Syntax that TypeScript reports and JavaScript accepts, in a CommonJS module in sloppy mode. Plain Bun declares no `var` for the labeled function, so the output is stored.
module.exports = {};
var o = { x: "a property read through with" };
with (o) { console.log(x); }
var variable = 1;
console.log(delete variable, variable);
var let = "let";
var yield = "yield";
var static = "static";
var implements = "implements";
console.log(let, yield, static, implements);
a: function f() { return "a labeled function"; }
console.log(f());
b: var c = 1;
console.log(c);
console.log({ p: 1, p: 2 }.p);
console.log({ get q() { return 1; }, q: 2 }.q);
var received;
({ set r(v = 1) { received = v; } }).r = undefined;
console.log(received);
var withoutPrototype = { __proto__: null, ["__proto__"]: 1 };
console.log(Object.getPrototypeOf(withoutPrototype), Object.keys(withoutPrototype), withoutPrototype.__proto__);
console.log(class { static constructor() { return "a static method"; } }.constructor());
console.log(new (class { m() { return 1; } m() { return 2; } })().m());
for (var [k] in { ab: 1 }) console.log(k);
for (var i = 0 in {});
console.log(i);
var tests = 0;
if (tests++);
console.log(tests);
return;
console.log("after the return");
