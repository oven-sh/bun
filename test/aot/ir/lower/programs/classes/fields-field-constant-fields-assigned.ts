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
// CHECK-LABEL: function {{*}}name="declareInFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: v1 = String string="inner"
// CHECK-NEXT: v2 = NewObject layout=[[L_5]]
// CHECK-NEXT: v3 = ResolveHeritage v0
// CHECK-NEXT: v4 = NewClosure v2 function=[[f_6]]
// CHECK-NEXT: v5 = NewClass v4, v0, v3 layout=[[L_7]]
// CHECK-NEXT: v6 = ToPropertyKey v1
// CHECK-NEXT: PutEnvironmentField v2, v6 layout=[[L_5]]
// CHECK-NEXT: v8 = FinishClass v5 layout=[[L_7]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Above"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="inherited"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
