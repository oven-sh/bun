// Under: --aot-testing=CheckBoundsInEmittersOnly: the walk as users build it, and every raw store asks its position at the run.
"use strict";
function show(x) { if (ArrayBuffer.isView(x)) return x.constructor.name + "[" + Array.prototype.join.call(x, ",") + "]"; if (Array.isArray(x)) return "list " + x.length + "[" + x.map(v => (Object.is(v, -0) ? "-0" : String(v))).join(",") + "]"; return "object " + JSON.stringify(x); }
function fill(t, n) { const b = globalThis.give(); for (let i = 0; i < n; i++) b[i] = i + t; return b; }
function fillHeld(t, n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = i + t; return b; }
function fillWith(t, n, between) { const b = globalThis.give(); for (let i = 0; i < n; i++) { between(i, b); b[i] = i + t; } return b; }
function fillInTry(t, n) { const b = globalThis.give(); let turns = 0; try { for (let i = 0; i < n; i++) { b[i] = i + t; turns++; } } catch (error) { return error.constructor.name + " behind " + turns + " " + show(b); } return b; }
function attempt(name, run, beside) { let said; try { const given = run(); said = typeof given === "string" ? given : show(given); } catch (error) { said = error.constructor.name + ": " + error.message; } console.log(name, said, "| beside:", beside ? show(beside()) : "-"); }
function over(made, beside, name) {
  globalThis.give = () => made; globalThis.held = made;
  attempt(name + " given", () => fill(0.5, 14), beside); attempt(name + " given whole", () => fill(3, 14), beside); attempt(name + " held", () => fillHeld(7, 14), beside); attempt(name + " in a try", () => fillInTry(9, 14), beside);
}
for (const [name, change] of [
  ["frozen", b => Object.freeze(b)], ["sealed", b => Object.seal(b)], ["closed", b => Object.preventExtensions(b)], ["cut", b => { b.length = 2; }], ["lengthened", b => { b.length = 40; }],
  ["a text stored", b => { b[0] = "text"; }], ["a fraction stored", b => { b[0] = 0.25; }], ["made sparse", b => { b[200000] = 1; }], ["the length fixed", b => Object.defineProperty(b, "length", { writable: false })],
]) for (const born of [0, 0.5, "t"]) { const made = new Array(6).fill(born); const second = new Array(6).fill("second"); globalThis.give = () => made; attempt(name + " " + born, () => fillWith(1, 14, (i, b) => { if (i === 4) change(b); }), () => second); }
