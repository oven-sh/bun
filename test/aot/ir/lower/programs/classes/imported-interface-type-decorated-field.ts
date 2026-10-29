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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Reflect
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: PropSet v1, v2 key="metadata"
// CHECK-NEXT: v4 = NewClosure function=[[f_3]]
// CHECK-NEXT: v5 = NewClosure function=[[f_4]]
// CHECK-NEXT: v6 = NewClass v5 layout=[[L_5]]
// CHECK-NEXT: PutModuleVariable v6 variable=[[g_6]]
// CHECK-NEXT: v8 = FinishClass v6 layout=[[L_5]]
// CHECK-NEXT: v9 = Convert v8 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v10 = Convert v8 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=undefined
// CHECK-NEXT: Branch v12 -> taken b2(| 0), notTaken b5(| 0)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="Object" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Object) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b4(v17):
// CHECK-NEXT: v18 = String string="design:type"
// CHECK-NEXT: v19 = Builtin builtin=CompilerHelpersDefineMetadata [isNotReadFromHolder]
// CHECK-NEXT: v20 = Call v19, -, v18, v17
// CHECK-NEXT: v21 = NewArray v4, v20 contents=anything
// CHECK-NEXT: v22 = PropGet v8 key="prototype"
// CHECK-NEXT: v23 = String string="held"
// CHECK-NEXT: v24 = Builtin builtin=CompilerHelpersDecorateProperty [isNotReadFromHolder]
// CHECK-NEXT: v25 = Call v24, -, v21, v22, v23
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="console" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="log"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v31 = Construct v10 calleeName="Holder"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|[[L_5]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v33 = PropGet v32 key="held"
// CHECK-NEXT: v34 = PropGet v33 key="side"
// CHECK-NEXT: v35 = Call v30, v28, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: b5(v37):
// CHECK-NEXT: v38 = NewRuntimeError runtimeError=UnresolvableReference name="Shape"
// CHECK-NEXT: Throw v38
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=undefined|null|[[f_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewClosure v0, v1 function=[[f_11]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mark"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_12]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 captures=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}] thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything, v2: undefined|null|object, v3: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
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
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} kind=Initializer flags=[HasThis, IsChecked, IsHiddenInStackTraces] thisType={type=[[L_5]] flags=[IsFromCompiler]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v2 = Data data=[[d_15]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_16]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v1, v3 key="held"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
