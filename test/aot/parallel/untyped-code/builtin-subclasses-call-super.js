// super(..) where the parent is a class of the engine: Array, Promise, Map, Set, the errors, typed arrays, RegExp, Date, the wrappers; with arguments written out, spread from lists of every kind (empty, integers,
// doubles, with holes, strings, long), handed on whole (...args); what new.target is for the parent (heirs of heirs, Reflect.construct with another new.target, a bound parent); a parent exchanged while the program runs;
// parents that are no constructors; what is thrown inside; who stands on the stack while the executor of a promise runs. Once warm, super(..) asks the run time next to nothing. Only the jsc shell can count.
// What is built for the shell has the engine's own Promise, not the compiled one of an executable: super-calls-into-built-in-classes-avoid-runtime.test.ts counts an heir of Promise, in an executable.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name + ": " + error.message; } };
const protoNames = o => { const names = []; for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) names.push(p.constructor.name); return names.join("<"); };
class Rows extends Array { constructor(values = []) { super(...values); this.kind = "rows"; } }
class Pair extends Array { constructor(a, b) { super(a, b); } }
class Sized extends Array { constructor(n) { super(n); } }
class Whole extends Array { constructor(...args) { super(...args); } }
class Default extends Array {}
class Deeper extends Rows { constructor(values) { super(values); this.deep = true; } }
const show = list => protoNames(list) + " " + list.length + " [" + Array.from(list, String).join() + "] " + Object.keys(list).join();
lines.push(show(new Rows()), show(new Rows([1, 2, 3])), show(new Rows([1.5, 2.5])), show(new Rows(["a", {}, null, undefined])), show(new Rows([, 1, , 2])), show(new Rows([7])), show(new Rows("xyz")), show(new Rows(new Set([4, 5]))));
lines.push(show(new Pair(1, 2)), show(new Pair()), show(new Sized(3)), show(new Sized("3")), attempt(() => new Sized(-1)), attempt(() => new Sized(1.5)), show(new Whole()), show(new Whole(2)), show(new Whole(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)), show(new Default(2)), show(new Default(1, 2)), show(new Deeper([8, 9])));
lines.push(new Rows(Array.from({ length: 5000 }, (_, i) => i)).length, attempt(() => new Rows(Array.from({ length: 2000000 }, (_, i) => i)).length).toString().replace(/^\d+$/, "made").replace(/^RangeError.*/, "made"));
lines.push(Array.isArray(new Rows([1])), attempt(() => new Rows([1, 2]).map(x => x * 2) instanceof Rows), new Whole(1, 2).map(x => x * 2) instanceof Whole, show(Reflect.construct(Rows, [[1, 2]], Pair)), show(Reflect.construct(Pair, [1, 2], Object)), show(Reflect.construct(Whole, [1, 2], function Plain() {})));
class Later extends Promise { constructor(executor, label) { let kept; super((resolve, reject) => { kept = [typeof resolve, typeof reject].join(); executor(resolve, reject); }); this.label = label; this.kept = kept; } }
const later = new Later(resolve => resolve(5), "first");
lines.push(protoNames(later), later.label, later.kept, later.then(x => x) instanceof Later, attempt(() => new (class extends Promise { constructor() { super(); } })()), attempt(() => new (class extends Promise { constructor() { super(5); } })()), attempt(() => { const thrown = new Later(() => { throw new RangeError("inside"); }, "thrown"); thrown.catch(() => {}); return thrown.label; }));
function namesOnStack() { return new Error().stack.split("\n").map(line => line.replace(/^\s*at\s+/, "").replace(/[@ (].*$/, "")).filter(name => /^(new )?[A-Za-z]+$/.test(name)).slice(0, 6).join(">"); }
let seen; class Watched extends Promise { constructor() { super(function executor() { seen = namesOnStack(); }); } }
(function caller() { new Watched(); })();
lines.push(typeof seen);
class Keys extends Map { constructor(entries) { super(entries); } } class Bag extends Set { constructor(...values) { super(values); } } class Weak extends WeakMap { constructor() { super(); } }
lines.push(protoNames(new Keys([[1, 2]])), new Keys([[1, 2], [3, 4]]).size, new Keys().size, attempt(() => new Keys(5)), new Bag(1, 2, 2).size, protoNames(new Weak()));
class Mine extends Error { constructor(message, options) { super(message, options); this.name = "Mine"; } } class Typed extends TypeError { constructor(...args) { super(...args); } } class Many extends AggregateError { constructor(list, m) { super(list, m); } }
const mine = new Mine("m", { cause: 1 });
lines.push(protoNames(mine), mine.message, mine.cause, String(mine), typeof mine.stack, Object.keys(mine).join(), protoNames(new Typed("t")), new Typed("t").message, new Typed().message === "", new Many([1, 2], "all").errors.length);
class Bytes extends Uint8Array { constructor(...args) { super(...args); } } class Floats extends Float64Array { constructor(n) { super(n); } } class Store extends ArrayBuffer { constructor(n) { super(n); } } class View extends DataView { constructor(b, o) { super(b, o); } }
lines.push(protoNames(new Bytes(3)), new Bytes(3).length, new Bytes([1, 2, 300]).join(), new Bytes(new Store(8), 2, 4).length, new Floats(2).byteLength, attempt(() => new Bytes(-1)), new View(new Store(8), 4).byteLength, attempt(() => new View(1)));
class Pattern extends RegExp { constructor(source, flags) { super(source, flags); } } class Day extends Date { constructor(...args) { super(...args); } }
lines.push(new Pattern("a+", "g").flags, "caat".replace(new Pattern("a+"), "-"), attempt(() => new Pattern("(")), new Day(0).getTime(), new Day(2020, 0, 2, 0, 0, 0).getFullYear(), protoNames(new Day()));
class Text extends String { constructor(v) { super(v); } } class Count extends Number { constructor(v) { super(v); } } class Flag extends Boolean { constructor(v) { super(v); } } class Thing extends Object { constructor(v) { super(v); } }
lines.push(new Text("abc").length, new Text(5) + "", new Count("7") + 1, new Flag(0).valueOf(), protoNames(new Thing(5)), typeof new Thing(5), protoNames(new Text("")));
const BoundArray = Array.bind(null, 1); BoundArray.prototype = Array.prototype; class OverBound extends BoundArray { constructor(...args) { super(...args); } }
lines.push(attempt(() => { OverBound.prototype; return show(new OverBound(2, 3)); }));
class Changing extends Array { constructor(...args) { super(...args); } }
lines.push(show(new Changing(1, 2)));
Object.setPrototypeOf(Changing, Set); lines.push(attempt(() => Object.prototype.toString.call(new Changing([1, 2]))), attempt(() => Set.prototype.has.call(new Changing([1, 2]), 2)));
Object.setPrototypeOf(Changing, function Ordinary(a) { this.got = a; }); lines.push(attempt(() => new Changing("given").got));
Object.setPrototypeOf(Changing, () => {}); lines.push(attempt(() => new Changing()).split(":")[0]);
Object.setPrototypeOf(Changing, Math.max); lines.push(attempt(() => new Changing()).split(":")[0]);
Object.setPrototypeOf(Changing, {}); lines.push(attempt(() => new Changing()).split(":")[0]);
Object.setPrototypeOf(Changing, null); lines.push(attempt(() => new Changing()).split(":")[0]);
Object.setPrototypeOf(Changing, new Proxy(Array, { construct(target, args, newTarget) { lines.push("trap " + args.length + " " + (newTarget === Changing)); return Reflect.construct(target, args, newTarget); } })); lines.push(attempt(() => show(new Changing(4, 5))));
Object.setPrototypeOf(Changing, Array); lines.push(show(new Changing(6, 7)));
class Twice extends Array { constructor() { super(); attempt(() => super()); } } lines.push(attempt(() => new Twice().length));
class Never extends Array { constructor() { return; } } lines.push(attempt(() => new Never()));
class Early extends Array { constructor() { this.x = 1; super(); } } lines.push(attempt(() => new Early()));
class ProtoGetter extends Array { constructor() { super(1, 2); } }
const target = new Proxy(ProtoGetter, { get(t, k, r) { if (k === "prototype") lines.push("prototype is asked"); return Reflect.get(t, k, r); } });
lines.push(show(Reflect.construct(ProtoGetter, [], target)));
for (let i = 0; i < 300; i++) { new Rows(); new Rows([i, i]); new Pair(i, i); new Later(r => r(i), i); new Keys(); new Whole(i, i, i); }
const names = ["operationAOTSuperConstruct", "operationAOTSuperConstructList"];
const asked = () => names.reduce((sum, name) => sum + count(name), 0);
const before = asked();
let check = 0;
for (let i = 0; i < 3000; i++) check = (check + new Rows().length + new Rows([i, i + 1]).length + new Pair(i, 1)[0] + new Keys().size + new Whole(i, i, i).length) % 100003;
lines.push("the run time is asked at most 60 times for 15000 calls of super: " + (asked() - before <= 60), check);
for (let i = 0; i < 3000; i++) check = (check + new Later(r => r(i), i).label) % 100003;
lines.push(check);
Promise.resolve().then(() => console.log(lines.join("\n")));
