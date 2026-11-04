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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v4)
// CHECK-NEXT: b1(v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="names"
// CHECK-NEXT: v9 = PropGet v8 key="length"
// CHECK-NEXT: v10 = Less v5, v9
// CHECK-NEXT: Branch v10 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="nameAt"
// CHECK-NEXT: v13 = Call v12, -, v5 calleeName="nameAt"
// CHECK-NEXT: v14 = PropGet v2 key="push"
// CHECK-NEXT: v15 = Builtin builtin=Object
// CHECK-NEXT: v16 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v17 = Call v16, v15, v0, v13 calleeName="Object.hasOwn"
// CHECK-NEXT: v18 = Convert v17 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v19 = Builtin builtin=ObjectPrototypeHasOwnProperty
// CHECK-NEXT: v20 = PropGet v19 key="call"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v22 = Call v21, v19, v0, v13 calleeKey="call" calleeName="Object.prototype.hasOwnProperty.call"
// CHECK-NEXT: v23 = Convert v22 declared={type=boolean} illTypedCause=FromLooseType
// CHECK-NEXT: v24 = ElemHas v0, v13
// CHECK-NEXT: v25 = Builtin builtin=Reflect
// CHECK-NEXT: v26 = Builtin builtin=ReflectHas
// CHECK-NEXT: v27 = Call v26, v25, v0, v13 calleeName="Reflect.has"
// CHECK-NEXT: v28 = Convert v27 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v29 = Builtin builtin=ObjectPrototypePropertyIsEnumerable
// CHECK-NEXT: v30 = PropGet v29 key="call"
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v32 = Call v31, v29, v0, v13 calleeKey="call" calleeName="Object.prototype.propertyIsEnumerable.call"
// CHECK-NEXT: v33 = Convert v32 declared={type=boolean} illTypedCause=FromLooseType
// CHECK-NEXT: v34 = Builtin builtin=Object
// CHECK-NEXT: v35 = Builtin builtin=ObjectGetOwnPropertyDescriptor
// CHECK-NEXT: v36 = Call v35, v34, v0, v13 calleeName="Object.getOwnPropertyDescriptor"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v38 = TypeTest v37 testedType=undefined
// CHECK-NEXT: v39 = LogicalNot v38
// CHECK-NEXT: v40 = Call v14, v2, v13, v18, v23, v24, v28, v33, v39 calleeKey="push" calleeName="answers.push"
// CHECK-NEXT: v41 = Convert v40 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v42 = Increment v5
// CHECK-NEXT: v43 = Convert v42 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v43)
// CHECK-NEXT: b3():
// CHECK-NEXT: v44 = PropGet v2 key="map"
// CHECK-NEXT: v45 = NewClosure function=[[f_5]]
// CHECK-NEXT: v46 = Call v44, v2, v45 calleeKey="map" calleeName="answers.map"
// CHECK-NEXT: v47 = Convert v46 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v48 = PropGet v47 key="join"
// CHECK-NEXT: v49 = String string=""
// CHECK-NEXT: v50 = Call v48, v47, v49 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v50 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nameAt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="names"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="names"
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = Mod v0, v5
// CHECK-NEXT: v7 = ElemGet v2, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_8]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
