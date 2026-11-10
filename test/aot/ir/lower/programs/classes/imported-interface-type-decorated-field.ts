// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// Prints `design:type` of a decorated field whose type is an interface of another file, imported without the word `type`, under `emitDecoratorMetadata`: `Object`, as in what TypeScript's compiler emits.
import { Shape } from "./shape";
(Reflect as any).metadata = (about: string, value: unknown) => (target: object, name: string) => {
  console.log(name, about, value === Object);
};
const mark: any = () => {};
class Holder {
  @mark held: Shape = { side: 2 };
}
console.log(new Holder().held.side);

// FILE: shape.ts
export interface Shape {
  side: number;
}

// FILE: tsconfig.json
{ "compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true, "strict": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "types": [] } }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Reflect
// CHECK-NEXT: v1 = NewClosure function=[[f_1]]
// CHECK-NEXT: PropSet v0, v1 key="metadata"
// CHECK-NEXT: v3 = NewClosure function=[[f_2]]
// CHECK-NEXT: v4 = NewClosure function=[[f_3]]
// CHECK-NEXT: v5 = NewClass v4 layout=[[L_4]]
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_5]]
// CHECK-NEXT: v7 = FinishClass v5 layout=[[L_4]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: v9 = Convert v7 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: v11 = TypeTest v10 testedType=undefined
// CHECK-NEXT: Branch v11 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v12):
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="Object" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Object) flags=[IsExpected]}
// CHECK-NEXT: v16 = String string="design:type"
// CHECK-NEXT: v17 = Builtin builtin=CompilerHelpersDefineMetadata [isNotReadFromHolder]
// CHECK-NEXT: v18 = Call v17, -, v16, v15
// CHECK-NEXT: v19 = NewArray v3, v18 contents=anything
// CHECK-NEXT: v20 = PropGet v7 key="prototype"
// CHECK-NEXT: v21 = String string="held"
// CHECK-NEXT: v22 = Builtin builtin=CompilerHelpersDecorateProperty [isNotReadFromHolder]
// CHECK-NEXT: v23 = Call v22, -, v19, v20, v21
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="console" [isFreeName]
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="log"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v29 = Construct v9 calleeName="Holder"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v31 = PropGet v30 key="held"
// CHECK-NEXT: v32 = PropGet v31 key="side"
// CHECK-NEXT: v33 = Call v28, v26, v32 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: Return v34
// CHECK-NEXT: b2(v35):
// CHECK-NEXT: v36 = NewRuntimeError runtimeError=UnresolvableReference name="Shape"
// CHECK-NEXT: Throw v36
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: v2 = NewClosure v0, v1 function=[[f_6]]
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mark"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: v4 = Data data=[[d_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v3, v5 key="held"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow flags=[IsChecked] length=2 captures=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined] variableName="about"}, {type=anything variableName="value"}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything, v2: undefined|null|object, v3: undefined|null|string):
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = StrictEq v1, v9
// CHECK-NEXT: v11 = Call v8, v6, v3, v0, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
