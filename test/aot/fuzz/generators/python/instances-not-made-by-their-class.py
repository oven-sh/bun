#!/usr/bin/env python3
"""instances-not-made-by-their-class.py <seed> [js|ts]: a compiler that lays out classes likes to think that an instance of C was allocated for C and went through the constructors above C and C's own, in order, to the end. The language promises none of that. Each program has a family A > B whose honest instances run hot, then lets objects come to B's prototype, B's fields or B's private names by another door (`doors` below; the seed picks the door, how the fields are written and how the readers are written), and reads them every way: by name, in arithmetic, through methods of the family, through private names, in a function that the honest instances have warmed up. Every line is as in plain Bun."""
import sys

seed = int(sys.argv[1])
language = sys.argv[2] if len(sys.argv) > 2 else "js"


def text_for(language, text):
    """«..» stands in TypeScript alone, ‹..› in JavaScript alone: TypeScript refuses it."""
    out = []
    only = []
    for c in text:
        if c == "«":
            only.append("ts")
        elif c == "‹":
            only.append("js")
        elif c in "»›":
            only.pop()
        elif all(each == language for each in only):
            out.append(c)
    return "".join(out)


PRELUDE = """
function errorName(error«: unknown»)«: string» {
  return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
}
function describe(value«: unknown», depth«: number» = 0)«: string» {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return "symbol";
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 1) return "..";
  if (Array.isArray(value)) return "[" + value.map(each => describe(each, depth + 1)).join() + "]";
  return "{" + Object.keys(value).map(key => key + ":" + describe((value «as any»)[key], depth + 1)).join() + "}";
}
function probe(label«: string», run«: () => unknown»)«: void» {
  let text«: string»;
  try {
    text = describe(run());
  } catch (error) {
    text = errorName(error);
  }
  console.log(label + " " + text);
}
const notes«: string[]» = [];
function note(text«: string»)«: void» {
  notes.push(text);
}
"""

# The fields of A and of B, written as stores in the constructor or as field initializers.
def family(style, a_head="", a_middle="", a_tail="", b_head="", b_before_super="", b_super="super(seed);", b_middle="", b_tail="", a_parameters="seed«: number»", b_parameters="seed«: number»", b_extends="A", a_static="", b_static="", b_constructor=None):
    if style == "stores":
        a_fields = "  «declare n: number; declare i: number; declare s: string; declare o: { k: number };»\n  #p = 7.5;"
        a_body = "%s this.n = seed + 0.5; this.i = seed | 0; %s this.s = \"s\" + seed; this.o = { k: seed }; %s" % (a_head, a_middle, a_tail)
        b_fields = "  «declare x: number; declare t: string; declare q: { z: number };»\n  #y = 3.5;"
        b_body = "%s %s %s this.x = seed + 0.25; %s this.t = \"t\" + seed; this.q = { z: seed }; %s" % (b_before_super, b_super, b_head, b_middle, b_tail)
    else:
        a_fields = "  n«: number» = 1.5;\n  i«: number» = 1;\n  s«: string» = \"s1\";\n  o«: { k: number }» = { k: 1 };\n  #p = 7.5;"
        a_body = "%s %s %s" % (a_head, a_middle, a_tail)
        b_fields = "  x«: number» = 1.25;\n  t«: string» = \"t1\";\n  q«: { z: number }» = { z: 1 };\n  #y = 3.5;"
        b_body = "%s %s %s %s %s" % (b_before_super, b_super, b_head, b_middle, b_tail)
    if b_constructor is not None:
        b_body = b_constructor
    return """
class A {
%s
%s
  constructor(%s) { %s }
  sum()«: number» { return this.n + this.i; }
  len()«: number» { return this.s.length; }
  deep()«: number» { return this.o.k; }
  getP()«: number» { return this.#p; }
  static hasP(value«: any»)«: boolean» { return #p in value; }
}
class B extends %s {
%s
%s
  constructor(%s) { %s }
  more()«: number» { return this.x + this.n; }
  wide()«: number» { return this.t.length + this.s.length; }
  under()«: number» { return this.q.z + this.o.k; }
  getY()«: number» { return this.#y; }
  static hasY(value«: any»)«: boolean» { return #y in value; }
}
""" % (a_fields, a_static, a_parameters, a_body, b_extends, b_fields, b_static, b_parameters, b_body)


READERS = {
    # What the honest instances warm up.
    "plain": """
function hot(v«: B»)«: number» {
  return v.n * 2 + v.i + v.s.length + v.o.k + v.x + v.t.length + v.q.z;
}
function hotMethods(v«: B»)«: number» {
  return v.sum() + v.len() + v.deep() + v.more() + v.wide() + v.under();
}
function hotPrivate(v«: B»)«: number» {
  return v.getP() + v.getY();
}
""",
    "tested": """
function hot(v«: unknown»)«: number» {
  if (!(v instanceof B)) return -1;
  return v.n * 2 + v.i + v.s.length + v.o.k + v.x + v.t.length + v.q.z;
}
function hotMethods(v«: unknown»)«: number» {
  if (!(v instanceof A)) return -1;
  return v.sum() + v.len() + v.deep() + (v instanceof B ? v.more() + v.wide() + v.under() : 0);
}
function hotPrivate(v«: unknown»)«: number» {
  if (!B.hasY(v) || !A.hasP(v)) return -1;
  return (v «as B»).getP() + (v «as B»).getY();
}
""",
}

READ_ALL = """
function total(list«: B[]»)«: number» {
  let sum = 0;
  for (let index = 0; index < list.length; index++) sum += list[index].n + list[index].x + list[index].s.length + list[index].q.z;
  return sum;
}
function totalOfMethods(list«: B[]»)«: number» {
  let sum = 0;
  for (const each of list) sum += each.sum() + each.more() + each.getP() + each.getY();
  return sum;
}
class Holder {
  «declare held: B;»
  constructor(held«: B») { this.held = held; }
  read()«: number» { return this.held.n + this.held.x + this.held.t.length + this.held.o.k; }
}
function pass(v«: B»)«: B» {
  return v;
}
function* walk(v«: B»)«: Generator<unknown>» {
  yield v.n;
  yield v.x + 1;
  yield v.s.length;
  yield v.getY();
}
function readAll(name«: string», given«: unknown»)«: void» {
  const v = given «as B»;
  probe(name + " in a list", () => total([honest[0], v, honest[1]]));
  probe(name + " in a list, methods", () => totalOfMethods([honest[0], v, honest[1]]));
  probe(name + " in a holder", () => new Holder(v).read());
  probe(name + " passed on", () => pass(v).n + pass(v).x);
  probe(name + " in a generator", () => [...walk(v)]);
  probe(name + " in a map", () => { const map = new Map«<string, B>»([["k", v]]); return map.get("k")«!».n + map.get("k")«!».x; });
  probe(name + " with a default", () => { const { n = "none", x = "none", t = "none" } = v «as any»; return [n, x, t]; });
  probe(name + " n", () => v.n);
  probe(name + " n+1", () => v.n + 1);
  probe(name + " i|0", () => v.i | 0);
  probe(name + " i*2", () => v.i * 2);
  probe(name + " s", () => v.s);
  probe(name + " s.length", () => v.s.length);
  probe(name + " o", () => v.o);
  probe(name + " o.k", () => v.o.k);
  probe(name + " x", () => v.x);
  probe(name + " x+1", () => v.x + 1);
  probe(name + " t", () => v.t);
  probe(name + " t.length", () => v.t.length);
  probe(name + " q", () => v.q);
  probe(name + " q.z", () => v.q.z);
  probe(name + " sum", () => A.prototype.sum.call(v));
  probe(name + " len", () => A.prototype.len.call(v));
  probe(name + " deep", () => A.prototype.deep.call(v));
  probe(name + " more", () => B.prototype.more.call(v));
  probe(name + " wide", () => B.prototype.wide.call(v));
  probe(name + " under", () => B.prototype.under.call(v));
  probe(name + " own sum", () => v.sum());
  probe(name + " own more", () => v.more());
  probe(name + " getP", () => A.prototype.getP.call(v));
  probe(name + " getY", () => B.prototype.getY.call(v));
  probe(name + " hasP", () => A.hasP(v));
  probe(name + " hasY", () => B.hasY(v));
  probe(name + " hot", () => hot(v));
  probe(name + " hotMethods", () => hotMethods(v));
  probe(name + " hotPrivate", () => hotPrivate(v));
  probe(name + " keys", () => Object.keys(v).join());
  probe(name + " in", () => ["n", "i", "s", "o", "x", "t", "q"].map(key => key in v).join());
  probe(name + " is", () => [v instanceof A, v instanceof B, Object.getPrototypeOf(v) === B.prototype, Object.getPrototypeOf(v) === A.prototype].join());
  probe(name + " spread", () => ({ ...v }));
  probe(name + " destructured", () => { const { n, s, x, t } = v; return [n, s, x, t]; });
  probe(name + " json", () => JSON.stringify(v));
}
"""

WARM = """
const honest«: B[]» = [%s];
let warm = 0;
for (let turn = 0; turn < 300; turn++) for (const each of honest) warm += hot(each) + hotMethods(each) + hotPrivate(each) + total(honest) + totalOfMethods(honest) + new Holder(each).read() + pass(each).n;
console.log("warm " + warm);
const victims«: [string, unknown][]» = [];
function take(name«: string», make«: () => unknown»)«: void» {
  try {
    victims.push([name, make()]);
  } catch (error) {
    console.log(name + " is not made: " + errorName(error));
  }
}
"""

END = """
for (const [name, victim] of victims) readAll(name, victim);
readAll("honest", honest[0]);
readAll("fresh", %s);
console.log("notes " + notes.join(" | "));
"""

OTHER = """
class Other {
  t«: string» = "other";
  n«: string» = "text";
  extra«: number» = 9.5;
}
"""


def door_base_returns_another_object(style):
    classes = family(style, a_parameters="seed«: number», other«?: object»", a_head="if (other !== undefined) return other «as any»;", b_parameters="seed«: number», other«?: object»", b_super="super(seed, other);")
    makes = """
const twice = {};
const stamped = new B(5);
take("literal", () => new B(3, {}));
take("literal with fields", () => new B(3, { n: "text", x: "text", q: null }));
take("other class", () => new B(3, new Other()));
take("first time", () => new B(3, twice));
take("second time", () => new B(3, twice));
take("frozen", () => new B(3, Object.freeze({})));
take("sealed", () => new B(3, Object.seal({ x: 1 })));
take("not extensible", () => new B(3, Object.preventExtensions({})));
take("proxy", () => new B(3, new Proxy({}, {})));
take("array", () => new B(3, [1, 2]));
take("function", () => new B(3, function () {}));
take("no prototype", () => new B(3, Object.create(null)));
take("an A", () => new B(3, new A(4)));
take("a B", () => new B(3, stamped));
take("the B behind it", () => stamped);
take("the prototype", () => new B(3, B.prototype));
"""
    return OTHER + classes, makes, "new B(1), new B(2)", "new B(6)"


def door_half_made_objects_leak(style):
    classes = """
let leaked«: unknown[]» = [];
let reads = false;
function leak(where«: string», value«: unknown»)«: number» {
  leaked.push(value);
  if (reads) readAll(where, value);
  return 0;
}
""" + family(style, a_middle='leak("in the middle of A", this);', a_tail='leak("at the end of A", this);', b_head='leak("behind super", this);', b_middle='leak("in the middle of B", this);')
    makes = """
leaked = [];
reads = true;
take("made while read", () => new B(3));
reads = false;
leaked.forEach((value, index) => take("leaked " + index, () => value));
"""
    return classes, makes, "new B(1), new B(2)", "new B(6)"


def door_constructors_throw_halfway(style):
    classes = """
let escaped«: unknown» = null;
""" + family(style, a_middle='if (seed === -1) { escaped = this; throw new RangeError("A"); }', a_tail='if (seed === -2) { escaped = this; throw new RangeError("A"); }', b_head='if (seed === -3) { escaped = this; throw new RangeError("B"); }', b_middle='if (seed === -4) { escaped = this; throw new RangeError("B"); }', b_tail='if (seed === -5) { escaped = this; throw new RangeError("B"); }')
    makes = "".join("""
take("throws at %d", () => new B(%d));
take("escaped at %d", () => escaped);
""" % (at, at, at) for at in (-1, -2, -3, -4, -5))
    return classes, makes, "new B(1), new B(2)", "new B(6)"


def door_initializers_leak_this(style):
    classes = """
let leaked«: unknown[]» = [];
let reads = false;
function leak«<T>»(where«: string», value«: unknown», answer«: T»)«: T» {
  leaked.push(value);
  if (reads) readAll(where, value);
  return answer;
}
class A {
  n«: number» = leak("before n", this, 1.5);
  i«: number» = 1;
  s«: string» = leak("before s", this, "s1");
  o«: { k: number }» = { k: 1 };
  #p = leak("before #p", this, 7.5);
  constructor(seed«: number») {}
  sum()«: number» { return this.n + this.i; }
  len()«: number» { return this.s.length; }
  deep()«: number» { return this.o.k; }
  getP()«: number» { return this.#p; }
  static hasP(value«: any»)«: boolean» { return #p in value; }
}
class B extends A {
  x«: number» = leak("before x", this, 1.25);
  t«: string» = "t1";
  #y = leak("before #y", this, 3.5);
  q«: { z: number }» = leak("before q", this, { z: 1 });
  constructor(seed«: number») { super(seed); }
  more()«: number» { return this.x + this.n; }
  wide()«: number» { return this.t.length + this.s.length; }
  under()«: number» { return this.q.z + this.o.k; }
  getY()«: number» { return this.#y; }
  static hasY(value«: any»)«: boolean» { return #y in value; }
}
"""
    makes = """
leaked = [];
reads = true;
take("made while read", () => new B(3));
reads = false;
"""
    return classes, makes, "new B(1), new B(2)", "new B(6)"


def door_super_in_odd_places(style):
    stores = 'this.x = seed + 0.25; this.t = "t" + seed; this.q = { z: seed };' if style == "stores" else ""
    constructor = """
    switch (how) {
    case "twice":
      super(seed);
      try { super(seed + 1); } catch (error) { note("second super " + errorName(error)); }
      break;
    case "finally":
      try { if (seed > 0) throw new RangeError("first"); } catch (error) { note("caught"); } finally { super(seed); }
      break;
‹    case "arrow": {
      const later = () => super(seed);
      held = later;
      later();
      break;
    }
    case "arrow in a callback":
      [0].forEach(() => { super(seed); });
      break;
›‹    case "never":
      break;
›    case "never, an object":
      return Object.create(B.prototype);
    case "never, a literal":
      return { n: "text" } «as any»;
‹    case "this first":
      try { note("this " + typeof this); } catch (error) { note("this first " + errorName(error)); }
      super(seed);
      break;
›    case "returns a number":
      super(seed);
      %s
      return 1 «as any»;
    case "returns another":
      super(seed);
      %s
      return new A(seed + 1) «as any»;
    default:
      super(seed);
    }
    %s
""" % (stores, stores, stores)
    classes = "let held«: (() => unknown) | null» = null;\n" + family(style, b_parameters='seed«: number», how«: string» = ""', b_constructor=constructor)
    hows = ["twice", "finally", "arrow", "arrow in a callback", "never", "never, an object", "never, a literal", "this first", "returns a number", "returns another"]
    makes = "".join('take(%r, () => new B(3, %r));\n' % (how, how) for how in hows) + 'take("the arrow again", () => held«!»());\n'
    return classes, makes.replace("'", '"'), "new B(1), new B(2)", "new B(6)"


def door_new_targets(style):
    classes = OTHER + family(style)
    makes = """
function Plain(«this: any») {}
function Stores(«this: any, »seed«: number») { this.n = seed; this.x = "text"; }
function Target() {}
const boundB = B.bind(null);
let turns = 0;
const proxyB = new Proxy(B, {});
const fickle = new Proxy(B, { get(target, key, receiver) { return key === "prototype" ? (turns++ & 1 ? Other.prototype : B.prototype) : Reflect.get(target, key, receiver); } });
take("A for B", () => Reflect.construct(A, [3], B));
take("B for A", () => Reflect.construct(B, [3], A));
take("A for Other", () => Reflect.construct(A, [3], Other));
take("B for Other", () => Reflect.construct(B, [3], Other));
take("Other for B", () => Reflect.construct(Other, [], B));
take("Other for A", () => Reflect.construct(Other, [], A));
take("a function for B", () => Reflect.construct(Plain, [3], B));
take("a function for A", () => Reflect.construct(Plain, [3], A));
take("a function that stores for B", () => Reflect.construct(Stores, [3], B));
take("Object for B", () => Reflect.construct(Object, [], B));
take("Array for B", () => Reflect.construct(Array, [], B));
take("Map for B", () => Reflect.construct(Map, [], B));
take("Error for B", () => Reflect.construct(Error, ["m"], B));
take("A for a bound B", () => Reflect.construct(A, [3], boundB));
take("B for a bound B", () => Reflect.construct(B, [3], boundB));
take("the bound B", () => new boundB(3));
take("A for a proxy of B", () => Reflect.construct(A, [3], proxyB));
take("the proxy of B", () => new proxyB(3));
take("fickle 0", () => Reflect.construct(A, [3], fickle));
take("fickle 1", () => Reflect.construct(A, [3], fickle));
take("fickle 2", () => new fickle(3));
take("fickle 3", () => new fickle(3));
Target.prototype = B.prototype;
take("A for a function under B.prototype", () => Reflect.construct(A, [3], Target));
take("B for a function under B.prototype", () => Reflect.construct(B, [3], Target));
Target.prototype = Other.prototype «as any»;
take("A for the function under Other.prototype", () => Reflect.construct(A, [3], Target));
Target.prototype = null «as any»;
take("B for the function under null", () => Reflect.construct(B, [3], Target));
Target.prototype = 5 «as any»;
take("A for the function under a number", () => Reflect.construct(A, [3], Target));
"""
    return classes, makes, "new B(1), new B(2)", "new B(6)"


def door_prototypes_given_by_hand(style):
    classes = OTHER + family(style)
    makes = """
take("Object.create(B.prototype)", () => Object.create(B.prototype));
take("Object.create(A.prototype)", () => Object.create(A.prototype));
take("created with descriptors", () => Object.create(B.prototype, { n: { value: 4.5, enumerable: true }, s: { get() { return "got"; }, enumerable: true } }));
take("a literal put under B.prototype", () => Object.setPrototypeOf({ n: "text", x: 2 }, B.prototype));
take("a literal with all the names", () => Object.setPrototypeOf({ n: 1.5, i: 1, s: "s", o: { k: 1 }, x: 1.25, t: "t", q: { z: 1 } }, B.prototype));
take("all the names in another order", () => Object.setPrototypeOf({ q: { z: 1 }, t: "t", x: 1.25, o: { k: 1 }, s: "s", i: 1, n: 1.5 }, B.prototype));
take("__proto__ in a literal", () => ({ __proto__: B.prototype, n: 4.5, t: 7 }));
take("an Other put under B.prototype", () => Object.setPrototypeOf(new Other(), B.prototype));
take("an A put under B.prototype", () => Object.setPrototypeOf(new A(3), B.prototype));
take("a B put under A.prototype", () => Object.setPrototypeOf(new B(3), A.prototype));
take("a B put under Other.prototype", () => Object.setPrototypeOf(new B(3), Other.prototype));
take("a B put under null", () => Object.setPrototypeOf(new B(3), null));
take("a B put under a B", () => Object.setPrototypeOf(new B(3), new B(4)));
take("an object under a B", () => Object.create(new B(3)));
take("an array put under B.prototype", () => Object.setPrototypeOf([1, 2], B.prototype));
take("a function put under B.prototype", () => Object.setPrototypeOf(function () {}, B.prototype));
take("B.prototype", () => B.prototype);
take("A.prototype", () => A.prototype);
take("B", () => B);
take("a number", () => 5);
take("a string", () => "text");
take("null", () => null);
take("undefined", () => undefined);
"""
    return classes, makes, "new B(1), new B(2)", "new B(6)"


def door_copies(style):
    classes = family(style)
    makes = """
take("structuredClone", () => structuredClone(new B(3)));
take("JSON", () => JSON.parse(JSON.stringify(new B(3))));
take("spread", () => ({ ...new B(3) }));
take("Object.assign on a literal", () => Object.assign({}, new B(3)));
take("Object.assign under B.prototype", () => Object.assign(Object.create(B.prototype), new B(3)));
take("Object.assign on a B", () => Object.assign(new B(3), { n: "text", q: null, extra: 1 }));
take("Object.assign of an A on a B", () => Object.assign(new B(3), new A(4)));
take("entries", () => Object.fromEntries(Object.entries(new B(3))));
take("descriptors", () => Object.create(B.prototype, Object.getOwnPropertyDescriptors(new B(3))));
take("JSON with other kinds", () => JSON.parse('{"n":"text","i":1.5,"s":5,"o":null,"x":{},"t":[],"q":7}'));
take("JSON under B.prototype", () => Object.setPrototypeOf(JSON.parse('{"n":"text","i":1.5,"s":5,"o":null,"x":{},"t":[],"q":7}'), B.prototype));
take("JSON with fewer names", () => Object.setPrototypeOf(JSON.parse('{"n":2.5,"t":"tt"}'), B.prototype));
"""
    return classes, makes, "new B(1), new B(2)", "new B(6)"


def door_has_instance(style):
    classes = OTHER + family(style, b_static="  static [Symbol.hasInstance](value«: unknown»)«: boolean» { return answers; }")
    classes = "let answers = true;\n" + classes
    makes = """
take("a literal", () => ({}));
take("an Other", () => new Other());
take("an A", () => new A(3));
take("a number", () => 5);
take("null", () => null);
answers = false;
take("a B that is refused", () => new B(3));
"""
    return classes, makes, "new B(1), new B(2)", "new B(6)"


def door_has_instance_defined_later(style):
    classes = OTHER + family(style)
    makes = """
Object.defineProperty(B, Symbol.hasInstance, { value: () => true });
Object.defineProperty(A, Symbol.hasInstance, { value: (value«: unknown») => typeof value === "object" });
take("a literal", () => ({}));
take("an Other", () => new Other());
take("an A", () => new A(3));
take("a number", () => 5);
take("null", () => null);
"""
    return classes, makes, "new B(1), new B(2)", "new B(6)"


def door_parents_replaced(style):
    classes = OTHER + family(style)
    makes = """
function Plain(«this: any») {}
function Stores(«this: any, »seed«: number») { this.n = "text"; this.extra = seed; }
function Answers() { return { n: "answered" }; }
const parents«: [string, any][]» = [["a function", Plain], ["a function that stores", Stores], ["a function that answers an object", Answers], ["Other", Other], ["Object", Object], ["Array", Array], ["a bound function", Plain.bind(null)], ["a bound A", A.bind(null)], ["a proxy of A", new Proxy(A, {})], ["an arrow", () => {}], ["null", null], ["Function.prototype", Function.prototype], ["A again", A]];
for (const [name, parent] of parents) {
  Object.setPrototypeOf(B, parent);
  take("B below " + name, () => new B(3));
}
"""
    return classes, makes, "new B(1), new B(2)", "new B(6)"


def door_prototype_objects_replaced(style):
    classes = OTHER + family(style)
    makes = """
Object.setPrototypeOf(B.prototype, Other.prototype);
take("B.prototype below Other.prototype", () => new B(3));
Object.setPrototypeOf(B.prototype, null);
take("B.prototype below null", () => new B(3));
Object.setPrototypeOf(B.prototype, { sum() { return "replaced"; }, get s() { return "got"; }, set s(value) { note("set s"); } });
take("B.prototype below a literal with an accessor", () => new B(3));
Object.setPrototypeOf(B.prototype, new Proxy(A.prototype, {}));
take("B.prototype below a proxy", () => new B(3));
Object.setPrototypeOf(B.prototype, A.prototype);
take("B.prototype below A.prototype again", () => new B(3));
"""
    return classes, makes, "new B(1), new B(2)", "new B(6)"


def door_accessors_take_the_stores(style):
    classes = family(style)
    makes = """
let caught«: unknown» = null;
Object.defineProperty(A.prototype, "s", { configurable: true, get() { return "from above"; }, set(value) { caught = this; note("s = " + value); } });
take("s is an accessor above A", () => new B(3));
take("caught in the setter", () => caught);
delete (A.prototype «as any»).s;
Object.defineProperty(B.prototype, "o", { configurable: true, get() { return { k: -1 }; } });
take("o is a getter above B", () => new B(3));
delete (B.prototype «as any»).o;
Object.defineProperty(A.prototype, "x", { configurable: true, value: "fixed", writable: false });
take("x is read-only above", () => new B(3));
delete (A.prototype «as any»).x;
take("all of it gone again", () => new B(3));
"""
    return classes, makes, "new B(1), new B(2)", "new B(6)"


def door_heritage_is_an_expression(style):
    classes = OTHER + "let pick = 0;\nfunction choose()«: typeof A» { return (pick++ ? Other : A) «as any»; }\n" + family(style, b_extends="choose()")
    classes += """
function make()«: any» {
  return class extends choose() {
    x«: number» = 1.25;
    t«: string» = "t1";
    q«: { z: number }» = { z: 1 };
  };
}
"""
    makes = """
const Second = make();
take("a class below Other", () => new Second(3));
pick = 0;
const Third = make();
take("a class below A", () => new Third(3));
take("that class for B", () => Reflect.construct(Third, [3], B));
take("B for that class", () => Reflect.construct(B, [3], Third));
"""
    return classes, makes, "new B(1), new B(2)", "new B(6)"


BUILTINS = [
    ("Array", "", "[]", "v.length"),
    ("Map", "", "[]", "v.size"),
    ("Set", "", "[]", "v.size"),
    ("Error", '"m"', '["m"]', "v.message"),
    ("Promise", "() => {}", "[() => {}]", "typeof v.then"),
    ("RegExp", '"a+"', '["a+"]', "v.source"),
    ("Uint8Array", "2", "[2]", "v.length"),
    ("Float64Array", "2", "[2]", "v.length"),
    ("Date", "0", "[0]", "v.getTime()"),
    ("ArrayBuffer", "8", "[8]", "v.byteLength"),
    ("Object", "", "[]", "typeof v"),
    ("Boolean", "true", "[true]", "v.valueOf()"),
    ("String", '"abc"', '["abc"]', "v.length"),
    ("WeakMap", "", "[]", "typeof v.get"),
]


def door_derived_builtins(style, builtin):
    name, argument, arguments, own = builtin
    stores = style == "stores"
    fields = "  «declare x: number; declare t: string; declare q: { z: number };»\n  #y = 3.5;\n  constructor(given«?: any») { super(given); this.x = 1.25; this.t = \"t1\"; this.q = { z: 1 }; }" if stores else "  x«: number» = 1.25;\n  t«: string» = \"t1\";\n  q«: { z: number }» = { z: 1 };\n  #y = 3.5;"
    return """
class D extends %(name)s«%(generic)s» {
%(fields)s
  more()«: number» { return this.x + this.t.length + this.q.z; }
  getY()«: number» { return this.#y; }
  static hasY(value«: any»)«: boolean» { return #y in value; }
}
class Other { t«: string» = "other"; extra«: number» = 9.5; }
function hot(v«: D»)«: number» { return v.x + v.t.length + v.q.z + v.more() + v.getY(); }
function readAll(name«: string», given«: unknown»)«: void» {
  const v = given «as any»;
  const d = given «as D»;
  probe(name + " x", () => d.x);
  probe(name + " x+1", () => d.x + 1);
  probe(name + " t", () => d.t);
  probe(name + " t.length", () => d.t.length);
  probe(name + " q", () => d.q);
  probe(name + " q.z", () => d.q.z);
  probe(name + " more", () => D.prototype.more.call(d));
  probe(name + " getY", () => D.prototype.getY.call(d));
  probe(name + " hasY", () => D.hasY(d));
  probe(name + " hot", () => hot(d));
  probe(name + " own", () => %(own)s);
  probe(name + " keys", () => Object.keys(v).join());
  probe(name + " is", () => [v instanceof D, v instanceof %(name)s, Object.getPrototypeOf(v) === D.prototype].join());
}
const honest«: D[]» = [new D(%(argument)s), new D(%(argument)s)];
let warm = 0;
for (let turn = 0; turn < 300; turn++) for (const each of honest) warm += hot(each);
console.log("warm " + warm);
const victims«: [string, unknown][]» = [];
function take(name«: string», make«: () => unknown»)«: void» {
  try {
    victims.push([name, make()]);
  } catch (error) {
    console.log(name + " is not made: " + errorName(error));
  }
}
function Plain(«this: any») {}
take("the built-in for D", () => Reflect.construct(%(name)s, %(arguments)s, D));
take("D for the built-in", () => Reflect.construct(D, %(arguments)s, %(name)s));
take("D for Other", () => Reflect.construct(D, %(arguments)s, Other));
take("Other for D", () => Reflect.construct(Other, [], D));
take("a function for D", () => Reflect.construct(Plain, [], D));
take("Object for D", () => Reflect.construct(Object, [], D));
take("Object.create", () => Object.create(D.prototype));
take("the built-in put under D.prototype", () => Object.setPrototypeOf(new %(name)s(%(argument)s), D.prototype));
take("a literal put under D.prototype", () => Object.setPrototypeOf({ x: "text" }, D.prototype));
take("D.prototype", () => D.prototype);
Object.setPrototypeOf(D, Plain);
take("D below a function", () => new D(%(argument)s));
Object.setPrototypeOf(D, Other);
take("D below Other", () => new D(%(argument)s));
Object.setPrototypeOf(D, Object);
take("D below Object", () => new D(%(argument)s));
Object.setPrototypeOf(D, %(name)s);
take("D below the built-in again", () => new D(%(argument)s));
for (const [name, victim] of victims) readAll(name, victim);
readAll("honest", honest[0]);
""" % {"name": name, "generic": {"Array": "<number>", "Map": "<string, number>", "Set": "<number>", "Promise": "<number>", "WeakMap": "<object, number>"}.get(name, ""), "fields": fields, "own": own, "argument": argument, "arguments": arguments}


def door_species(style):
    stores = style == "stores"
    fields = "  «declare x: number; declare t: string;»\n  constructor(given«?: any») { super(given); this.x = 1.25; this.t = \"t1\"; }" if stores else "  x«: number» = 1.25;\n  t«: string» = \"t1\";"
    return """
let species«: any» = undefined;
class L extends Array«<number>» {
%s
  static get [Symbol.species]()«: any» { return species === undefined ? this : species; }
  more()«: number» { return this.x + this.t.length + this.length; }
}
class Other extends Array«<number>» { t«: number» = 5; }
function Plain(«this: any, »length«: number») { this.length = 0; }
function hot(v«: L»)«: number» { return v.x + v.t.length + v.more(); }
function readAll(name«: string», given«: unknown»)«: void» {
  const v = given «as L»;
  probe(name + " x", () => v.x);
  probe(name + " x+1", () => v.x + 1);
  probe(name + " t", () => v.t);
  probe(name + " t.length", () => v.t.length);
  probe(name + " more", () => L.prototype.more.call(v));
  probe(name + " hot", () => hot(v));
  probe(name + " length", () => v.length);
  probe(name + " elements", () => Array.prototype.join.call(v));
  probe(name + " is", () => [v instanceof L, Array.isArray(v), Object.getPrototypeOf(v) === L.prototype].join());
}
const list = L.from([1, 2, 3]) «as L»;
let warm = 0;
for (let turn = 0; turn < 300; turn++) warm += hot(list) + hot(list.map(each => each * 2) «as L»);
console.log("warm " + warm);
for (const [name, constructor] of [["itself", undefined], ["Array", Array], ["Other", Other], ["a function", Plain], ["null", null], ["Object", Object]] «as [string, any][]») {
  species = constructor;
  for (const [how, run] of [["map", () => list.map(each => each * 2)], ["filter", () => list.filter(each => each > 1)], ["slice", () => list.slice(1)], ["concat", () => list.concat([4])], ["splice", () => L.from([1, 2, 3]).splice(1, 1)], ["flat", () => list.flat()], ["flatMap", () => list.flatMap(each => [each])]] «as [string, () => unknown][]») {
    let made«: unknown»;
    try {
      made = run();
    } catch (error) {
      console.log(how + " with " + name + " is not made: " + errorName(error));
      continue;
    }
    readAll(how + " with " + name, made);
  }
}
species = undefined;
readAll("of", L.of(1, 2));
readAll("from for Other", (Array.from «as any»).call(Other, [1]));
readAll("of for a function", (Array.of «as any»).call(Plain, 1));
readAll("honest", list);
""" % fields


FAMILY_DOORS = [
    door_base_returns_another_object,
    door_half_made_objects_leak,
    door_constructors_throw_halfway,
    door_initializers_leak_this,
    door_super_in_odd_places,
    door_new_targets,
    door_prototypes_given_by_hand,
    door_copies,
    door_has_instance,
    door_has_instance_defined_later,
    door_parents_replaced,
    door_prototype_objects_replaced,
    door_accessors_take_the_stores,
    door_heritage_is_an_expression,
]

programs = []
for door in FAMILY_DOORS:
    for style in ("stores", "initializers"):
        for readers in ("plain", "tested"):
            programs.append(("family", door, style, readers))
for builtin in BUILTINS:
    for style in ("stores", "initializers"):
        programs.append(("builtin", builtin, style, None))
for style in ("stores", "initializers"):
    programs.append(("species", None, style, None))

if len(sys.argv) > 1 and sys.argv[1] == "-1":
    print(len(programs))
    sys.exit(0)

kind, what, style, readers = programs[seed % len(programs)]
if kind == "family":
    classes, makes, honest, fresh = what(style)
    text = "// " + what.__name__[5:].replace("_", " ") + "; fields by " + style + "; readers " + readers + "\n" + PRELUDE + classes + READERS[readers] + READ_ALL + WARM % honest + makes + END % fresh
elif kind == "builtin":
    text = "// derived from " + what[0] + "; fields by " + style + "\n" + PRELUDE + door_derived_builtins(style, what)
else:
    text = "// species; fields by " + style + "\n" + PRELUDE + door_species(style)
print(text_for(language, text) + "\nexport {};")
