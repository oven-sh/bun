// RUN: lower
// OPTIONS: builtin-modules

// then, toJSON, Symbol.toPrimitive, Symbol.iterator, Symbol.toStringTag and Symbol.isConcatSpreadable as declared optional fields: names that await, JSON.stringify, conversions, spread and concat look up by themselves.
// With the slot empty the object is ordinary; the first store, by typed code, changes how the language treats it; `delete` changes it back. Then the names arrive on the prototype instead.
class Special {
  declare id: number;
  declare then?: (resolve: (value: string) => void) => void;
  declare toJSON?: () => unknown;
  declare [Symbol.toPrimitive]?: (hint: string) => string | number;
  declare [Symbol.iterator]?: () => Iterator<number>;
  declare [Symbol.toStringTag]?: string;
  declare [Symbol.isConcatSpreadable]?: boolean;
  declare length?: number;
  constructor(id: number) {
    this.id = id;
  }
}
function arm(special: Special) {
  special.then = resolve => resolve("resolved by then of " + special.id);
  special.toJSON = () => "json of " + special.id;
  special[Symbol.toPrimitive] = hint => (hint === "number" ? special.id * 100 : "primitive " + special.id);
  special[Symbol.iterator] = function* () {
    yield special.id;
    yield special.id + 1;
  };
  special[Symbol.toStringTag] = "Tagged";
}
function disarm(special: Special) {
  delete special.then;
  delete special.toJSON;
  delete special[Symbol.toPrimitive];
  delete special[Symbol.iterator];
  delete special[Symbol.toStringTag];
}
async function treat(special: Special) {
  const awaited: unknown = await (special as unknown);
  let spread: string;
  try {
    spread = [...(special as Iterable<number>)].join();
  } catch (error) {
    spread = (error as Error).constructor.name;
  }
  return [
    awaited === special ? "itself" : awaited,
    JSON.stringify(special),
    JSON.stringify({ inner: special }),
    `${special as unknown as string}`,
    +(special as unknown as number),
    spread,
    Object.prototype.toString.call(special),
    Reflect.ownKeys(special).length,
  ].join(" | ");
}

let length = 0;
for (let i = 0; i < 1000; i++) {
  const special = new Special(i & 7);
  if (i & 1) arm(special);
  length += (await treat(special)).length;
}
console.log("warm", length);

const special = new Special(1);
console.log("empty:", await treat(special));
arm(special);
console.log("armed:", await treat(special));
disarm(special);
console.log("disarmed:", await treat(special));
const list = new Special(2);
console.log("concat:", ([0] as unknown[]).concat(list).length);
list.length = 2;
(list as any)[0] = "a";
(list as any)[1] = "b";
list[Symbol.isConcatSpreadable] = true;
console.log("concat spreads it:", ([0] as unknown[]).concat(list).join());
delete list[Symbol.isConcatSpreadable];
console.log("concat again:", ([0] as unknown[]).concat(list).length);

const holder: any = Object.getPrototypeOf(special);
holder["then"] = function (this: Special, resolve: (value: string) => void) {
  resolve("inherited then for " + this.id);
};
holder["toJSON"] = function (this: Special) {
  return "inherited json for " + this.id;
};
holder[Symbol.toStringTag] = "Inherited";
console.log("on the prototype:", await treat(special), "||", await treat(new Special(3)));
delete holder.then;
delete holder.toJSON;
delete holder[Symbol.toStringTag];
console.log("gone again:", await treat(special));

// GENERATED: disarm treat
// CHECK-LABEL: function {{*}}name="disarm"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropDelete v0 key="then"
// CHECK-NEXT: v2 = PropDelete v0 key="toJSON"
// CHECK-NEXT: v3 = PropDelete v0 key=@@toPrimitive
// CHECK-NEXT: v4 = PropDelete v0 key=@@iterator
// CHECK-NEXT: v5 = PropDelete v0 key=@@toStringTag
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="treat"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Await v1, v1
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v5 = NewArray contents=number
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|Array<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: AppendSpread v5, v6
// CHECK-NEXT: v8 = PropGet v5 key="join"
// CHECK-NEXT: v9 = Call v8, v5 calleeKey="join" calleeName="join"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v10)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = PropGet v12 key="constructor"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|function site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v15 = PropGet v14 key="name"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b6(v17: undefined|null|string):
// CHECK-NEXT: v18 = StrictEq v2, v1
// CHECK-NEXT: Branch v18 -> taken b7(| 0, 1), notTaken b9(| 0, 1)
// CHECK-NEXT: b7(v19, v20):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v21 = String string="itself"
// CHECK-NEXT: Jump -> next b11(v21, v20)
// CHECK-NEXT: b9(v22, v23):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: Jump -> next b11(v22, v23)
// CHECK-NEXT: b11(v24, v25: undefined|null|[[L_1]]):
// CHECK-NEXT: v26 = Builtin builtin=JSON
// CHECK-NEXT: v27 = PropGet v26 key="stringify"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v29 = Call v28, v26, v25 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v31 = Builtin builtin=JSON
// CHECK-NEXT: v32 = PropGet v31 key="stringify"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v34 = Convert v25 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v35 = NewObject -, v34 layout=[[L_8]] fields=[0]
// CHECK-NEXT: v36 = FinishObject v35
// CHECK-NEXT: v37 = Call v33, v31, v36 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v39 = Convert v25 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v40 = ToString v39
// CHECK-NEXT: v41 = Convert v25 declared={type=number site=[[w_11]]} illTypedCause=FromLooseType
// CHECK-NEXT: v42 = ToNumber v41
// CHECK-NEXT: v43 = Builtin builtin=ObjectPrototypeToString
// CHECK-NEXT: v44 = PropGet v43 key="call"
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v46 = Call v45, v43, v25 calleeKey="call" calleeName="Object.prototype.toString.call"
// CHECK-NEXT: v47 = Convert v46 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v48 = Builtin builtin=Reflect
// CHECK-NEXT: v49 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v50 = Call v49, v48, v25 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v51 = Convert v50 declared={type=undefined|null|Array<undefined|null|string|symbol> site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v52 = PropGet v51 key="length"
// CHECK-NEXT: v53 = NewArray v24, v30, v38, v40, v42, v17, v47, v52 contents=anything
// CHECK-NEXT: v54 = PropGet v53 key="join"
// CHECK-NEXT: v55 = String string=" | "
// CHECK-NEXT: v56 = Call v54, v53, v55 calleeKey="join" calleeName="join"
// CHECK-NEXT: v57 = Convert v56 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v58 = Convert v57 declared={type=undefined|null|string|object site=[[w_15]]}
// CHECK-NEXT: Return v58
// CHECK-NEXT: }
