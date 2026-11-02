// RUN: lower
// OPTIONS: builtin-modules

// Stores of `undefined` or `null` into a property whose declared type excludes both, made through a wider type of the same object.
// Everything here type-checks, and each store must behave as it does in plain JavaScript.
// Each case declares its own types, told apart by a marker property, so that one case cannot change how another's objects are stored.
function report(label: string, run: () => string): void {
  try {
    console.log(label + ":", run());
  } catch (e) {
    console.log(label + ":", "throws", (e as Error).name);
  }
}

report("index signature, computed key", () => {
  type Leaf = { n: number; case1: true };
  type Holder = { leaf: Leaf; name: string; case1: true };
  const h: Holder = { leaf: { n: 1, case1: true }, name: "holder", case1: true };
  const dictionary: { [key: string]: unknown } = h;
  for (const key of Object.keys(dictionary)) if (key === "leaf") dictionary[key] = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("generic key of the type", () => {
  type Leaf = { n: number; case2: true };
  type Holder = { leaf: Leaf; name: string; case2: true };
  function setByKey<K extends keyof Holder>(target: Holder, key: K, value: Holder[K]): void {
    target[key] = value;
  }
  const noLeaves: Leaf[] = [];
  const h: Holder = { leaf: { n: 2, case2: true }, name: "holder", case2: true };
  setByKey(h, "leaf", noLeaves[3]);
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("nested object through a wider outer type", () => {
  type Leaf = { n: number; case3: true };
  type Holder = { leaf: Leaf; name: string; case3: true };
  type Outer = { inner: Holder };
  type WideOuter = { inner: { leaf?: Leaf } };
  const h: Holder = { leaf: { n: 3, case3: true }, name: "holder", case3: true };
  const outer: Outer = { inner: h };
  const wide: WideOuter = outer;
  wide.inner.leaf = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("callback whose parameter is any", () => {
  type Leaf = { n: number; case4: true };
  type Holder = { leaf: Leaf; name: string; case4: true };
  const clear: (target: Holder) => void = (target: any) => {
    target.leaf = undefined;
  };
  const h: Holder = { leaf: { n: 4, case4: true }, name: "holder", case4: true };
  clear(h);
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("callback whose parameter is any, computed key", () => {
  type Leaf = { n: number; case5: true };
  type Holder = { leaf: Leaf; name: string; case5: true };
  const clear: (target: Holder, key: string) => void = (target: any, key: string) => {
    target[key] = null;
  };
  const h: Holder = { leaf: { n: 5, case5: true }, name: "holder", case5: true };
  clear(h, "leaf");
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("Reflect.set through object", () => {
  type Leaf = { n: number; case6: true };
  type Holder = { leaf: Leaf; name: string; case6: true };
  function clearLeaf(target: object): void {
    for (const key of Object.keys(target)) if (key === "leaf") Reflect.set(target, key, undefined);
  }
  const h: Holder = { leaf: { n: 6, case6: true }, name: "holder", case6: true };
  clearLeaf(h);
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("Object.assign from a partial", () => {
  type Leaf = { n: number; case7: true };
  type Holder = { leaf: Leaf; name: string; case7: true };
  const h: Holder = { leaf: { n: 7, case7: true }, name: "holder", case7: true };
  const patch: Partial<Holder> = { leaf: undefined };
  Object.assign(h, patch);
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("element of a wider array", () => {
  type Leaf = { n: number; case8: true };
  type Holder = { leaf: Leaf; name: string; case8: true };
  const h: Holder = { leaf: { n: 8, case8: true }, name: "holder", case8: true };
  const holders: Holder[] = [h];
  const wide: { leaf?: Leaf }[] = holders;
  wide[0].leaf = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("value of a wider map", () => {
  type Leaf = { n: number; case9: true };
  type Holder = { leaf: Leaf; name: string; case9: true };
  const h: Holder = { leaf: { n: 9, case9: true }, name: "holder", case9: true };
  const holders = new Map<string, Holder>([["a", h]]);
  const wide: Map<string, { leaf?: Leaf }> = holders;
  wide.get("a")!.leaf = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("result of a function seen through a wider type", () => {
  type Leaf = { n: number; case10: true };
  type Holder = { leaf: Leaf; name: string; case10: true };
  const h: Holder = { leaf: { n: 10, case10: true }, name: "holder", case10: true };
  const get: () => Holder = () => h;
  const wideGet: () => { leaf?: Leaf } = get;
  wideGet().leaf = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("property of a class instance through a wider interface", () => {
  type Leaf = { n: number; case11: true };
  type Holder = { leaf: Leaf; name: string; case11: true };
  class Box {
    constructor(public held: Holder) {}
  }
  interface WideBox {
    held: { leaf?: Leaf };
  }
  const h: Holder = { leaf: { n: 11, case11: true }, name: "holder", case11: true };
  const wide: WideBox = new Box(h);
  wide.held.leaf = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("promise of a wider type", () => {
  type Leaf = { n: number; case12: true };
  type Holder = { leaf: Leaf; name: string; case12: true };
  const h: Holder = { leaf: { n: 12, case12: true }, name: "holder", case12: true };
  const wide: Promise<{ leaf?: Leaf }> = Promise.resolve(h);
  wide.then(value => {
    value.leaf = undefined;
    console.log("promise of a wider type, later:", h.leaf === undefined ? "undefined" : "kept");
  });
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

// GENERATED: setByKey clear clearLeaf Box
// CHECK-LABEL: function {{*}}name="setByKey"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_3]] site=[[w_4]]}, {type=undefined|null|true|string|[[L_5]] site=[[w_6]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|[[L_3]], v2: undefined|null|true|string|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="clear"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: PropSet v1, v2 key="leaf"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="clear"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v3 = Null
// CHECK-NEXT: ElemSet v2, v1, v3
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="clearLeaf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = IteratorOpen v4
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v5
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: v11 = Convert v9 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v12 = String string="leaf"
// CHECK-NEXT: v13 = StrictEq v11, v12
// CHECK-NEXT: Branch v13 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v14) handler=b10():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b10():
// CHECK-NEXT: v15 = Builtin builtin=Reflect
// CHECK-NEXT: v16 = Builtin builtin=ReflectSet
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: v18 = Call v16, v15, v0, v14, v17 calleeName="Reflect.set"
// CHECK-NEXT: v19 = Convert v18 declared={type=boolean site=[[w_14]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b8(v20) handler=b10():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b10():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b10() role=IterationCleanup subject=v5:
// CHECK-NEXT: v21 = CatchException
// CHECK-NEXT: IteratorClose v5 completion=Throw
// CHECK-NEXT: Rethrow v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_15]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_15]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_17]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_17]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_17]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_18]]
// CHECK-NEXT: PropSet v4, v1 key="held"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
