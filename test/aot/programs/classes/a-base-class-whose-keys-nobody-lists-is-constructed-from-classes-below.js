// Nobody lists the keys of these objects. The base class fills its fields with constants, with what it is given and with nothing at all, and is entered by super(..) from two classes below it,
// by `new` on itself and by Reflect.construct, in turn and with collections in between. Each object holds what its own construction stored.
class Base {
  x = 1;
  on = true;
  label = "base";
  ratio = 0.5;
  none;
  constructor(given, tag) {
    this.given = given;
    this.tag = tag;
    this.twice = given * 2;
    if (given % 3 === 0) this.sometimes = tag + given;
    this.read = () => this.x + this.given;
  }
  kind() { return "Base"; }
}
class Derived extends Base {
  y = 2;
  constructor(given) { super(given, "derived"); this.x = given; }
  kind() { return "Derived"; }
}
class Other extends Base {
  constructor(given) { super(given, "other"); this.on = false; }
  kind() { return "Other"; }
}
function describe(o) {
  return [o.kind(), o.x, o.on, o.label, o.ratio, o.none, o.given % 3, o.tag, o.twice === o.given * 2, o.sometimes === undefined ? "-" : o.sometimes === o.tag + o.given, o.read() === o.x + o.given, o.y, o instanceof Base, o instanceof Derived, o instanceof Other].join(" | ");
}
const seen = new Map();
for (let i = 0; i < 3000; i++) {
  let o;
  switch (i % 5) {
  case 0: o = new Derived(i); break;
  case 1: o = new Other(i); break;
  case 2: o = new Base(i, "itself"); break;
  case 3: o = Reflect.construct(Base, [i, "reflected"], i % 2 ? Derived : Other); break;
  default: o = new Derived(-i); break;
  }
  const text = describe(o).replace(/-?\d{2,}/g, "n");
  seen.set(text, (seen.get(text) ?? 0) + 1);
  if (i % 700 === 699) Bun.gc(true);
}
for (const [text, count] of [...seen].sort()) console.log(count, text);
