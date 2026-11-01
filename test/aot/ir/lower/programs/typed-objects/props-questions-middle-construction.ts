// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.ts
// Own property questions in the middle of construction.
const names = ["a", "asked", "f", "h", "late", "none"];
const nameAt = (index: number): string => names[index % names.length];

function ask(object: object): string {
  const answers: unknown[] = [];
  for (let i = 0; i < names.length; ++i) {
    const name = nameAt(i);
    answers.push(
      name,
      Object.hasOwn(object, name),
      Object.prototype.hasOwnProperty.call(object, name),
      name in object,
      Reflect.has(object, name),
      Object.prototype.propertyIsEnumerable.call(object, name),
      Object.getOwnPropertyDescriptor(object, name) !== undefined,
    );
  }
  return answers.map(answer => (answer === true ? "+" : answer === false ? "-" : " " + answer + " ")).join("");
}

class Laid {
  a = 1;
  asked: string = [
    Object.hasOwn(this, "a"),
    Object.hasOwn(this, "asked"),
    Object.hasOwn(this, "f"),
    Object.hasOwn(this, "h"),
    Object.hasOwn(this, "late"),
    Object.hasOwn(this, "none"),
    this.hasOwnProperty("a"),
    this.hasOwnProperty("h"),
    Object.prototype.hasOwnProperty.call(this, "h"),
    "h" in this,
    Reflect.has(this, "h"),
    this.propertyIsEnumerable("h"),
    Object.getOwnPropertyDescriptor(this, "h") === undefined,
    Object.keys(this).join(),
    Object.getOwnPropertyNames(this).join(),
    Reflect.ownKeys(this).join(),
    Object.entries(this).length,
    JSON.stringify(this),
    Object.keys({ ...this }).join(),
  ].join(" ");
  byKey: string = ask(this);
  f = (): number => this.a;
  again: string = [Object.hasOwn(this, "f"), Object.hasOwn(this, "h"), Object.hasOwn(this, "again"), this.hasOwnProperty("h"), ask(this)].join(" ");
  h = 3;
  late?: number;
  behind: string = [Object.hasOwn(this, "h"), Object.hasOwn(this, "late"), Object.hasOwn(this, "behind"), ask(this)].join(" ");
}

class Heir extends Laid {
  own = 5;
  heirAsked: string = [Object.hasOwn(this, "h"), Object.hasOwn(this, "own"), Object.hasOwn(this, "heirAsked"), Object.hasOwn(this, "last"), this.hasOwnProperty("last"), ask(this)].join(" ");
  last = 6;
}

class Quiet {
  a = 1;
  h = 3;
  late?: number;
}

function whole(object: Laid | Quiet): string {
  return [Object.hasOwn(object, "a"), Object.hasOwn(object, "h"), Object.hasOwn(object, "late"), Object.hasOwn(object, "none"), object.hasOwnProperty("h"), object.hasOwnProperty("late")].join();
}

for (let round = 0; round < 3; ++round) {
  const laid = new Laid();
  console.log(laid.asked);
  console.log(laid.byKey);
  console.log(laid.again);
  console.log(laid.behind);
  console.log(whole(laid), ask(laid));
  const heir = new Heir();
  console.log(heir.asked === laid.asked, heir.again === laid.again, heir.heirAsked);
  console.log(whole(heir), Object.hasOwn(heir, "last"), Object.hasOwn(heir, "own"));
  const quiet = new Quiet();
  console.log(whole(quiet), ask(quiet));
  quiet.late = 1;
  laid.late = 2;
  console.log(whole(quiet), whole(laid));
  delete quiet.late;
  console.log(whole(quiet));
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: ask nameAt Heir
// CHECK-LABEL: function {{*}}name="ask"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_3]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Jump -> next b2(v4)
// CHECK-NEXT: b2(v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="names"
// CHECK-NEXT: v9 = PropGet v8 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v11 = Less v5, v10
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="nameAt"
// CHECK-NEXT: v15 = Call v14, -, v12 calleeName="nameAt"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = PropGet v2 key="push"
// CHECK-NEXT: v18 = Builtin builtin=Object
// CHECK-NEXT: v19 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v20 = Call v19, v18, v0, v16 calleeName="Object.hasOwn"
// CHECK-NEXT: v21 = Convert v20 declared={type=boolean site=[[w_10]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = Builtin builtin=ObjectPrototypeHasOwnProperty
// CHECK-NEXT: v23 = PropGet v22 key="call"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v25 = Call v24, v22, v0, v16 calleeKey="call" calleeName="Object.prototype.hasOwnProperty.call"
// CHECK-NEXT: v26 = Convert v25 declared={type=boolean site=[[w_11]]} illTypedCause=FromLooseType
// CHECK-NEXT: v27 = ElemHas v0, v16
// CHECK-NEXT: v28 = Builtin builtin=Reflect
// CHECK-NEXT: v29 = Builtin builtin=ReflectHas
// CHECK-NEXT: v30 = Call v29, v28, v0, v16 calleeName="Reflect.has"
// CHECK-NEXT: v31 = Convert v30 declared={type=boolean site=[[w_12]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v32 = Builtin builtin=ObjectPrototypePropertyIsEnumerable
// CHECK-NEXT: v33 = PropGet v32 key="call"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v35 = Call v34, v32, v0, v16 calleeKey="call" calleeName="Object.prototype.propertyIsEnumerable.call"
// CHECK-NEXT: v36 = Convert v35 declared={type=boolean site=[[w_13]]} illTypedCause=FromLooseType
// CHECK-NEXT: v37 = Builtin builtin=Object
// CHECK-NEXT: v38 = Builtin builtin=ObjectGetOwnPropertyDescriptor
// CHECK-NEXT: v39 = Call v38, v37, v0, v16 calleeName="Object.getOwnPropertyDescriptor"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|number|string|symbol|bigint|[[L_14]] flags=[IsExpected]}
// CHECK-NEXT: v41 = TypeTest v40 testedType=undefined
// CHECK-NEXT: v42 = LogicalNot v41
// CHECK-NEXT: v43 = Call v17, v2, v16, v21, v26, v27, v31, v36, v42 calleeKey="push" calleeName="answers.push"
// CHECK-NEXT: v44 = Convert v43 declared={type=number site=[[w_15]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v45 = Increment v12
// CHECK-NEXT: v46 = Convert v45 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Jump -> next b2(v46)
// CHECK-NEXT: b6(v47):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v48 = PropGet v2 key="map"
// CHECK-NEXT: v49 = NewClosure function=[[f_16]]
// CHECK-NEXT: v50 = Call v48, v2, v49 calleeKey="map" calleeName="answers.map"
// CHECK-NEXT: v51 = Convert v50 declared={type=undefined|null|Array<undefined|null|string> site=[[w_17]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v52 = PropGet v51 key="join"
// CHECK-NEXT: v53 = String string=""
// CHECK-NEXT: v54 = Call v52, v51, v53 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v54 casts=[{declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nameAt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number site=[[w_18]]}] results=[{type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_20]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="names"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="names"
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_21]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = Mod v0, v6
// CHECK-NEXT: v8 = ElemGet v2, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_22]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_23]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_24]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_24]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_25]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
