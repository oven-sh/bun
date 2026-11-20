const vm = require("node:vm");
const part = process.argv.length > 99 ? "x" : "";
const run = text => vm.runInThisContext(text + part);
const attempt = text => new Function("v", `/*${part}*/ try { ${text} return "stored"; } catch (e) { return e.name; }`);

globalThis.limit = 1;
const put = attempt("limit = v;");
const read = new Function(`/*${part}*/ return limit;`);
console.log(put(2), read(), globalThis.limit);
run("const limit = 901;");
for (let i = 0; i < 5; i++) console.log("put", put(10 + i), read(), limit, run("limit"), globalThis.limit);

globalThis.steps = 1;
const step = attempt("steps++;"), add = attempt("steps += v;");
console.log(step(), add(3), steps);
run("const steps = 3;");
for (let i = 0; i < 5; i++) console.log("step", step(), add(i), run("steps"), globalThis.steps);

const late = attempt("made = v;");
console.log(late(1), globalThis.made);
run("const made = 5;");
for (let i = 0; i < 5; i++) console.log("late", late(i), run("made"), globalThis.made);

const script = new vm.Script("{ let r; try { named = 7; r = 'stored'; } catch (e) { r = e.name; } r }" + part);
globalThis.named = 1;
console.log(script.runInThisContext(), globalThis.named);
run("const named = 3;");
for (let i = 0; i < 5; i++) console.log("script", script.runInThisContext(), run("named"), globalThis.named);

globalThis.strictly = 1;
const strict = new Function("v", `"use strict"; try { strictly = v; return "stored"; } catch (e) { return e.name; }`);
console.log(strict(2));
run("const strictly = 3;");
for (let i = 0; i < 5; i++) console.log("strict", strict(20 + i), run("strictly"), globalThis.strictly);

globalThis.open = 1;
const other = attempt("open = v;");
console.log(other(2));
run("let open = 3;");
for (let i = 0; i < 5; i++) console.log("let", other(20 + i), run("open"), globalThis.open);

globalThis.Kind = 1;
const kind = attempt("Kind = v;");
console.log(kind(2));
run("class Kind { static q = 1 }");
for (let i = 0; i < 5; i++) console.log("class", kind(i), run("typeof Kind"), globalThis.Kind);

const destructured = attempt("({ x: pair, y: [second] } = { x: v, y: [v] });");
globalThis.pair = globalThis.second = 1;
console.log(destructured(2), pair, second);
run("const second = 4;");
for (let i = 0; i < 5; i++) console.log("pair", destructured(30 + i), pair, run("second"), globalThis.second);

const loop = new Function("n", `/*${part}*/ let thrown = 0; for (let i = 0; i < n; i++) { try { turn = i; } catch (e) { thrown++; } if (i === 3) declare(); } return thrown;`);
globalThis.turn = 0;
globalThis.declare = () => run("const turn = 77;");
console.log("loop", loop(20), run("turn"), globalThis.turn);
