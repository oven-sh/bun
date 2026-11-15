// COUNTER: CompiledObjectEnumeratorsFound >= 600
// for-in over instances below literals: the names follow from the structures and key orders of the instance and its chain, and every change of one of them, also during the loop, is seen.
const Base = { extend(fields) { const below = Object.create(this); if (fields) for (const name in fields) if (fields.hasOwnProperty(name)) below[name] = fields[name]; return below; }, kind: "base", create() { return this; } };
const List = Base.extend({ size: 0, tag: "list", concat() { return this; } });
function Words(words, bytes) { this.words = words; this.bytes = bytes; } Words.prototype = List;
class Point { constructor(x) { this.x = x; this.y = 1; } } Object.setPrototypeOf(Point.prototype, List);
globalThis.classes = { Words, Point };
const names = o => { const listed = []; for (const name in o) listed.push(name); return listed.join(); };
const own = o => { const listed = []; for (const name in o) { if (typeof o.hasOwnProperty === "function" ? o.hasOwnProperty(name) : Object.hasOwn(o, name)) listed.push(name + "=" + o[name]); } return listed.join(); };
let length = 0; for (let i = 0; i < 400; i++) length += names(i & 1 ? new globalThis.classes.Words([i], i) : new globalThis.classes.Point(i)).length + own(new Words(1, i)).length;
console.log(length, names(new Words(1, 2)), "|", names(new Point(3)));
const w = new Words([1], 2), v = new Words(3, 4), p = new Point(5);
const say = () => console.log(names(w), "|", names(v), "|", names(p), "|", own(w), "|", own(p), "|", names(List), "|", names(Base));
const changes = [
  () => { w.more = 1; }, () => { delete w.words; }, () => { w.words = 9; }, () => { List.added = 1; }, () => { delete List.added; }, () => { delete Base.kind; }, () => { Base.kind = 2; }, () => { Object.defineProperty(List, "size", { enumerable: false }); },
  () => { Object.defineProperty(w, "tag", { value: 1, enumerable: false, configurable: true }); }, () => { delete w.tag; }, () => { p[3] = "element"; }, () => { List[1] = "element"; }, () => { delete List[1]; }, () => { Object.defineProperty(Point.prototype, "late", { get() { return 1; }, enumerable: true, configurable: true }); },
  () => { delete Point.prototype.late; }, () => { Object.setPrototypeOf(w, { other: 1, __proto__: List }); }, () => { Object.setPrototypeOf(w, List); }, () => { Object.setPrototypeOf(List, { above: 1 }); }, () => { Object.setPrototypeOf(List, Base); }, () => { Object.freeze(Base); }, () => { w[Symbol("s")] = 1; },
  () => { v.bytes = undefined; }, () => { delete v.bytes; v.bytes = 5; }, () => { delete v.words; }, () => { Object.setPrototypeOf(List, new Proxy({ far: 1 }, { ownKeys() { return ["far", "near"]; }, getOwnPropertyDescriptor(t, k) { return { value: k, enumerable: true, configurable: true }; } })); }, () => { Object.setPrototypeOf(List, null); },
];
for (const change of changes) { change(); say(); say(); }
const Fields = { one: 1, two: 2, three: 3, __proto__: { four: 4, five: 5 } };
function Holder() { this.a = 1; this.b = 2; } Holder.prototype = Fields;
const steps = [() => {}, o => { delete o.b; }, () => { delete Fields.two; }, () => { Fields.six = 6; }, () => { Object.defineProperty(Fields, "three", { enumerable: false }); }, o => { o.late = 1; }, () => { delete Object.getPrototypeOf(Fields).five; }, o => { Object.setPrototypeOf(o, null); }, o => { Object.defineProperty(o, "four", { value: 1, enumerable: false }); }, o => { o.four = 1; }];
for (const step of steps) for (const at of ["a", "one", "two", "four"]) { const o = new Holder(); const seen = []; for (const name in o) { seen.push(name); if (name === at) step(o); } console.log(at, seen.join()); }
