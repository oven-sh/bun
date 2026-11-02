// Members that are plain functions: function expressions and function declarations. They are function objects with all that comes with it: `new`, prototype, instanceof, name, length,
// own properties, a name of their own inside, and a `this` that the call gives.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}
function attempt(action: () => unknown) {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

interface Box {
  label: string;
  plain: (this: unknown, a?: number, b?: number) => string;
  self: () => unknown;
  who: (this: { label: string }) => string;
  declared: () => string;
  counts: () => number;
}
function box(label: string, flag?: boolean): Box {
  let calls = flag ? 10 : 0;
  const made: Box = {
    label,
    plain: function (a, b) {
      return "plain " + label + " " + typeof this + " " + a + " " + b;
    },
    self: function named() {
      return named;
    },
    who: function () {
      return "who " + this.label;
    },
    declared,
    counts,
  };
  return made;
  function declared() {
    return "declared " + label;
  }
  function counts() {
    return ++calls;
  }
}

const a = box("a");
const b = box("b", true);
const looseWho = a.who as () => string;
say("calls", a.plain(1, 2), a.who(), a.declared(), a.counts(), a.counts(), b.counts(), b.who.call({ label: "other" }), attempt(() => looseWho()));
say("identity", a.plain === a.plain, a.plain !== b.plain, a.self() === a.self, b.self() === b.self, a.self() !== b.self(), a.declared !== b.declared, a.declared === a.declared);

const c = box("c");
say("names", c.plain.name, c.self.name, c.who.name, c.declared.name, c.counts.name, c.plain.length, c.self.length, String(c.declared).replace(/\s+/g, " "), typeof c.plain, Object.prototype.toString.call(c.who));

// As constructors.
const d = box("d");
const Plain = d.plain as unknown as new (a?: number) => object;
const Declared = d.declared as unknown as new () => object;
const built = new Plain(1);
const builtAgain = new Declared();
say("new", built instanceof Plain, builtAgain instanceof Declared, built instanceof Declared, Object.getPrototypeOf(built) === Plain.prototype, Plain.prototype.constructor === d.plain, Declared.prototype === (d.declared as unknown as { prototype: object }).prototype, Object.keys(built).length);
const e = box("e");
say("prototype first", typeof (e.who as unknown as { prototype: object }).prototype, (e.who as unknown as { prototype: { constructor: unknown } }).prototype.constructor === e.who, "prototype" in e.counts, Object.getOwnPropertyNames(e.declared).sort().join());
say("construct", attempt(() => typeof Reflect.construct(box("f").declared, [])), attempt(() => Reflect.construct(Object, [], box("g").plain) instanceof Object));

// Properties of the function objects stay with them.
const h = box("h");
(h.plain as unknown as Record<string, unknown>).extra = "kept";
Object.defineProperty(h.declared, "name", { value: "renamed" });
say("own properties", (h.plain as unknown as Record<string, unknown>).extra, h.declared.name, Object.keys(h.plain).join(), (box("i").plain as unknown as Record<string, unknown>).extra);

// bind, call, apply, and handing the function on.
const j = box("j");
const bound = j.who.bind({ label: "bound" });
say("bind", bound(), bound.name, j.plain.call(5, 1), j.plain.apply("s", [1, 2]), [1].map(j.declared).join(), attempt(() => new (bound as unknown as new () => object)() instanceof (j.who as unknown as new () => object)));

// new.target inside, a class that extends a member, and Reflect.construct for another new.target.
interface Makers {
  label: string;
  target: (this: unknown) => string;
  Base: new (n: number) => { n: number; kind(): string };
  shaped: (this: { size?: number }, size: number) => void;
}
function makers(label: string, flag?: boolean): Makers {
  const suffix = flag ? "!" : "";
  const made = {
    label,
    target: function () {
      return label + suffix + (new.target === undefined ? " called" : new.target === made.target ? " constructed" : " constructed for another");
    },
    Base: function (this: { n: number }, n: number) {
      this.n = n;
    } as unknown as Makers["Base"],
    shaped,
  };
  made.Base.prototype.kind = function () {
    return "kind of " + label;
  };
  return made;
  function shaped(this: { size?: number }, size: number) {
    this.size = size;
  }
}
const k = makers("k");
const Target = k.target as unknown as new () => object;
say("new.target", k.target(), typeof new Target(), attempt(() => typeof Reflect.construct(Target, [], Object)), makers("l", true).target());
const m = makers("m");
class Below extends m.Base {
  more = () => this.n + 1;
}
const below = new Below(4);
say("extends", below.n, below.more(), below.kind(), below instanceof m.Base, below instanceof makers("n").Base, Object.getPrototypeOf(Below) === m.Base, Object.getPrototypeOf(Below.prototype) === m.Base.prototype);
const o = makers("o");
const Shaped = o.shaped as unknown as new (size: number) => { size: number };
const shapedObject = new Shaped(3);
const forOther = Reflect.construct(Shaped, [5], m.Base) as { size: number };
const target = { size: 0 };
o.shaped.call(target, 9);
say("shaped", shapedObject.size, shapedObject instanceof Shaped, forOther.size, forOther instanceof m.Base, forOther instanceof Shaped, target.size, Shaped === (o.shaped as unknown));

// Many, most of them never touched.
const many: Box[] = [];
for (let i = 0; i < 200; i++) many.push(box("m" + i, i % 2 === 0));
let total = 0;
for (let i = 0; i < many.length; i += 10) total += many[i].counts();
say("many", total, many[7].declared(), many[8].who(), many[9].self() === many[9].self, Object.keys(many[3]).join());

console.log(lines.join("\n"));
