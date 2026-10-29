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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
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
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = NewArray v10 contents=anything
// CHECK-NEXT: v12 = Builtin builtin=CompilerHelpersDecorateClass [isNotReadFromHolder]
// CHECK-NEXT: v13 = Call v12, -, v11, v5
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="registry"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Map<undefined|null|string, undefined|null|[[f_9]]>} illTypedCause=Assertion
// CHECK-NEXT: v17 = IteratorOpen v16
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v19 = IteratorResume v17
// CHECK-NEXT: v20 = ResultAt v19
// CHECK-NEXT: v21 = ResultAt v19 index=1
// CHECK-NEXT: Branch v20 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b12():
// CHECK-NEXT: v23 = Convert v21 declared={type=undefined|null|Array<undefined|null|string|[[f_9]]> site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v24 = IteratorOpen v23 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b11():
// CHECK-NEXT: v25 = IteratorResume v24 stepIndex=0
// CHECK-NEXT: v26 = ResultAt v25
// CHECK-NEXT: v27 = ResultAt v25 index=1
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: v29 = IteratorResume v24 stepIndex=1
// CHECK-NEXT: v30 = ResultAt v29
// CHECK-NEXT: v31 = ResultAt v29 index=1
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|[[f_9]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b11():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b12():
// CHECK-NEXT: IteratorClose v24
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b12():
// CHECK-NEXT: v34 = Builtin builtin=GlobalThis
// CHECK-NEXT: v35 = PropGet v34 key="console" [isFreeName]
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v36 key="log"
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v39 = Construct v32 calleeName="entry"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|[[L_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v41 = PropGet v40 key="run"
// CHECK-NEXT: v42 = Call v41, v40 calleeKey="run" calleeName="run"
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v44 = Call v38, v36, v28, v43 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b11() role=IterationCleanup subject=v24 handler=b12():
// CHECK-NEXT: v45 = CatchException
// CHECK-NEXT: IteratorClose v24 completion=Throw
// CHECK-NEXT: Rethrow v45
// CHECK-NEXT: b12() role=IterationCleanup subject=v17:
// CHECK-NEXT: v47 = CatchException
// CHECK-NEXT: IteratorClose v17 completion=Throw
// CHECK-NEXT: Rethrow v47
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Local"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="local ran"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
