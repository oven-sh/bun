// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// A referenced project has other compiler options.
import * as core from "core";
import * as loose from "loose";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];

class Base {
  declare level: number;
}
Object.defineProperty(Base.prototype, "level", {
  set(value: number) {
    log.push("main: the setter of the base got " + value);
  },
  get() {
    return -1;
  },
});

class Heir extends Base {
  level = 5;
}

class Declared {
  first: number | undefined;
  second = 2;
  third: string | undefined;
}

attempt("fields without a value, in the project that assigns", () => [Object.keys(core.make()).join(), "first" in core.make(), JSON.stringify(core.make())]);
attempt("fields without a value, in the project that defines", () => [Object.keys(loose.make()).join(), "first" in loose.make(), JSON.stringify(loose.make())]);
attempt("fields without a value, here", () => [Object.keys(new Declared()).join(), "first" in new Declared()]);
attempt("a field over an accessor, in the project that assigns", () => {
  const heir = new core.Heir();
  return [heir.level, Object.keys(heir).join(), core.log.join("; ")];
});
attempt("a field over an accessor, in the project that defines", () => {
  const heir = new loose.Heir();
  return [heir.level, Object.keys(heir).join(), loose.log.join("; ")];
});
attempt("a field over an accessor, here", () => {
  const heir = new Heir();
  return [heir.level, Object.keys(heir).join(), log.join("; ")];
});
attempt("a subclass here of a class there", () => {
  class Local extends core.Declared {
    fourth: number | undefined;
    fifth = 5;
  }
  class Other extends loose.Declared {
    fourth: number | undefined;
    fifth = 5;
  }
  return [Object.keys(new Local()).join(), Object.keys(new Other()).join()];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += core.make().second + loose.make().second + new Declared().second + new core.Heir().level + new loose.Heir().level;
console.log("2000 rounds: " + warm);

// FILE: packages/core/src/index.ts
export const log: string[] = [];

export class Base {
  declare level: number;
}
Object.defineProperty(Base.prototype, "level", {
  set(value: number) {
    log.push("core: the setter of the base got " + value);
  },
  get() {
    return -1;
  },
});

export class Heir extends Base {
  level = 5;
}

export class Declared {
  first: number | undefined;
  second = 2;
  third: string | undefined;
}

export function make(): Declared {
  return new Declared();
}

// FILE: packages/loose/src/index.ts
export const log: string[] = [];

export class Base {
  declare level: number;
}
Object.defineProperty(Base.prototype, "level", {
  set(value: number) {
    log.push("loose: the setter of the base got " + value);
  },
  get() {
    return -1;
  },
});

export class Heir extends Base {
  level = 5;
}

export class Declared {
  first: number | undefined;
  second = 2;
  third: string | undefined;
}

export function make(): Declared {
  return new Declared();
}

// FILE: packages/core/tsconfig.json
{
  "compilerOptions": {
    "composite": true,
    "target": "esnext",
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "useDefineForClassFields": false,
    "outDir": "./built",
    "rootDir": "./src"
  },
  "include": ["src"]
}

// FILE: packages/loose/tsconfig.json
{
  "compilerOptions": {
    "composite": true,
    "target": "esnext",
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "useDefineForClassFields": true,
    "outDir": "./built",
    "rootDir": "./src"
  },
  "include": ["src"]
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "paths": { "core": [ "./packages/core/src/index.ts" ], "loose": [ "./packages/loose/src/index.ts" ] } }, "files": [], "references": [ { "path": "./packages/core" }, { "path": "./packages/loose" } ] }

// GENERATED: attempt Base set Heir
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=" threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_9]]}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="main: the setter of the base got "
// CHECK-NEXT: v5 = Add v4, v0
// CHECK-NEXT: v6 = Call v3, v2, v5 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_12]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_14]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_15]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
