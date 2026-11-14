// Long constructors that functions within nested iterations call, under every new.target.
const out = [];
const show = (v) => typeof v === "function" ? "fn" : typeof v === "object" && v ? JSON.stringify(v) + (Object.getPrototypeOf(v)?.constructor?.name ?? "none") : String(v);
const tell = (f) => { try { out.push(show(f())); } catch (e) { out.push(e.constructor.name); } };
class Place { constructor(start, end) { this.start = start; this.end = end; } }
let node = {};
{
  class Node {
    constructor(host, at, place) {
      this.type = ""; this.start = at; this.end = 0; this.place = new Place(place);
      if (host && host.options.ranges) this.range = [at, 0];
      if (host && host.filename) this.place.filename = host.filename;
      this.depth = host ? host.depth : -1; this.flags = at & 3; this.parent = null; this.kind = new.target === Node ? "own" : "other";
      for (let i = 0; i < 2; i++) this.count = i + at;
      if (at === 5) return { returned: at };
    }
    copy() { const c = new Node; for (const k in this) c[k] = this[k]; return c; }
    static make(at) { return new this(null, at, 1); }
  }
  node = Node;
}
const Node = node;
function Host(depth) { this.depth = depth; this.options = { ranges: depth > 1 }; this.filename = depth > 2 ? "f" + depth : undefined; }
{
  const hp = Host.prototype;
  hp.start = function (i) { return new Node(this, i, this.depth); };
  hp.startAt = function (i, place) { return new Node(this, i, place); };
  hp.parse = function (d, i) { if (d <= 0) return this.start(i); const n = this.startAt(i, d); n.left = this.parse(d - 1, i + 1); n.right = this.many(d - 2, i); return n; };
  hp.many = function (d, i) { const list = []; for (let k = 0; k < 3; k++) list.push(this.parse(d, i + k)); return list; };
}
function run(m) { let s = 0; for (let j = 0; j < m; j++) { const h = new Host(j & 3); for (let k = 0; k < 2; k++) s = (s * 31 + JSON.stringify(h.parse(3, j)).length) | 0; } return s; }
tell(() => run(1)); tell(() => run(40)); tell(() => new Host(3).start(9)); tell(() => Object.keys(new Host(3).start(9)).join());
tell(() => Reflect.construct(Node, [null, 1, 2], Array)); tell(() => Reflect.construct(Node, [new Host(3), 1, 2], Host));
class Heir extends Node { own = 4; constructor(...l) { super(...l); this.heir = 1; } }
tell(() => [new Heir(new Host(3), 1, 2), new Heir(null, 5, 2), run(3)]); tell(() => Heir.make(2)); tell(() => Node.make(5));
tell(() => new (Node.bind(null, new Host(2)))(1, 2)); tell(() => new (new Proxy(Node, {}))(null, 1, 2)); tell(() => Node.call({}, null, 1, 2));
tell(() => { let got = 0; const F = new Proxy(function () {}, { get(t, k) { got++; return t[k]; } }); return [Reflect.construct(Node, [null, 4, 0], F).kind, got]; });
tell(() => { const F = function () {}; F.prototype = { mark: 1 }; return Reflect.construct(Node, [null, 4, 0], F).mark; });
tell(() => { const F = function () {}; F.prototype = 5; return Object.getPrototypeOf(Reflect.construct(Node, [null, 4, 0], F)) === Object.prototype; });
tell(() => new Host(2).start(3).copy()); tell(() => { const n = new Host(2).start(3); n.late = 1; delete n.end; return n; }); tell(() => Object.isFrozen(Object.freeze(new Host(1).start(1))));
Object.defineProperty(Node.prototype, "flags", { set(v) { out.push("flags" + v); }, get() { return 6; }, configurable: true }); tell(() => run(1)); delete Node.prototype.flags;
Object.setPrototypeOf(Node.prototype, { extra: 1, set depth(v) { this.setTo = v; } }); tell(() => new Host(1).start(2)); tell(() => new Host(1).start(2).extra); tell(() => run(9));
for (const line of out) console.log(line);
