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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b9(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectIs
// CHECK-NEXT: v5 = Convert v2 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v6 = Double number=-0
// CHECK-NEXT: v7 = Call v4, v3, v5, v6 calleeName="Object.is"
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_2]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b4(| 0), notTaken b7(| 0)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v11 = String string="-0"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b7(v13):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v14 = Builtin builtin=String
// CHECK-NEXT: v15 = Call v14, -, v5 calleeName="String"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b9(v16):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v17 = TypeTest v16 testedType=string
// CHECK-NEXT: Branch v17 -> taken b11(| 0), notTaken b13(| 0)
// CHECK-NEXT: b11(v18):
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: v19 = Builtin builtin=JSON
// CHECK-NEXT: v20 = PropGet v19 key="stringify"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v22 = Convert v18 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v23 = Call v21, v19, v22 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v23 casts=[{declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b13(v24):
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: v25 = TypeTest v24 testedType=bigint
// CHECK-NEXT: Branch v25 -> taken b15(| 0), notTaken b17(| 0)
// CHECK-NEXT: b15(v26):
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b16():
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|bigint} illTypedCause=Assertion
// CHECK-NEXT: v28 = String string="n"
// CHECK-NEXT: v29 = Add v27, v28
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v30
// CHECK-NEXT: b17(v31):
// CHECK-NEXT: Jump -> next b18()
// CHECK-NEXT: b18():
// CHECK-NEXT: v32 = TypeTest v31 testedType=null
// CHECK-NEXT: Branch v32 -> taken b19(| 0), notTaken b20(| 0)
// CHECK-NEXT: b19(v33):
// CHECK-NEXT: Jump -> next b23(v33)
// CHECK-NEXT: b20(v34):
// CHECK-NEXT: Jump -> next b21()
// CHECK-NEXT: b21():
// CHECK-NEXT: v35 = TypeTest v34 testedType=undefined
// CHECK-NEXT: Branch v35 -> taken b22(| 0), notTaken b24(| 0)
// CHECK-NEXT: b22(v36):
// CHECK-NEXT: Jump -> next b23(v36)
// CHECK-NEXT: b23(v37):
// CHECK-NEXT: v38 = Builtin builtin=String
// CHECK-NEXT: v39 = Call v38, -, v37 calleeName="String"
// CHECK-NEXT: ReturnCall v39 casts=[{declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b24(v40):
// CHECK-NEXT: Jump -> next b25()
// CHECK-NEXT: b25():
// CHECK-NEXT: v41 = TypeTest v40 testedType=boolean
// CHECK-NEXT: Branch v41 -> taken b26(| 0), notTaken b28(| 0)
// CHECK-NEXT: b26(v42):
// CHECK-NEXT: Jump -> next b27()
// CHECK-NEXT: b27():
// CHECK-NEXT: v43 = Builtin builtin=String
// CHECK-NEXT: v44 = Convert v42 declared={type=boolean} illTypedCause=Assertion
// CHECK-NEXT: v45 = Call v43, -, v44 calleeName="String"
// CHECK-NEXT: ReturnCall v45 casts=[{declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b28(v46):
// CHECK-NEXT: Jump -> next b29()
// CHECK-NEXT: b29():
// CHECK-NEXT: v47 = Builtin builtin=Array
// CHECK-NEXT: v48 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v49 = Call v48, v47, v46 calleeName="Array.isArray"
// CHECK-NEXT: v50 = Convert v49 declared={type=boolean site=[[w_7]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v51 = ToBoolean v50
// CHECK-NEXT: Branch v51 -> taken b30(| 0), notTaken b43(| 0)
// CHECK-NEXT: b30(v52):
// CHECK-NEXT: Jump -> next b31()
// CHECK-NEXT: b31():
// CHECK-NEXT: v53 = Data data=[[d_8]]
// CHECK-NEXT: v54 = Convert v53 declared={type=undefined|null|Array<undefined|null|string> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v55 = Integer
// CHECK-NEXT: v56 = Convert v55 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Jump -> next b32(v56)
// CHECK-NEXT: b32(v57: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v59 = Convert v57 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v60 = Convert v46 declared={type=undefined|null|Array} illTypedCause=Assertion
// CHECK-NEXT: v61 = PropGet v60 key="length"
// CHECK-NEXT: v62 = Convert v61 declared={type=number site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v63 = Less v59, v62
// CHECK-NEXT: Branch v63 -> taken b33(| 0), notTaken b41(| 0)
// CHECK-NEXT: b33(v64):
// CHECK-NEXT: Jump -> next b34()
// CHECK-NEXT: b34():
// CHECK-NEXT: v65 = PropGet v54 key="push"
// CHECK-NEXT: v66 = Convert v64 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v67 = ElemHas v60, v66
// CHECK-NEXT: v68 = ToBoolean v67
// CHECK-NEXT: Branch v68 -> taken b35(| 0), notTaken b37(| 0)
// CHECK-NEXT: b35(v69):
// CHECK-NEXT: Jump -> next b36()
// CHECK-NEXT: b36():
// CHECK-NEXT: v70 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v71 = ElemGet v60, v66
// CHECK-NEXT: v72 = Call v70, -, v71 calleeName="show"
// CHECK-NEXT: v73 = Convert v72 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b39(v73)
// CHECK-NEXT: b37(v74):
// CHECK-NEXT: Jump -> next b38()
// CHECK-NEXT: b38():
// CHECK-NEXT: v75 = String string="hole"
// CHECK-NEXT: Jump -> next b39(v75)
// CHECK-NEXT: b39(v76):
// CHECK-NEXT: v77 = Call v65, v54, v76 calleeKey="push" calleeName="parts.push"
// CHECK-NEXT: v78 = Convert v77 declared={type=number site=[[w_14]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b40()
// CHECK-NEXT: b40():
// CHECK-NEXT: v79 = Increment v66
// CHECK-NEXT: v80 = Convert v79 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Jump -> next b32(v80)
// CHECK-NEXT: b41(v81):
// CHECK-NEXT: Jump -> next b42()
// CHECK-NEXT: b42():
// CHECK-NEXT: v82 = String string="["
// CHECK-NEXT: v83 = PropGet v54 key="join"
// CHECK-NEXT: v84 = String string=", "
// CHECK-NEXT: v85 = Call v83, v54, v84 calleeKey="join" calleeName="parts.join"
// CHECK-NEXT: v86 = Convert v85 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v87 = Add v82, v86
// CHECK-NEXT: v88 = String string="]"
// CHECK-NEXT: v89 = Add v87, v88
// CHECK-NEXT: v90 = Convert v89 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v90
// CHECK-NEXT: b43(v91):
// CHECK-NEXT: Jump -> next b44()
// CHECK-NEXT: b44():
// CHECK-NEXT: v92 = TypeOf v46
// CHECK-NEXT: v93 = Convert v92 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v93
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_16]]}] results=[{type=number site=[[w_17]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_17]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_18]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_20]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_18]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_20]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_22]] site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_22]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_24]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_25]]}
// CHECK-NEXT: PropSet v3, v5 key="length"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="->"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v14 = Call v1 calleeName="run"
// CHECK-NEXT: v15 = Call v13, -, v14 calleeName="show"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_26]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_24]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="log"
// CHECK-NEXT: v19 = PropGet v18 key="join"
// CHECK-NEXT: v20 = String string=" "
// CHECK-NEXT: v21 = Call v19, v18, v20 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_27]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = Call v11, v9, v0, v12, v16, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v24 = CatchValue
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = String string="threw"
// CHECK-NEXT: v31 = Builtin builtin=GlobalThis
// CHECK-NEXT: v32 = PropGet v31 key="Error" [isFreeName]
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v34 = InstanceOf v24, v33 writtenExpression="error instanceof Error"
// CHECK-NEXT: v35 = ToBoolean v34
// CHECK-NEXT: Branch v35 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v36):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v37 = Convert v24 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v37 key="constructor"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|function site=[[w_28]]} illTypedCause=Assertion
// CHECK-NEXT: v40 = PropGet v39 key="name"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|string site=[[w_28]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v41)
// CHECK-NEXT: b7(v42):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v43 = TypeOf v24
// CHECK-NEXT: Jump -> next b9(v43)
// CHECK-NEXT: b9(v44):
// CHECK-NEXT: v45 = GetModuleVariable variable=[[g_24]]
// CHECK-NEXT: v46 = CheckInitialized v45 name="log"
// CHECK-NEXT: v47 = PropGet v46 key="join"
// CHECK-NEXT: v48 = String string=" "
// CHECK-NEXT: v49 = Call v47, v46, v48 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|string site=[[w_29]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v51 = Call v29, v27, v0, v30, v44, v50 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v52 = Undefined
// CHECK-NEXT: Return v52
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_30]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_30]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_30]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_31]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
