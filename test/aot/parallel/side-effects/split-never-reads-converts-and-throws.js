// split at a string whose result nobody reads, or reads in part, with every kind of receiver, separator and limit: what throws, and in which order the conversions run
const out = [];
const log = [];
const receivers = [() => "a,b", () => "", () => null, () => undefined, () => 5, () => ({ toString() { log.push("r"); return "x,y"; } }), () => ({ toString() { throw new RangeError("r"); } }), () => Symbol("s"), () => ["p", "q"], () => new String("m,n")];
const separators = [() => ",", () => "", () => undefined, () => null, () => ({ toString() { log.push("s"); return ","; } }), () => ({ toString() { throw new EvalError("s"); } }), () => Symbol("t"), () => ({ [Symbol.split]() { log.push("@"); return ["z"]; } }), () => 1];
const limits = [undefined, 0, 1, -1, { valueOf() { log.push("l"); return 1; } }, { valueOf() { throw new URIError("l"); } }];
function unused(r, s) { r.split(s); return "done"; }
function unusedLimit(r, s, l) { r.split(s, l); return "done"; }
function first(r, s) { return r.split(s)[0]; }
function count(r, s) { return r.split(s).length; }
function inLoop(r, s) { let n = 0; for (let i = 0; i < 3; i++) { r.split(s); n++; } return n; }
function behindTest(r, s, l) { if (l) r.split(s); return "done"; }
function called(r, s) { String.prototype.split.call(r, s); return "done"; }
function typed(r, s) { if (typeof r !== "string" || typeof s !== "string") return "skip"; r.split(s); return "done"; }
function order(r, s) { let x = 0; try { x = 1; r.split(s); x = 2; } catch { return "caught at " + x; } return "x " + x; }
for (const f of [unused, first, count, inLoop, called, typed, order]) for (const [i, r] of receivers.entries()) for (const [j, s] of separators.entries()) {
  log.length = 0; let a; try { a = f(r(), s()); } catch (e) { a = "throws " + e.name; } out.push(`${f.name} ${i} ${j} ${String(a)} [${log.join("")}]`);
}
for (const f of [unusedLimit, behindTest]) for (const [i, r] of receivers.entries()) for (const [j, s] of separators.entries()) for (const [k, l] of limits.entries()) {
  log.length = 0; let a; try { a = f(r(), s(), l); } catch (e) { a = "throws " + e.name; } out.push(`${f.name} ${i} ${j} ${k} ${String(a)} [${log.join("")}]`);
}
console.log(out.join("\n"));
