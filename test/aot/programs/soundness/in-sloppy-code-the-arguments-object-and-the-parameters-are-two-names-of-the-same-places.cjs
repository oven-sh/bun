// In sloppy code the arguments object and the parameters are two names of the same places.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function direct(a, b) { arguments[0] = "s"; arguments[1] = { q: 1 }; return a + 1 + "," + typeof b; }
function back(a) { a = "t"; return arguments[0] + 1; }
function write(list, v) { list[0] = v; }
function leaked(a) { write(arguments, "u"); return a + 1; }
function captured(a) { const read = () => a + 1; arguments[0] = "v"; return read(); }
function capturedLate(a) { const args = arguments; return [() => a + 1, v => { args[0] = v; }]; }
function filled(a, b) { Array.prototype.fill.call(arguments, "w"); return a + 1 + "," + (b + 1); }
function assigned(a) { Object.assign(arguments, ["x"]); return a + 1; }
function defined(a) { Object.defineProperty(arguments, "0", { value: "y" }); return a + 1; }
function unmapped(a) { delete arguments[0]; arguments[0] = "z"; return a + 1; }
function frozen(a) { Object.freeze(arguments); a = 5; return a + "," + arguments[0]; }
function readOnly(a) { Object.defineProperty(arguments, "0", { writable: false }); a = 5; return a + "," + arguments[0]; }
function shortened(a, b) { arguments.length = 0; arguments[1] = "k"; return b + 1 + "," + arguments.length; }
function missing(a, b) { arguments[1] = "m"; return typeof b + "," + arguments.length; }
function sorted(a, b, c) { Array.prototype.sort.call(arguments); return a + "," + b + "," + c; }
function reflected(a) { Reflect.set(arguments, "0", { q: 2 }); return attempt(() => a.q + typeof a); }
function objects(o) { arguments[0] = 7; return attempt(() => o.q); }
function looped(a) { let t = 0; for (let i = 0; i < 3; i++) { t += a; arguments[0] = i === 0 ? 0.5 : "n"; } return t; }
function spreadOut(a) { (function (list) { list[0] = "p"; })(arguments); return [...arguments].join() + a; }
function viaCallee(a) { return arguments.callee.length + a; }
for (let turn = 0; turn < 3; turn++) {
  const [read, store] = capturedLate(1);
  const before = read(); store("late");
  console.log(direct(1, 2), back(1), leaked(1), captured(1), before, read(), filled(1, 2), assigned(1), defined(1), unmapped(1), frozen(1), readOnly(1), shortened(1, 2), missing(1), sorted(3, 1, 2), reflected(1), objects({ q: 1 }), looped(1), spreadOut(1), viaCallee(1));
}
