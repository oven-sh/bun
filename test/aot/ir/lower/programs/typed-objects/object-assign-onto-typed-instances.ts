// RUN: lower
// OPTIONS: builtin-modules

// Object.assign onto an instance of a typed class: its declared fields and names the class does not declare, from typed literals and from data that came from outside. Every store is a [[Set]]: a setter on the prototype chain runs, a frozen target throws, key order is the order of creation, and the chain may change between two calls.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  lines.push(label + ": " + text);
}
const own = (object: object) => Reflect.ownKeys(object).map(String).join();
const outside = (text: string): any => JSON.parse(text);

class Holder {
  a = 0;
  b = 0.5;
  c = "c";
  d = false;
  e: string | undefined = undefined;
  f: number | null = null;
  get doubled() {
    return this.a * 2;
  }
  method() {
    return "method of " + this.c;
  }
}
class Derived extends Holder {
  g = 7;
}
class WithSetter {
  first = 1;
  seen = "";
  set watched(value: number) {
    this.seen += "<" + value + ":" + own(this) + ">";
  }
}
class WithObjects {
  list: number[] = [];
  inner: { x: number } = { x: 0 };
  call: () => string = () => "original";
  any: unknown = 0;
}
class Changing {
  first = 1;
}
class Optional {
  always = 1;
  sometimes?: number;
  later?: string;
}

const typedSources = [
  { a: 1, b: 2, c: "x", d: true },
  { a: 5, b: 6.25, c: "y", d: false },
];
const otherSources = [
  { p: 1, q: "two", r: [3], s: null },
  { p: 5, q: "six", r: [7], s: null },
];

for (let turn = 0; turn < 5; turn++) {
  say("declared fields from a typed literal " + turn, () => {
    const h = new Holder();
    const result = Object.assign(h, typedSources[turn & 1]);
    return [result === h, own(h), h.a, h.b, h.c, h.d, h.e, h.f, h.doubled, h.method()];
  });
  say("declared fields from outside " + turn, () => {
    const h = new Holder();
    Object.assign(h, outside(`{"d":true,"c":"from outside ${turn}","b":${turn}.5,"a":${turn}}`));
    return [own(h), h.a, h.b, h.c, h.d, h.doubled];
  });
  say("on a derived class " + turn, () => {
    const h = new Derived();
    Object.assign(h, typedSources[turn & 1], { g: turn });
    return [own(h), h.a, h.g, h.doubled];
  });
  say("other names from a typed literal " + turn, () => {
    const h = Object.assign(new Holder(), otherSources[turn & 1]);
    return [own(h), h.p, h.q, h.r, h.s, h.a, JSON.stringify(h)];
  });
  say("other names from outside " + turn, () => {
    const h: any = Object.assign(new Holder(), outside(`{"z":${turn},"y":"y","x":{"deep":[${turn}]}}`));
    return [own(h), h.z, h.y, h.x, h.a];
  });
  say("both kinds, interleaved " + turn, () => {
    const h: any = Object.assign(new Holder(), outside(`{"z":1,"a":${turn},"y":2,"c":"both","x":3}`));
    return [own(h), h.z, h.a, h.y, h.c, h.x];
  });
  say("twice: the second replaces and adds " + turn, () => {
    const h: any = new Holder();
    Object.assign(h, otherSources[0]);
    Object.assign(h, otherSources[1], outside(`{"q":"again","t":${turn},"a":9}`));
    return [own(h), h.p, h.q, h.r, h.t, h.a];
  });
  say("many other names " + turn, () => {
    const source: Record<string, number> = {};
    for (let i = 0; i < 14; i++) source["n" + i] = i * (turn + 1);
    const h: any = Object.assign(new Holder(), source);
    Object.assign(h, { n3: -3, more: turn });
    return [own(h), h.n0, h.n3, h.n7, h.n13, h.more];
  });
}

say("numbers that do not fit 31 bits", () => {
  const h = new Holder();
  const seen: unknown[] = [];
  for (const a of [1073741823, 1073741824, -1073741824, -1073741825, 2147483648, 1e21, 0.1, -0, NaN, Infinity, 3]) {
    Object.assign(h, { a });
    seen.push(Object.is(h.a, -0) ? "-0" : String(h.a));
    Object.assign(h, outside(`{"b":${Number.isFinite(a) ? a : 0}}`));
    seen.push(String(h.b));
  }
  return seen;
});
say("undefined and null where the type allows them", () => {
  const h = new Holder();
  Object.assign(h, { e: "set", f: 4 });
  const before = [h.e, h.f];
  Object.assign(h, { e: undefined, f: null });
  return [before, h.e === undefined, h.f, own(h)];
});
say("objects into fields", () => {
  const w = new WithObjects();
  const list = [1, 2];
  const inner = { x: 5 };
  const call = () => "replaced";
  Object.assign(w, { list, inner, call, any: { free: true } });
  return [w.list === list, w.inner.x, w.call(), w.any, own(w)];
});
say("objects into fields, from outside", () => {
  const w = new WithObjects();
  Object.assign(w, outside(`{"list":[4,5],"inner":{"x":6},"any":[1]}`));
  return [w.list, w.inner.x, w.call(), w.any, own(w)];
});
say("from one instance to another", () => {
  const from = new WithObjects();
  from.list = [9];
  from.inner = { x: 9 };
  from.any = "any";
  const to = new WithObjects();
  Object.assign(to, from);
  return [to.list === from.list, to.inner === from.inner, to.call === from.call, to.any];
});
say("optional fields: absent in the source, absent in the target", () => {
  const seen: unknown[] = [];
  const sources: Partial<Optional>[] = [{}, { sometimes: 1 }, { later: "l", sometimes: 2 }, { always: 3 }];
  for (const source of sources) {
    const o = new Optional();
    Object.assign(o, source);
    seen.push([own(o), o.always, o.sometimes, o.later]);
    Object.assign(o, source, { later: "last" });
    seen.push([own(o), o.later]);
  }
  return seen;
});
say("a setter of the class runs in its turn", () => {
  const seen: unknown[] = [];
  for (let turn = 0; turn < 3; turn++) {
    const w: any = new WithSetter();
    Object.assign(w, outside(`{"before":1,"first":${turn},"watched":${turn},"after":2}`));
    seen.push([own(w), w.first, w.seen]);
  }
  return seen;
});
say("a getter of the source runs in its turn and may change the source", () => {
  const h: any = new Holder();
  const source: any = { a: 1, get c() { delete this.z; this.d = true; return "got"; }, z: 1, d: false };
  Object.assign(h, source);
  return [own(h), h.a, h.c, h.d, "z" in h];
});
say("what is not enumerable, and symbols", () => {
  const tag = Symbol("tag");
  const source: any = { a: 3, [tag]: "tagged", k: 1 };
  Object.defineProperty(source, "hidden", { value: 1, enumerable: false });
  Object.defineProperty(source, "c", { value: "hidden too", enumerable: false });
  const h: any = Object.assign(new Holder(), source);
  return [own(h), h.a, h.c, h[tag], h.k, h.hidden];
});
say("index keys, Symbol.isConcatSpreadable", () => {
  const h: any = Object.assign(new Holder(), outside(`{"1":"one","x":1,"0":"zero"}`));
  const spread: any = Object.assign(new Holder(), { [Symbol.isConcatSpreadable]: true, length: 1, 0: "spread" });
  return [own(h), h[0], h[1], h.x, [0].concat(spread)];
});
say("__proto__ as an own key of the source", () => {
  const h: any = Object.assign(new Changing(), outside(`{"x":1,"__proto__":{"stolen":true}}`));
  return [own(h), h.x, h.stolen, h instanceof Changing];
});
say("a getter without a setter throws, and what came before stays", () => {
  const h: any = new Holder();
  let thrown = "";
  try {
    Object.assign(h, outside(`{"a":4,"early":1,"doubled":1,"late":1,"c":"never"}`));
  } catch (error) {
    thrown = (error as Error).constructor.name;
  }
  return [thrown, own(h), h.a, h.c];
});
const closings: [string, <T>(object: T) => T][] = [["frozen", object => Object.freeze(object)], ["sealed", object => Object.seal(object)], ["not extensible", object => Object.preventExtensions(object)]];
for (const [name, close] of closings) {
  say(name + ": declared fields", () => {
    const h = close(new Holder());
    Object.assign(h, typedSources[0]);
    return [own(h), h.a];
  });
  say(name + ": other names", () => {
    const h: any = close(new Holder());
    let thrown = "";
    try {
      Object.assign(h, outside(`{"a":2,"other":1}`));
    } catch (error) {
      thrown = (error as Error).constructor.name;
    }
    return [thrown, own(h), h.a];
  });
}
say("an own accessor and a read-only property among the other names", () => {
  const h: any = new Holder();
  let log = "";
  Object.defineProperty(h, "viaSetter", { set(value) { log += value; }, get() { return "got"; }, enumerable: true, configurable: true });
  Object.defineProperty(h, "fixed", { value: "fixed", writable: false, enumerable: true, configurable: true });
  Object.assign(h, { viaSetter: "set", plain: 1 });
  let thrown = "";
  try {
    Object.assign(h, { plain: 2, fixed: "changed", never: 1 });
  } catch (error) {
    thrown = (error as Error).constructor.name;
  }
  return [log, thrown, own(h), h.plain, h.fixed];
});
say("the source is the target; sources that are no objects", () => {
  const h: any = Object.assign(new Holder(), { k: 1 });
  Object.assign(h, h, null, undefined, 5, true, "st");
  return [own(h), h[0], h[1], h.k];
});
say("deleted and assigned again: the order of keys", () => {
  const h: any = Object.assign(new Holder(), { x: 1, y: 2, z: 3 });
  delete h.y;
  Object.assign(h, { z: 4, y: 5 });
  const o: any = new Optional();
  Object.assign(o, { extra: 1, sometimes: 2, more: 3, later: "l" });
  return [own(h), h.y, h.z, own(o)];
});

say("the prototype chain changes between two calls", () => {
  const seen: unknown[] = [];
  const source = { first: 2, tracked: 3, free: 4 };
  const run = () => {
    const c: any = new Changing();
    Object.assign(c, source);
    return [own(c), c.first, c.tracked, c.free];
  };
  seen.push(run(), run());
  let log = "";
  Object.defineProperty(Changing.prototype, "tracked", { set(value) { log += "tracked=" + value + ";"; }, get() { return "from the prototype"; }, configurable: true });
  seen.push(run(), run(), log);
  delete (Changing.prototype as any).tracked;
  seen.push(run());
  return seen;
});
say("many objects, so that collections fall between the calls", () => {
  let sum = 0;
  const kept: any[] = [];
  for (let i = 0; i < 20000; i++) {
    const h: any = Object.assign(new Holder(), typedSources[i & 1], otherSources[i & 1], { text: "t" + i, i });
    sum += h.a + h.p + h.i + h.text.length + h.r[0];
    if (i % 1000 === 0) kept.push(h);
  }
  return [sum, kept.map(h => h.text + h.q + h.c).join()];
});

console.log(lines.join("\n"));

// GENERATED: Holder doubled own outside Derived c run
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="doubled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_2]] site=[[w_4]]} results=[{type=number site=[[w_5]]}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="a"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="own"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string|symbol> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="map"
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = Call v5, v4, v6 calleeKey="map" calleeName="map"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|string> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = PropGet v8 key="join"
// CHECK-NEXT: v10 = Call v9, v8 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="outside"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_13]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_14]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=undefined|null|number|string|symbol|bigint|[[L_15]] flags=[IsExpected]} results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_15]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropDelete v0 key="z"
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: PropSet v0, v2 key="d"
// CHECK-NEXT: v4 = String string="got"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|[[L_17]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=undefined|null|Array site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_20]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_17]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_21]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Changing"
// CHECK-NEXT: v3 = Construct v2 calleeName="Changing"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_22]] site=[[w_23]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v7 = Call v6, v5, v4, v0 calleeName="Object.assign"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_24]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="own"
// CHECK-NEXT: v10 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="own"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Convert v10 declared={type=undefined|null|number|string|symbol|bigint|[[L_26]] flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="first"
// CHECK-NEXT: v15 = Convert v13 declared={type=undefined|null|number|string|symbol|bigint|[[L_27]] flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="tracked"
// CHECK-NEXT: v17 = Convert v15 declared={type=undefined|null|number|string|symbol|bigint|[[L_28]] flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="free"
// CHECK-NEXT: v19 = NewArray v12, v14, v16, v18 contents=anything
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Array site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
