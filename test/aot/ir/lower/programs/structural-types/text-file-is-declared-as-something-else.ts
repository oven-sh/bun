// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesData = 2

// FILE: main.ts
import answer from "./answer.number" with { type: "text" };
import point from "./place.point" with { type: "text" };

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function sum(p: { x: number; y: number }): number {
  return p.x + p.y;
}

attempt("honest", () => [plusOne(1), sum({ x: 1, y: 2 })]);
attempt("a number that is a text", () => [answer, typeof answer, plusOne(answer), answer * 2, answer === 42]);
attempt("a number that is a text: a method", () => answer.toFixed(1));
attempt("a point that is a text", () => [typeof point, sum(point), point.x, Object.keys(point).length]);
attempt("in a typed local, a field and an element", () => {
  const n: number = answer;
  class Holder {
    n = answer;
  }
  const list: number[] = [answer, 1];
  return [n + 1, new Holder().n + 1, list];
});
attempt("honest again", () => [plusOne(1), sum({ x: 1, y: 2 })]);

// FILE: answer.number
42
// FILE: declarations.d.ts
declare module "*.number" {
  const value: number;
  export default value;
}

declare module "*.point" {
  const value: { x: number; y: number };
  export default value;
}

// FILE: place.point
x=1
y=2
// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [], "include": [ "*.ts" ] }

// GENERATED: show plusOne sum attempt Holder
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b4(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectIs
// CHECK-NEXT: v6 = Double number=-0
// CHECK-NEXT: v7 = Call v5, v4, v3, v6 calleeName="Object.is"
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = String string="-0"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: v14 = Builtin builtin=String
// CHECK-NEXT: v15 = Call v14, -, v3 calleeName="String"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: v17 = NarrowByTest v0, v16
// CHECK-NEXT: v18 = TypeTest v17 testedType=string
// CHECK-NEXT: Branch v18 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: v20 = NarrowByTest v0, v19
// CHECK-NEXT: v21 = Builtin builtin=JSON
// CHECK-NEXT: v22 = PropGet v21 key="stringify"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v24 = Call v23, v21, v20 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v24 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: v26 = NarrowByTest v0, v25
// CHECK-NEXT: v27 = TypeTest v26 testedType=bigint
// CHECK-NEXT: Branch v27 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v28):
// CHECK-NEXT: v29 = NarrowByTest v0, v28
// CHECK-NEXT: v30 = String string="n"
// CHECK-NEXT: v31 = Add v29, v30
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v32
// CHECK-NEXT: b8(v33):
// CHECK-NEXT: v34 = NarrowByTest v0, v33
// CHECK-NEXT: v35 = TypeTest v34 testedType=null
// CHECK-NEXT: Branch v35 -> taken b10(), notTaken b9(| 0)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = NarrowByTest v0, v36
// CHECK-NEXT: v38 = TypeTest v37 testedType=undefined
// CHECK-NEXT: Branch v38 -> taken b10(), notTaken b11(| 0)
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Builtin builtin=String
// CHECK-NEXT: v40 = Call v39, -, v34 calleeName="String"
// CHECK-NEXT: ReturnCall v40 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b11(v41):
// CHECK-NEXT: v42 = NarrowByTest v0, v41
// CHECK-NEXT: v43 = TypeTest v42 testedType=boolean
// CHECK-NEXT: Branch v43 -> taken b12(| 0), notTaken b13(| 0)
// CHECK-NEXT: b12(v44):
// CHECK-NEXT: v45 = NarrowByTest v0, v44
// CHECK-NEXT: v46 = Builtin builtin=String
// CHECK-NEXT: v47 = Call v46, -, v45 calleeName="String"
// CHECK-NEXT: ReturnCall v47 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b13(v48):
// CHECK-NEXT: v49 = NarrowByTest v0, v48
// CHECK-NEXT: v50 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v51 = TypeTest v49 testedType=Array
// CHECK-NEXT: Branch v51 -> taken b14(| 0), notTaken b15(| 0)
// CHECK-NEXT: b14(v52):
// CHECK-NEXT: Jump -> next b16(v52)
// CHECK-NEXT: b15(v53):
// CHECK-NEXT: v54 = NarrowByTest v0, v53
// CHECK-NEXT: v55 = Builtin builtin=Array
// CHECK-NEXT: v56 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v57 = Call v56, v55, v54 calleeName="Array.isArray"
// CHECK-NEXT: v58 = Convert v57 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v59 = ToBoolean v58
// CHECK-NEXT: Branch v59 -> taken b16(v53), notTaken b23(| 0)
// CHECK-NEXT: b16(v60):
// CHECK-NEXT: v61 = NarrowByTest v0, v60
// CHECK-NEXT: v62 = Data data=[[d_1]]
// CHECK-NEXT: v63 = Convert v62 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v64 = Integer
// CHECK-NEXT: v65 = Convert v64 declared={type=number}
// CHECK-NEXT: Jump -> next b17(v65)
// CHECK-NEXT: b17(v66: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v68 = PropGet v61 key="length"
// CHECK-NEXT: v69 = Less v66, v68
// CHECK-NEXT: Branch v69 -> taken b18(), notTaken b22()
// CHECK-NEXT: b18():
// CHECK-NEXT: v70 = PropGet v63 key="push"
// CHECK-NEXT: v71 = ElemHas v61, v66
// CHECK-NEXT: v72 = ToBoolean v71
// CHECK-NEXT: Branch v72 -> taken b19(| 0), notTaken b20(| 0)
// CHECK-NEXT: b19(v73):
// CHECK-NEXT: v74 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v75 = ElemGet v61, v66
// CHECK-NEXT: v76 = Call v74, -, v75 calleeName="show"
// CHECK-NEXT: Jump -> next b21(v76)
// CHECK-NEXT: b20(v77):
// CHECK-NEXT: v78 = String string="hole"
// CHECK-NEXT: Jump -> next b21(v78)
// CHECK-NEXT: b21(v79):
// CHECK-NEXT: v80 = Call v70, v63, v79 calleeKey="push" calleeName="parts.push"
// CHECK-NEXT: v81 = Convert v80 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v82 = Increment v66
// CHECK-NEXT: v83 = Convert v82 declared={type=number}
// CHECK-NEXT: Jump -> next b17(v83)
// CHECK-NEXT: b22():
// CHECK-NEXT: v84 = String string="["
// CHECK-NEXT: v85 = PropGet v63 key="join"
// CHECK-NEXT: v86 = String string=", "
// CHECK-NEXT: v87 = Call v85, v63, v86 calleeKey="join" calleeName="parts.join"
// CHECK-NEXT: v88 = Convert v87 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v89 = Add v84, v88
// CHECK-NEXT: v90 = String string="]"
// CHECK-NEXT: v91 = Add v89, v90
// CHECK-NEXT: v92 = Convert v91 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v92
// CHECK-NEXT: b23(v93):
// CHECK-NEXT: v94 = TypeOf v54
// CHECK-NEXT: v95 = Convert v94 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v95
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]]):
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_4]]):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: PropSet v3, v4 key="length"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = String string="->"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v13 = Call v1 calleeName="run"
// CHECK-NEXT: v14 = Call v12, -, v13 calleeName="show"
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="log"
// CHECK-NEXT: v17 = PropGet v16 key="join"
// CHECK-NEXT: v18 = String string=" "
// CHECK-NEXT: v19 = Call v17, v16, v18 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v21 = Call v10, v8, v0, v11, v14, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v22 = CatchValue
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="console" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="log"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v28 = String string="threw"
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="Error" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v32 = InstanceOf v22, v31
// CHECK-NEXT: v33 = ToBoolean v32
// CHECK-NEXT: Branch v33 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v34):
// CHECK-NEXT: v35 = PropGet v22 key="constructor"
// CHECK-NEXT: v36 = PropGet v35 key="name"
// CHECK-NEXT: Jump -> next b5(v36)
// CHECK-NEXT: b4(v37):
// CHECK-NEXT: v38 = TypeOf v22
// CHECK-NEXT: Jump -> next b5(v38)
// CHECK-NEXT: b5(v39):
// CHECK-NEXT: v40 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v41 = CheckInitialized v40 name="log"
// CHECK-NEXT: v42 = PropGet v41 key="join"
// CHECK-NEXT: v43 = String string=" "
// CHECK-NEXT: v44 = Call v42, v41, v43 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v46 = Call v27, v25, v0, v28, v39, v45 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v47 = Undefined
// CHECK-NEXT: Return v47
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_7]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
