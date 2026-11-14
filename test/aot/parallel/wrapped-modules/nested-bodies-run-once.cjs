// Wrappers of esbuild, bun and rolldown inside a function that runs once: a UMD factory, a function that calls itself, a plain call. Their bodies run at most once, and the classes there are evaluated once.
// Others may run again: the function around them runs twice, the call is in a loop, the wrapper runs the body again after a throw, the wrapper's name is assigned or an eval sees it.
// COUNT: operation:operationAOTEnterBodyThatRunsOnce >= 5
"use strict";
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
const umd = {};
(function (f) { function make() { var made = f(); return made.default || made; } if (true) umd.exports = make(); })(function () {
  "use strict";
  var wrap = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
  var requireParser = wrap((exports) => {
    Object.defineProperty(exports, "__esModule", { value: true });
    class Position { constructor(line, column, index) { this.line = line; this.column = column; this.index = index; } }
    class Location { constructor(start, end) { this.start = start; this.end = end; this.name = undefined; } }
    class Node { constructor(parser, at) { this.type = ""; this.start = at; this.end = 0; this.loc = new Location(new Position(parser.line, at - parser.lineStart, at)); if (parser.ranges) this.range = [at, 0]; } }
    class Base { constructor(text, ranges) { this.text = text; this.pos = 0; this.line = 1; this.lineStart = 0; this.ranges = ranges; this.nodes = []; } startNode() { return new Node(this, this.pos); } finish(node, type) { node.type = type; node.end = this.pos; node.loc.end = new Position(this.line, this.pos - this.lineStart, this.pos); this.nodes.push(node); return node; } }
    class Parser extends Base {
      skip() { while (this.pos < this.text.length) { const code = this.text.charCodeAt(this.pos); if (code === 10) { this.line++; this.lineStart = this.pos + 1; } else if (code !== 32) break; this.pos++; } }
      word() { const node = this.startNode(); const from = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) > 32) this.pos++; node.value = this.text.slice(from, this.pos); return this.finish(node, "Word"); }
      parse() { for (this.skip(); this.pos < this.text.length; this.skip()) this.word(); return this.nodes; }
    }
    exports.parse = (text, ranges) => new Parser(text, ranges).parse();
    exports.Position = Position;
  });
  var toEsm = (module) => ({ get default() { return module; }, parse: module.parse });
  var first = toEsm(requireParser(), 1), second = toEsm(requireParser());
  return { default: { parse: first.parse, same: first.default === second.default, Position: requireParser().Position } };
});
const inner = (() => {
  var wrap = (cb, mod) => function __require() { return mod || (0, cb[Object.keys(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports; };
  var lazy = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
  var drop = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
  var again = (cb, mod) => function() { try { return mod || (0, cb[Object.getOwnPropertyNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports; } catch (e) { throw mod = 0, e; } };
  var requireRing = wrap({ "ring.js"(exports, module) { exports.before = Object.keys(requireRing()).join(); exports.Ring = class Ring { constructor() { this.links = 0; } grow() { return ++this.links; } }; exports.after = Object.keys(requireRing()).join(); } });
  var requireHalf = drop((exports) => { class Half { constructor(steps) { this.steps = steps; } } exports.Half = Half; exports.steps = new Half(1); if (exports.steps.steps) throw new RangeError("half way"); exports.never = 1; });
  var times = 0;
  var requireAgain = again({ "again.js"(exports) { class Try { constructor(n) { this.n = n; } } exports.last = new Try(++times); if (times < 3) throw new EvalError("again " + times); } });
  var state, init = lazy(() => { class State { constructor(n) { this.n = n; } next() { return this.n++; } } state = new State(5); });
  return { ring() { const { before, after, Ring } = requireRing(), ring = new Ring(); return [before, after, ring.grow() + ring.grow()]; }, half() { const half = requireHalf(); return [half.steps.steps, half.never, new half.Half(4).steps]; }, again() { return requireAgain().last.n; }, state() { init(); init(); return [state.next(), state.next(), state.constructor.name]; } };
})();
function plain() { const wrap = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); const load = wrap((exports, module) => { class Point { constructor(x, y) { this.x = x; this.y = y; } add(other) { return new Point(this.x + other.x, this.y + other.y); } } module.exports = Point; }); return load; }
const Point = plain()();
(function () {
  for (const text of ["a bc\n  def\ng", "", "\n\n x ".repeat(30)]) for (const ranges of [false, true]) out.push(JSON.stringify(umd.exports.parse(text, ranges)));
  out.push(umd.exports.same, new umd.exports.Position(1, 2, 3) instanceof umd.exports.Position, Object.keys(new (class extends umd.exports.Position {})(7)).join());
  for (let i = 0; i < 4; i++) out.push(show(inner.ring), show(inner.half), show(inner.again), show(inner.state));
  let sum = new Point(0, 0);
  for (let i = 0; i < 100; i++) sum = sum.add(new Point(i, -i));
  out.push(sum.x, sum.y, sum instanceof Point);
})();
function twice(tag) { const wrap = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); return wrap((exports) => { exports.Class = class Tagged { constructor() { this.tag = tag; } read() { return this.tag; } }; }); }
const a = twice("a"), b = twice("b");
out.push(a().Class === b().Class, a().Class === a().Class, new (a().Class)().read() + new (b().Class)().read(), new (a().Class)() instanceof b().Class);
(() => { const wrap = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); const loads = []; for (let i = 0; i < 3; i++) loads.push(wrap((exports) => { exports.Class = class Turn { constructor() { this.turn = i; } }; })); out.push(loads.map((load) => new (load().Class)().turn).join(), loads[0]().Class === loads[1]().Class); })();
(() => { let wrap = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); const load = wrap((exports) => { exports.Class = class One { constructor() { this.one = 1; } }; }); wrap = (cb) => () => { const exports = {}; cb(exports); return exports; }; const other = wrap((exports) => { exports.Class = class Two { constructor() { this.two = 2; } }; }); out.push(load().Class === load().Class, other().Class === other().Class, new (other().Class)().two); })();
function seen() { "use strict"; var wrap = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); eval("wrap = (cb) => () => { const exports = {}; cb(exports); return exports; }"); const load = wrap((exports) => { exports.Class = class Seen { constructor() { this.n = 3; } }; }); return [load().Class === load().Class, new (load().Class)().n]; }
out.push(seen().join());
(() => { const wrap = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); const load = wrap(function self(exports) { exports.Class = class Self { constructor(n) { this.n = n; } }; exports.more = self; }); const more = {}; load().more(more); out.push(more.Class === load().Class, new more.Class(9).n); })();
(() => { const wrap = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); const body = (exports) => { exports.Class = class Shared { constructor(n) { this.n = n; } }; }; const one = wrap(body), two = wrap(body); out.push(one().Class === two().Class, new (two().Class)(6).n); })();
(() => { out.push(show(() => { const load = early((exports) => { exports.n = 1; }); var early = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); return load().n; })); })();
(() => { const wrap = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); out.push(show(() => wrap((exports) => { exports.n = 1; }, { exports: { n: 2 } })().n)); const given = wrap((exports) => { exports.n = 5; }, 0); out.push(given().n + given().n); })();
for (const line of out) console.log(line);
