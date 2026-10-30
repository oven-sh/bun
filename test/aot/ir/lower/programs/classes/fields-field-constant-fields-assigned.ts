// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// The compiler options say that fields are assigned. A class has a field under a constant, in brackets, beside other fields: a constant that is declared first in its file or function, one that is declared later, a variable, a member of an enum, a symbol. The class above it has a setter, a getter or a read-only property under one of the names.
const text = "text",
  count = 7,
  negative = -7,
  quoted = `quoted`;
enum Numbers {
  one = 21,
  negative = -22,
}
enum Texts {
  one = "enum text",
}
const enum InlinedTexts {
  one = "inlined text",
}
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

const late = "late";
let variable = "variable";
const mark = Symbol("mark");
const holder = { name: "held" } as const;

tell(
  text,
  Above =>
    class extends Above {
      before = 0;
      [text] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  count,
  Above =>
    class extends Above {
      before = 0;
      [count] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  negative,
  Above =>
    class extends Above {
      before = 0;
      [negative] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  quoted,
  Above =>
    class extends Above {
      before = 0;
      [quoted] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  late,
  Above =>
    class extends Above {
      before = 0;
      [late] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  variable,
  Above =>
    class extends Above {
      before = 0;
      [variable] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  Numbers.one,
  Above =>
    class extends Above {
      before = 0;
      [Numbers.one] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  Numbers.negative,
  Above =>
    class extends Above {
      before = 0;
      [Numbers.negative] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  Texts.one,
  Above =>
    class extends Above {
      before = 0;
      [Texts.one] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  InlinedTexts.one,
  Above =>
    class extends Above {
      before = 0;
      [InlinedTexts.one] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  mark,
  Above =>
    class extends Above {
      before = 0;
      [mark] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  holder.name,
  Above =>
    class extends Above {
      before = 0;
      [holder.name] = 1;
      y = 2;
      optional?: number;
    },
);
tell(
  Symbol.toStringTag,
  Above =>
    class extends Above {
      before = 0;
      [Symbol.toStringTag] = 1;
      y = 2;
      optional?: number;
    },
);

function declareInFunction(Above: Class): Class {
  const inner = "inner";
  return class extends Above {
    before = 0;
    [inner] = 1;
    y = 2;
    optional?: number;
  };
}
tell("inner", declareInFunction);

function declareBehindStatement(Above: Class): Class {
  log.push("called");
  const inner = "behind";
  return class extends Above {
    before = 0;
    [inner] = 1;
    y = 2;
    optional?: number;
  };
}
tell("behind", declareBehindStatement);
variable = "changed";

// FILE: tsconfig.json
{ "compilerOptions": { "useDefineForClassFields": false } }

// GENERATED: describe declareInFunction Above get
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
// CHECK-LABEL: function {{*}}name="declareInFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_1]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="inner"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|"inner" site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = NewObject layout=[[L_18]]
// CHECK-NEXT: v4 = ResolveHeritage v0
// CHECK-NEXT: v5 = NewClosure v3 function=[[f_19]]
// CHECK-NEXT: v6 = NewClass v5, v0, v4 layout=[[L_20]]
// CHECK-NEXT: v7 = ToPropertyKey v2
// CHECK-NEXT: PutEnvironmentField v3, v7 layout=[[L_18]]
// CHECK-NEXT: v9 = FinishClass v6 layout=[[L_20]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_1]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Above"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_22]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_22]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_22]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_24]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="inherited"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
