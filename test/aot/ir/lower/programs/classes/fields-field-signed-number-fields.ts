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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = Data data=[[d_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_2]]
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v8 = Construct v0 calleeName="Made"
// CHECK-NEXT: v9 = Builtin builtin=Reflect
// CHECK-NEXT: v10 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v11 = Call v10, v9, v8 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = PropGet v12 key="map"
// CHECK-NEXT: v14 = NewClosure v8 function=[[f_4]]
// CHECK-NEXT: v15 = Call v13, v12, v14 calleeKey="map" calleeName="map"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v17 = PropGet v16 key="join"
// CHECK-NEXT: v18 = String string=", "
// CHECK-NEXT: v19 = Call v17, v16, v18 calleeKey="join" calleeName="keys.join"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3(v20)
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v21 = CatchValue
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v23 = PropGet v22 key="name"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b3(v24)
// CHECK-NEXT: b3(v25: undefined|null|string):
// CHECK-NEXT: v26 = String string="["
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="log"
// CHECK-NEXT: v29 = PropGet v28 key="join"
// CHECK-NEXT: v30 = String string="; "
// CHECK-NEXT: v31 = Call v29, v28, v30 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v33 = Add v26, v32
// CHECK-NEXT: v34 = String string="] {"
// CHECK-NEXT: v35 = Add v33, v34
// CHECK-NEXT: v36 = Add v35, v25
// CHECK-NEXT: v37 = String string="}"
// CHECK-NEXT: v38 = Add v36, v37
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]]}
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: PropSet v5, v6 key="-1"
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: PropSet v5, v8 key="y"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="inherited"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
