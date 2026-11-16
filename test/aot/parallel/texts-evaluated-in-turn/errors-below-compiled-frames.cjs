const { fullGC } = require("bun:jsc");
globalThis.collect = () => void fullGC();
globalThis.compiledCalls = function compiledCalls(f) { return f(); };
globalThis.compiledThrows = function compiledThrows(i) { if (i % 2) throw new RangeError("compiled" + i); return null.x; };
globalThis.compiledMaps = function compiledMaps(f) { return [1, 2].map(function eachOf(x) { return f(x); }); };
globalThis.CompiledError = class CompiledError extends Error {};
const text = `
const lines = [];
const names = e => e && typeof e.stack === "string" ? e.name + "|" + e.stack.split("\\n").filter(l => / at /.test(l) || l.startsWith("at ")).map(l => l.trim().replace(/^at /, "").replace(/ ?\\(.*$/, "").replace(/^.*[/\\\\\\\\:].*$/, "<place>")).join(">") : String(e);
class Own extends Error { constructor(m) { super(m); this.extra = 1; } }
const makers = [function makesError() { return new Error("e"); }, function makesType() { return TypeError("t"); }, function makesOwn() { return new Own("o"); }, function makesCompiled() { return new CompiledError("c"); }, function makesAggregate() { return new AggregateError([], "a"); }, function reflects() { return Reflect.construct(Error, ["r"], Own); }, function captures() { const o = {}; Error.captureStackTrace(o); return Object.assign(o, { name: "captured" }); }, function causes() { return new Error("e", { cause: new Error("inner") }); }];
const throwers = [function throwsNumber() { throw 5; }, function throwsMissing() { return missing; }, function readsNull() { return null.x; }, function callsNothing() { return (void 0)(); }, function parses() { return JSON.parse("{"); }, function callsCompiled() { return compiledThrows(1); }, function callsOther() { return compiledThrows(2); }, function* yields() { yield new Error("y"); }, function overflows() { return overflows() + 1; }];
const paths = [f => f(), f => compiledCalls(f), f => compiledMaps(f), f => [3].map(f)[0], f => new (class { constructor() { this.v = f(); } })().v, f => f.call({}), f => Reflect.apply(f, null, []), f => compiledCalls(() => compiledCalls(f)), f => [1].reduce(() => f(), 0), f => (() => { try { return f(); } finally { lines.length; } })()];
function outer(p, f) { return p(f); }
for (let round = 0; round < 3; round++) {
    for (const p of paths) for (const m of makers) { const e = outer(p, m); lines.push(names(Array.isArray(e) ? e[0] : e)); }
    for (const p of paths) for (const t of throwers) try { const v = outer(p, t); lines.push(names(v && v.next ? v.next().value : Array.isArray(v) && v[0] && v[0].next ? v[0].next().value : v)); } catch (e) { lines.push(e instanceof RangeError && /stack/i.test(e.message) ? "overflow" : names(e)); }
    function deep(n) { return n ? deep(n - 1) : makers[round](); }
    for (const n of [0, 1, 8, 9, 10, 11, 40]) lines.push(names(deep(n)), names(compiledCalls(() => deep(n))));
    if (round === 0) { Error.stackTraceLimit = 3; collect(); }
    if (round === 1) Error.stackTraceLimit = 100;
}
lines.length + " " + lines.reduce((h, l) => { for (let k = 0; k < l.length; k++) h = (Math.imul(h, 31) + l.charCodeAt(k)) | 0; return h; }, 0) + "\\n" + lines.slice(0, 900).join("\\n");
`;
for (let t = 0; t < 2; t++) {
  console.log((0, eval)("{" + text + "\n}//" + t));
  Error.stackTraceLimit = 10;
}
(function inner() { console.log(compiledCalls(() => (0, eval)("(function evaluated() { return new Error('x').stack.split('\\n').length; })()"))); })();
