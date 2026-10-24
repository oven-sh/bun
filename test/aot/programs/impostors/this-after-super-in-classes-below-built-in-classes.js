class Failure extends Error {
  code = 1;
  constructor(message) {
    super(message);
    this.extra = message.length;
  }
}
class Worse extends Failure {
  level = "worse";
  constructor(message) {
    super(message + "!");
    this.more = this.extra + 1;
  }
}
class List extends Array {
  label = "list";
  constructor(...items) {
    super(...items);
    this.count = this.length;
  }
}
class Table extends Map {
  name = "table";
  constructor(entries) {
    super(entries);
    this.filled = this.size;
  }
}
class Later extends Promise {
  tag = "later";
  constructor(run) {
    super(run);
    this.made = true;
  }
}
class Callable extends Function {
  kind = "callable";
  constructor() {
    super("return 7");
    this.ready = true;
  }
}
class Bytes extends Uint8Array {
  unit = "byte";
  constructor(length) {
    super(length);
    this.total = this.byteLength;
  }
}
class Plain extends Object {
  a = 1;
  constructor() {
    super();
    this.b = 2;
  }
}
class Bare extends null {
  constructor() {
    return Object.create(Bare.prototype);
  }
}

for (let round = 0; round < 3; round++) {
  const f = new Failure("no");
  console.log(Object.keys(f).join(), f.code, f.extra, f.message, f instanceof Error, typeof f.stack, Object.prototype.toString.call(f));
  const w = new Worse("no");
  console.log(Object.keys(w).join(), w.code, w.extra, w.level, w.more, w.message, w instanceof Failure);
  const l = new List(1, 2, 3);
  l.push(4);
  console.log(Object.keys(l).join(), l.label, l.count, l.length, Array.isArray(l), l.map(x => x * 2) instanceof List);
  const t = new Table([[1, 2]]);
  console.log(Object.keys(t).join(), t.name, t.filled, t.get(1), t instanceof Map);
  const p = new Later(resolve => resolve(1));
  console.log(Object.keys(p).join(), p.tag, p.made, p instanceof Promise, p.then(() => 0) instanceof Later);
  const c = new Callable();
  console.log(Object.keys(c).join(), c.kind, c.ready, c(), typeof c);
  const b = new Bytes(4);
  console.log(Object.keys(b).join(), b.unit, b.total, b.length, ArrayBuffer.isView(b));
  const o = new Plain();
  console.log(Object.keys(o).join(), o.a, o.b, Object.getPrototypeOf(o) === Plain.prototype);
  console.log(Object.keys(new Bare()).length, Object.getPrototypeOf(new Bare()) === Bare.prototype);
  const r = Reflect.construct(Failure, ["r"], Plain);
  console.log(Object.keys(r).join(), r.code, r.extra, r.message, r instanceof Error, r instanceof Plain, Object.prototype.toString.call(r));
  const s = Reflect.construct(Plain, [], Failure);
  console.log(Object.keys(s).join(), s.a, s.b, s instanceof Failure, Object.prototype.toString.call(s));
}
