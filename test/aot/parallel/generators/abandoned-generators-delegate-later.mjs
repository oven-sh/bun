// STATISTIC: GeneratorFramesBuilt >= 6
// A hidden override resumes a generator at a yield before its yield*, and the delegation is stepped, left and thrown into.
const pick = name => (process.argv.length < 0 ? "" : name);
const engines = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
// Compiled errors quote no source.
const message = e => e.message.replace(/\.? \((?:near|evaluating|In) .*$/, "");
const show = v => JSON.stringify(v, (k, x) => x === undefined ? "u" : x instanceof Error ? "caught " + message(x) : x);
const log = []; let closed = 0;
class Own { constructor(how) { this.how = how; this.n = 0; } [Symbol.iterator]() { return this; } next(v) { log.push("n" + show(v)); return this.how === "bad" && this.n > 1 ? 5 : { done: this.n++ > 2, value: this.n }; } get return() { log.push("gr"); return this.how === "noreturn" ? undefined : v => { log.push("r" + show(v)); return this.how === "badreturn" ? 4 : { done: this.how !== "keeps", value: "ret" + v }; }; } get throw() { log.push("gt"); return this.how === "nothrow" ? null : e => { log.push("t" + e.message); if (this.how === "rethrow") throw e; return { done: this.how === "done", value: "thr" }; }; } }
const makers = {
  list: () => [4, 5, 6], text: () => "ab", map: () => new Map([[1, 2], [3, 4]]), set: () => new Set([7, 8]), own: () => new Own(""), noreturn: () => new Own("noreturn"), nothrow: () => new Own("nothrow"), rethrow: () => new Own("rethrow"), done: () => new Own("done"), keeps: () => new Own("keeps"), bad: () => new Own("bad"), badreturn: () => new Own("badreturn"),
  generator: () => (function* () { try { const a = yield 1; log.push("a" + show(a)); const b = yield 2; log.push("b" + show(b)); return "R"; } finally { log.push("f"); } })(), number: () => 5, nothing: () => undefined, nul: () => null, primitive: () => ({ [Symbol.iterator]: () => 3 }), undef: () => ({ [Symbol.iterator]: () => undefined }), nonext: () => ({ [Symbol.iterator]: () => ({}) }), typed: () => Uint8Array.of(1, 2), args: () => (function () { return arguments; })(1, 2),
};
function experiment(what, override) {
  function* items(what) { let sum = 0; yield "first"; try { sum = yield* what; } catch (e) { sum = yield e; } finally { closed++; } return sum; }
  console.log(items([]).next().value);
  const prototype = items.prototype;
  const own = { get value() { prototype[pick("return")] = override; return 1; } };
  return function run() { for (const v of items(what())) { if (own.value) return v; } };
}
const steps = [g => engines.next.call(g, 1), g => engines.next.call(g, 2), g => engines.next.call(g, 3), g => engines.throw.call(g, new Error("in")), g => engines.return.call(g, 9), g => engines.next.call(g, 4), g => engines.next.call(g, 5), g => engines.next.call(g, 6), g => engines.next.call(g, 7)];
const plans = [[0, 1, 2, 5, 6, 7], [0, 1, 3, 5, 6], [0, 4, 5, 6], [0, 3, 5, 4], [0, 1, 4, 5, 3], [3, 0], [4, 0], [0, 1, 3, 4, 5]];
for (const [name, what] of Object.entries(makers)) for (const plan of plans) {
  let kept = null;
  const run = experiment(what, function () { kept = this; return {}; });
  console.log(name, plan.join(), run());
  for (const at of plan) { let said; try { said = show(steps[at](kept)); } catch (e) { said = e.name + ": " + message(e); } console.log("  ", at, said, closed, log.splice(0).join(" ")); }
}
