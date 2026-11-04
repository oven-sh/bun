// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesDemoted = 2

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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=" threw "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="Error" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v14, v24
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = PropGet v14 key="constructor"
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = TypeOf v14
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: v33 = Add v21, v32
// CHECK-NEXT: v34 = Call v19, v17, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="main: the setter of the base got "
// CHECK-NEXT: v5 = Add v4, v0
// CHECK-NEXT: v6 = Call v3, v2, v5 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v7 = Convert v6 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = Undefined
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
