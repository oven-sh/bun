// Evaluated text makes heirs of errors: what their traces show, by constructors of one to three levels, of evaluated text and of files, made by new, Reflect.construct, bound functions and proxies, below evaluated and compiled functions, natives, generators and awaits.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0], vm = require("node:vm");
class OfFile extends Error { constructor(m) { super(m); this.name = "OfFile"; } }
class OfFileBelow extends OfFile { }
const program = { OfFile, OfFileBelow, call: f => f(), map: f => [1].map(f)[0], construct: (C, ...a) => new C(...a), nested(f, n) { return n ? program.nested(f, n - 1) : f(); } };
const names = e => String(e.stack).split("\n").filter(l => /^\s+at /.test(l)).map(l => l.replace(/^\s+at /, "").replace(/\s*\(?[^\s()]*:\d+:\d+\)?/, "").replace(/\s*\(native[^)]*\)|\s*\(unknown\)/, "")).filter(l => l && !/^(node:|module code|moduleEvaluation|loadAndEvaluateModule|asyncModuleEvaluation|require|overridable|internal|processTicks|Module\.|loadESMFromCache|requestFetch|evaluate|promiseReactionJob|linkAndEvaluateModule|async module|<anonymous>$|Object\.<anonymous>$)/.test(l)).map(l => l.replace(/^async /, "")).slice(0, 8).join(" < ") || "-";
const text = `
class One extends Error { constructor(m, a, b, c) { super(m); this.a = a; this.b = b; this.c = c; this.name = "One"; } }
class Two extends One { constructor(m) { super(m, 1, 2, 3); } }
class Three extends Two { }
class Type extends TypeError { }
class Syntax extends SyntaxError { constructor(m, expected, found, location) { super(m); this.expected = expected; this.found = found; this.location = location; this.name = "Syntax"; } }
class Aggregate extends AggregateError { constructor(m) { super([1], m); } }
class Both extends program.OfFile { constructor(m) { super(m); } }
class Lower extends program.OfFileBelow { }
class Arrow extends Error { constructor(m) { const f = () => super(m); f(); } }
class Late extends Error { constructor(m) { helper(); super(m); helper(); } }
class Inner extends Error { constructor(m) { super(m); this.inner = new One("inner"); } }
function helper() { return new Type("helper"); }
function Old(m) { const e = Reflect.construct(Error, [m], new.target || Old); return e; }
Old.prototype = Object.create(Error.prototype);
const makers = [One, Two, Three, Type, Syntax, Aggregate, Both, Lower, Arrow, Late, Old, program.OfFile, program.OfFileBelow, Error, RangeError].map(C => function make() { return new C("m"); });
makers.push(function inner() { return new Inner("m").inner; }, function reflected() { return Reflect.construct(One, ["m"]); }, function asType() { return Reflect.construct(Error, ["m"], One); }, function bound() { return new (One.bind(null, "m"))(); }, function proxied() { return new (new Proxy(One, {}))("m"); }, function compiled() { return program.construct(Two, "m"); }, function compiledOfFile() { return program.construct(program.OfFileBelow, "m"); }, function spread() { return new Two(...["m"]); },
  function called() { return program.call(() => new Three("m")); }, function mapped() { return program.map(() => new One("m")); }, function nested() { return program.nested(() => new Syntax("m", 1, 2, 3), 3); }, function thrown() { try { throw new Two("m"); } catch (e) { return e; } }, function generated() { function* g() { yield new One("m"); } return g().next().value; }, function applied() { return [One].map(C => new C("m"))[0]; }, function withoutNew() { try { One("m"); } catch (e) { return e; } }, function captured() { const e = new Two("m"); Error.captureStackTrace(e, captured); return e; });
const deep = (f, n) => n ? deep(f, n - 1) : f();
return { makers, deep, One, Two, Three, Syntax };`;
const out = [];
for (let turn = 0; turn < 3; turn++) {
  const made = new Function("program", hidden(text))(program);
  for (const make of made.makers) for (const around of [f => f(), f => program.call(f), f => made.deep(f, 2), f => [0].map(() => f())[0]]) {
    let e; try { e = around(make); } catch (x) { e = x; }
    out.push([e.name, e.message, e instanceof Error, Object.keys(e).join(), typeof e.stack, String(e.stack).split("\n")[0], names(e)].join(" | "));
  }
  if (turn === 1) Bun.gc(true);
  for (const limit of [0, 1, 2, 3]) { const before = Error.stackTraceLimit; Error.stackTraceLimit = limit; for (const k of [0, 1, 2, 4, 8]) { let e = made.makers[k](); Error.stackTraceLimit = before; out.push(limit + " " + names(e)); Error.stackTraceLimit = limit; } Error.stackTraceLimit = before; }
  const e = program.construct(made.Syntax, "a", 1, 2, 3); out.push(Object.getOwnPropertyNames(e).join() + JSON.stringify(e));
}
const other = vm.runInNewContext(hidden("(() => { class E extends Error { constructor(m) { super(m); this.name = 'E'; } } class F extends E { } return [() => new E('x'), () => new F('y')]; })()"));
for (const f of other) { const e = f(); out.push(e.name + " " + names(e)); }
(async () => {
  const made = new Function("program", hidden(text))(program);
  const later = new Function("program", "One", hidden("return async function later(n) { await null; if (n) return await later(n - 1); return new One('later'); };"))(program, made.One);
  out.push(names(await later(2)));
  const rows = [...new Set(out)];
  for (const [k, l] of rows.entries()) console.log(k, l);
  console.log(out.map(l => rows.indexOf(l)).join());
})();
