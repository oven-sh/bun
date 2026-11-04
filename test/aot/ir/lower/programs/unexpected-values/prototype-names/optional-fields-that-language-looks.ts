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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropDelete v0 key="then"
// CHECK-NEXT: v2 = PropDelete v0 key="toJSON"
// CHECK-NEXT: v3 = PropDelete v0 key=@@toPrimitive
// CHECK-NEXT: v4 = PropDelete v0 key=@@iterator
// CHECK-NEXT: v5 = PropDelete v0 key=@@toStringTag
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="treat"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: v2 = Await v1, v1
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v5 = NewArray contents=anything
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|Array<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: AppendSpread v5, v6
// CHECK-NEXT: v8 = PropGet v5 key="join"
// CHECK-NEXT: v9 = Call v8, v5 calleeKey="join" calleeName="join"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3(v10)
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = PropGet v12 key="constructor"
// CHECK-NEXT: v14 = PropGet v13 key="name"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b3(v16: undefined|null|string):
// CHECK-NEXT: v17 = StrictEq v2, v1
// CHECK-NEXT: Branch v17 -> taken b4(), notTaken b5(v2)
// CHECK-NEXT: b4():
// CHECK-NEXT: v18 = String string="itself"
// CHECK-NEXT: Jump -> next b5(v18)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: v20 = Builtin builtin=JSON
// CHECK-NEXT: v21 = PropGet v20 key="stringify"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v23 = Call v22, v20, v1 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v25 = Builtin builtin=JSON
// CHECK-NEXT: v26 = PropGet v25 key="stringify"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v28 = NewObject -, v1 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v29 = FinishObject v28
// CHECK-NEXT: v30 = Call v27, v25, v29 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v32 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v33 = ToString v32
// CHECK-NEXT: v34 = Convert v1 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v35 = ToNumber v34
// CHECK-NEXT: v36 = Builtin builtin=ObjectPrototypeToString
// CHECK-NEXT: v37 = PropGet v36 key="call"
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v39 = Call v38, v36, v1 calleeKey="call" calleeName="Object.prototype.toString.call"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v41 = Builtin builtin=Reflect
// CHECK-NEXT: v42 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v43 = Call v42, v41, v1 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v45 = PropGet v44 key="length"
// CHECK-NEXT: v46 = NewArray v19, v24, v31, v33, v35, v16, v40, v45 contents=anything
// CHECK-NEXT: v47 = PropGet v46 key="join"
// CHECK-NEXT: v48 = String string=" | "
// CHECK-NEXT: v49 = Call v47, v46, v48 calleeKey="join" calleeName="join"
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v50
// CHECK-NEXT: }
