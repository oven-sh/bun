// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// The same with experimentalDecorators, for a class of this file and for exported classes of a file that is imported for its effects only.
import { registry, register } from "./registry";
import "./handlers";

@register("local")
class Local {
  run(): string {
    return "local ran";
  }
}

for (const [name, entry] of registry) console.log(name, new entry().run());

// FILE: handlers.ts
import { register } from "./registry";

function shout(text: string): string {
  return text.toUpperCase();
}

@register("first")
export class First {
  run(): string {
    return shout("first ran");
  }
}

@register("second")
class Second {
  run(): string {
    return shout("second ran");
  }
}

// FILE: registry.ts
export const registry = new Map<string, new () => { run(): string }>();

export function register(name: string) {
  return (value: new () => { run(): string }): void => {
    registry.set(name, value);
  };
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "experimentalDecorators": true } }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = NewClass v0 layout=[[L_2]]
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_3]]
// CHECK-NEXT: v3 = NewClosure function=[[f_4]]
// CHECK-NEXT: DefineMethod v1, v3 layout=[[L_2]] key="run"
// CHECK-NEXT: v5 = FinishClass v1 layout=[[L_2]]
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="register"
// CHECK-NEXT: v8 = String string="local"
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="register"
// CHECK-NEXT: v10 = NewArray v9 contents=anything
// CHECK-NEXT: v11 = Builtin builtin=CompilerHelpersDecorateClass [isNotReadFromHolder]
// CHECK-NEXT: v12 = Call v11, -, v10, v5
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="registry"
// CHECK-NEXT: v15 = IteratorOpen v14
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v17 = IteratorResume v15
// CHECK-NEXT: v18 = ResultAt v17
// CHECK-NEXT: v19 = ResultAt v17 index=1
// CHECK-NEXT: Branch v18 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v21 = IteratorOpen v19 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v22 = IteratorResume v21 stepIndex=0
// CHECK-NEXT: v23 = ResultAt v22
// CHECK-NEXT: v24 = ResultAt v22 index=1
// CHECK-NEXT: v25 = IteratorResume v21 stepIndex=1
// CHECK-NEXT: v26 = ResultAt v25
// CHECK-NEXT: v27 = ResultAt v25 index=1
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b8():
// CHECK-NEXT: IteratorClose v21
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="console" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="log"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v34 = Construct v27 calleeName="entry"
// CHECK-NEXT: v35 = PropGet v34 key="run"
// CHECK-NEXT: v36 = Call v35, v34 calleeKey="run" calleeName="run"
// CHECK-NEXT: v37 = Call v33, v31, v24, v36 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b7() role=IterationCleanup subject=v21 handler=b8():
// CHECK-NEXT: v38 = CatchException
// CHECK-NEXT: IteratorClose v21 completion=Throw
// CHECK-NEXT: Rethrow v38
// CHECK-NEXT: b8() role=IterationCleanup subject=v15:
// CHECK-NEXT: v40 = CatchException
// CHECK-NEXT: IteratorClose v15 completion=Throw
// CHECK-NEXT: Rethrow v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Local"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="local ran"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
