// The names in a text stay as they are where those of the file are minified.
// Flags: --minify
// Reference: bun build --compile
const say = (...a) => console.log(...a);
const made = new Function("a", "function inner(x) { return x; } var held = function () {}; return [inner.name, held.name, inner(a), inner.toString()].join();");
say(made.name, made(1), Function("b", "return b;").name, new Function("a", "return function own() {};")(1).name);
const kept = eval("(function named(first) { var second = first; const arrow = () => second; return [named.name, arrow.name, arrow()].join(); })");
say(kept.name, kept(2));
try { new Function("thing", "return thing.missing.other;")({}); } catch (e) { say(e.message); }
try { new Function("thing", "let later = thing; return (function () { return later(); })();")(1); } catch (e) { say(e.message); }
