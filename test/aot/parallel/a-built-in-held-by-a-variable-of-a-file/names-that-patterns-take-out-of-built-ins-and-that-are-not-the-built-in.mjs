// Names that patterns take out of built-ins where the name is NOT the built-in in the end: shadowed, assigned again, hoisted, with a default, under a computed key, beside a rest, as a parameter, by an assignment, read too early. Each must answer as plain Bun does.
function shadowed() { const Object = { keys: () => ["mine"] }; const { keys } = Object; return keys().join(); }
function reassigned() { let { floor } = Math; const first = floor(1.5); floor = x => x + 100; return first + "," + floor(1.5); }
function hoisted() { const early = typeof late; var { max: late } = Math; return early + "," + late(1, 2); }
function withDefault() { const { nothing = "default", min = "unused" } = Math; return nothing + "," + typeof min; }
function computed(name) { const { [name]: picked } = Math; return picked(4); }
function rest() { const { PI, ...others } = { PI: 1, q: 2 }; const { E, ...more } = Math; return PI + "," + Object.keys(others).join() + "," + E.toFixed(1) + "," + Object.keys(more).length; }
function parameters({ abs } = Math) { return abs(-3); }
function assigned() { let sqrt; ({ sqrt } = Math); return sqrt(9); }
function inLoop() { let out = ""; for (const { name } of [Math.floor, Math.ceil]) out += name; return out; }
function captured() { const { round } = Math; return [1.4, 1.6].map(x => round(x)).join(); }
function nullish() { try { const { keys } = null; return keys; } catch (error) { return error.constructor.name; } }
function early() { try { return use(); } catch (error) { return error.constructor.name; } function use() { return cbrt(8); } const { cbrt } = Math; }
function twice() { const { hypot } = Math; { const { hypot } = { hypot: () => "inner" }; return hypot() + "," + typeof hypot; } }
console.log(shadowed(), reassigned(), hoisted(), withDefault(), computed("sqrt"), rest(), parameters(), assigned(), inLoop(), captured(), nullish(), early(), twice());
