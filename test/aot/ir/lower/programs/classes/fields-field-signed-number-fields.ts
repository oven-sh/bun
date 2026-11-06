// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// The compiler options say that fields are assigned. A class has a field under a number with a sign, in brackets, beside other fields. The class above it has a setter, a getter or a read-only property under one of the names.
class Base {}
Object.defineProperty(Base.prototype, "y", {
  set(value: number) {
    console.log("the setter got", value);
  },
});
class Derived extends Base {
  [-1] = 1;
  y = 2;
}
console.log(Object.keys(new Derived()).join("+"));

let log: string[] = [];

type Class = new () => object;

function above(kind: string, name: string | symbol): Class {
  class Above {}
  if (kind === "setter") {
    Object.defineProperty(Above.prototype, name, {
      set(value: unknown) {
        log.push("set " + String(name) + " to " + String(value));
      },
    });
  } else if (kind === "getter") {
    Object.defineProperty(Above.prototype, name, { get: () => "inherited" });
  } else if (kind === "read-only") {
    Object.defineProperty(Above.prototype, name, { value: "inherited", writable: false });
  }
  return Above;
}

function describe(Made: Class): string {
  log = [];
  let made: string;
  try {
    const object = new Made();
    const keys = Reflect.ownKeys(object).map(name => {
      const property = Object.getOwnPropertyDescriptor(object, name)!;
      const flags =
        (property.writable ? "w" : "-") + (property.enumerable ? "e" : "-") + (property.configurable ? "c" : "-");
      return String(name) + "=" + String(property.value) + " " + flags;
    });
    made = keys.join(", ");
  } catch (error) {
    made = (error as Error).name;
  }
  return "[" + log.join("; ") + "] {" + made + "}";
}

function tell(key: unknown, declare: (Above: Class) => Class): void {
  console.log(String(key), "nothing above", describe(declare(above("nothing", "y"))));
  for (const kind of ["setter", "getter", "read-only"]) {
    for (const name of [typeof key === "symbol" ? key : String(key), "y", "optional"]) {
      console.log(String(key), kind, "under", String(name), describe(declare(above(kind, name))));
    }
  }
}

tell(
  -1,
  Above =>
    class extends Above {
      before = 0;
      [-1] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  +1,
  Above =>
    class extends Above {
      before = 0;
      [+1] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -0,
  Above =>
    class extends Above {
      before = 0;
      [-0] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -1.5,
  Above =>
    class extends Above {
      before = 0;
      [-1.5] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  -1e21,
  Above =>
    class extends Above {
      before = 0;
      [-1e21] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  1,
  Above =>
    class extends Above {
      before = 0;
      [1] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  NaN,
  Above =>
    class extends Above {
      before = 0;
      [NaN] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  Infinity,
  Above =>
    class extends Above {
      before = 0;
      [Infinity] = 1;
      y = 2;
      optional?: number;
    },
);

class WithoutValues extends above("setter", "y") {
  [-1]?: number;
  [+2]!: number;
  declare [-3]: number;
  y = 2;
}
console.log("without values", describe(WithoutValues));

class BesideStatic extends above("setter", "y") {
  static [-1] = 1;
  y = 2;
  optional?: number;
}
console.log("static", Object.keys(BesideStatic).join("+"), describe(BesideStatic));

// FILE: tsconfig.json
{ "compilerOptions": { "useDefineForClassFields": false } }

// GENERATED: describe Base Derived get
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = Data data=[[d_5]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_4]]
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v8 = Construct v0 calleeName="Made"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|object site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = Builtin builtin=Reflect
// CHECK-NEXT: v11 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v12 = Call v11, v10, v9 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|string|symbol> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = PropGet v13 key="map"
// CHECK-NEXT: v15 = NewClosure v9 function=[[f_10]]
// CHECK-NEXT: v16 = Call v14, v13, v15 calleeKey="map" calleeName="map"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Array<undefined|null|string> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v18 = PropGet v17 key="join"
// CHECK-NEXT: v19 = String string=", "
// CHECK-NEXT: v20 = Call v18, v17, v19 calleeKey="join" calleeName="join"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v21)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v22 = CatchValue
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v24 = PropGet v23 key="name"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b6(v25)
// CHECK-NEXT: b6(v26: undefined|null|string):
// CHECK-NEXT: v27 = String string="["
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v29 = CheckInitialized v28 name="log"
// CHECK-NEXT: v30 = PropGet v29 key="join"
// CHECK-NEXT: v31 = String string="; "
// CHECK-NEXT: v32 = Call v30, v29, v31 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v34 = Add v27, v33
// CHECK-NEXT: v35 = String string="] {"
// CHECK-NEXT: v36 = Add v34, v35
// CHECK-NEXT: v37 = Add v36, v26
// CHECK-NEXT: v38 = String string="}"
// CHECK-NEXT: v39 = Add v37, v38
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_15]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_15]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_17]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_17]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_18]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_20]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="inherited"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
