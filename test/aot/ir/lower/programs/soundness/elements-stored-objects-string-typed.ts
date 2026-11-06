// RUN: lower
// OPTIONS: builtin-modules

// elements-stored-into-objects-below-string-objects-typed-arrays-and-proxies.js with types. The output is that of plain Bun.
const above: Record<string, () => object> = {
  "a String object": () => new String("abc"),
  "a typed array": () => new Uint8Array([7, 8, 9]),
  "an empty typed array": () => new Uint8Array(0),
  "an array": () => [7, 8, 9],
  "a frozen array": () => Object.freeze([7, 8, 9]),
  "an array with a getter and a setter": () =>
    Object.defineProperty([7], 1, {
      get() {
        return "got";
      },
      set(this: any, value: unknown) {
        this.seen = value;
      },
    }),
  "an array with a getter alone": () =>
    Object.defineProperty([7], 1, {
      get() {
        return "got";
      },
    }),
  "an object with an element that cannot be written": () =>
    Object.defineProperty({}, 1, { value: "fixed", writable: false }),
  "an arguments object": () =>
    (function (...given: number[]) {
      return arguments;
    })(7, 8, 9),
  "a proxy that refuses": () =>
    new Proxy(
      {},
      {
        set() {
          return false;
        },
      },
    ),
  "a proxy that stores under another name": () =>
    new Proxy(
      {},
      {
        set(target: object, key: string | symbol, value: unknown, receiver: object) {
          return Reflect.defineProperty(receiver, "other", {
            value,
            configurable: true,
            enumerable: true,
            writable: true,
          });
        },
      },
    ),
  "a frozen literal": () => Object.freeze({ 1: "f" }),
  "a literal with an element that cannot be written": () => {
    const literal = { b: 2 };
    Object.defineProperty(literal, 1, { value: "fixed", writable: false });
    return literal;
  },
  "a literal below a String object": () => Object.setPrototypeOf({ b: 2 }, new String("abc")),
  "a created object below a String object": () => Object.create(new String("abc")),
  "a String object below a proxy that refuses": () =>
    Object.setPrototypeOf(
      new String("abc"),
      new Proxy(
        {},
        {
          set() {
            return false;
          },
        },
      ),
    ),
  "a typed array below an object with an element that cannot be written": () =>
    Object.setPrototypeOf(new Uint8Array(1), Object.defineProperty({}, 5, { value: "fixed", writable: false })),
  "a String object below an object with an element that cannot be written": () =>
    Object.setPrototypeOf(new String("a"), Object.defineProperty({}, 5, { value: "fixed", writable: false })),
};

class Instance {
  a = 1;
}
function Made(this: any) {
  this.a = 1;
}
const below: Record<string, (proto: object) => any> = {
  "a literal": proto => Object.setPrototypeOf({ a: 1 }, proto),
  "a literal that names its prototype": proto => ({ __proto__: proto, a: 1 }),
  "an instance of a class": proto => Object.setPrototypeOf(new Instance(), proto),
  "an instance of a function": proto => Object.setPrototypeOf(new (Made as any)(), proto),
  "a created object": proto => Object.create(proto),
  "a literal that takes no more": proto => Object.preventExtensions(Object.setPrototypeOf({ a: 1 }, proto)),
  "a literal with the element": proto => Object.setPrototypeOf({ a: 1, 1: "own", 5: "own" }, proto),
  "a literal with the element, which cannot be written": proto =>
    Object.defineProperty(Object.defineProperty(Object.setPrototypeOf({ a: 1 }, proto), 1, { value: "own" }), 5, {
      value: "own",
    }),
};

const lines: string[] = [];
function say(label: string, run: () => unknown) {
  try {
    lines.push(label + ": " + JSON.stringify(run()));
  } catch (error) {
    lines.push(label + ": threw " + (error as Error).name);
  }
}
const seenOf = (object: any, proto: object, key: string | number) => [
  object[key],
  Object.hasOwn(object, key),
  Object.hasOwn(proto, key),
  object.seen,
  object.other,
];

for (const [upper, makeAbove] of Object.entries(above)) {
  for (const [lower, makeBelow] of Object.entries(below)) {
    for (const key of [1, 5, "1", JSON.parse("5") as number]) {
      const label = lower + " below " + upper + ", " + typeof key + " " + key;
      say(label, () => {
        const proto = makeAbove();
        const object = makeBelow(proto);
        object[key] = "z";
        return seenOf(object, proto, key);
      });
      say(label + ", by Reflect.set", () => {
        const proto = makeAbove();
        const object = makeBelow(proto);
        return [Reflect.set(object, key, "z"), ...seenOf(object, proto, key)];
      });
    }
    say(lower + " below " + upper + ", for another receiver", () => {
      const proto = makeAbove();
      const object = makeBelow(proto);
      const receiver: any = { r: 1 };
      return [Reflect.set(object, 1, "z", receiver), receiver[1], object[1], Object.hasOwn(object, 1)];
    });
  }
}
console.log(lines.join("\n"));

// GENERATED: Made Instance seenOf set
// CHECK-LABEL: function {{*}}name="Made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: PropSet v1, v2 key="a"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Instance"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="seenOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=3 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|object site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|object, v2: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v4 = ElemGet v3, v2
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v7 = Call v6, v5, v3, v2 calleeName="Object.hasOwn"
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_8]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v11 = Call v10, v9, v1, v2 calleeName="Object.hasOwn"
// CHECK-NEXT: v12 = Convert v11 declared={type=boolean site=[[w_9]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Convert v3 declared={type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="seen"
// CHECK-NEXT: v15 = Convert v13 declared={type=undefined|null|number|string|symbol|bigint|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="other"
// CHECK-NEXT: v17 = NewArray v4, v8, v12, v14, v16 contents=anything
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Array site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v1 key="seen"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=false site=[[w_13]]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean
// CHECK-NEXT: v1 = Convert v0 declared={type=false site=[[w_13]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string|symbol site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}, {type=undefined|null|object site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_18]]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|string|symbol, v2: anything, v3: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Builtin builtin=Reflect
// CHECK-NEXT: v5 = Builtin builtin=ReflectDefineProperty
// CHECK-NEXT: v6 = String string="other"
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|boolean}
// CHECK-NEXT: v9 = Boolean boolean=true
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|boolean}
// CHECK-NEXT: v11 = Boolean boolean=true
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|boolean}
// CHECK-NEXT: v13 = NewObject -, v2, v8, v10, v12 layout=[[L_20]] fields=[4, 0, 1, 5]
// CHECK-NEXT: v14 = FinishObject v13
// CHECK-NEXT: v15 = Call v5, v4, v3, v6, v14 calleeName="Reflect.defineProperty"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=boolean site=[[w_21]]}}, {declared={type=boolean site=[[w_18]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=false site=[[w_22]]}] functionTypes={{*}}[[f_23]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean
// CHECK-NEXT: v1 = Convert v0 declared={type=false site=[[w_22]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
