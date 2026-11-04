// RUN: lower
// OPTIONS: builtin-modules

// A host constructor that answers with a string comes out of a list a bound function and a proxy.
const ffi = require("bun:ffi");
const bytes = Buffer.from("Hi\0");
const found = Object.values(ffi).filter(value => typeof value === "function" && value.name === "CString");
const Bound = ffi.CString.bind(null);
const Wrapped = new Proxy(ffi.CString, {});
for (const Class of [found[0], Bound, Wrapped]) {
  const text = new Class(ffi.ptr(bytes));
  console.log(typeof text, text === "Hi", typeof text === "string" ? "a string" : "no string");
}
console.log(typeof Reflect.construct(ffi.CString, [ffi.ptr(bytes)]), typeof ffi.CString(ffi.ptr(bytes)));

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="bun:ffi"
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="Buffer" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="from"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(BufferFrom) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="Hi\u{0}"
// CHECK-NEXT: v10 = Call v8, v6, v9 calleeKey="from" calleeName="Buffer.from"
// CHECK-NEXT: v11 = Builtin builtin=Object
// CHECK-NEXT: v12 = Builtin builtin=ObjectValues
// CHECK-NEXT: v13 = Call v12, v11, v3 calleeName="Object.values"
// CHECK-NEXT: v14 = PropGet v13 key="filter"
// CHECK-NEXT: v15 = NewClosure function=[[f_4]]
// CHECK-NEXT: v16 = Call v14, v13, v15 calleeKey="filter" calleeName="filter"
// CHECK-NEXT: v17 = PropGet v3 key="CString"
// CHECK-NEXT: v18 = PropGet v17 key="bind"
// CHECK-NEXT: v19 = Null
// CHECK-NEXT: v20 = Call v18, v17, v19 calleeKey="bind" calleeName="ffi.CString.bind"
// CHECK-NEXT: v21 = Builtin builtin=Proxy
// CHECK-NEXT: v22 = PropGet v3 key="CString"
// CHECK-NEXT: v23 = Data data=[[d_5]]
// CHECK-NEXT: v24 = Construct v21, -, v22, v23 calleeName="Proxy"
// CHECK-NEXT: v25 = Integer
// CHECK-NEXT: v26 = ElemGet v16, v25
// CHECK-NEXT: v27 = NewArray v26, v20, v24 contents=anything
// CHECK-NEXT: v28 = IteratorOpen v27
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v30 = IteratorResume v28
// CHECK-NEXT: v31 = ResultAt v30
// CHECK-NEXT: v32 = ResultAt v30 index=1
// CHECK-NEXT: Branch v31 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v33 = Builtin builtin=GlobalThis
// CHECK-NEXT: v34 = PropGet v33 key="console" [isFreeName]
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="log"
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v38 = Builtin builtin=Reflect
// CHECK-NEXT: v39 = Builtin builtin=ReflectConstruct
// CHECK-NEXT: v40 = PropGet v3 key="CString"
// CHECK-NEXT: v41 = PropGet v3 key="ptr"
// CHECK-NEXT: v42 = Convert v41 declared={type=builtin(BunFfiPtr) flags=[IsExpected]}
// CHECK-NEXT: v43 = Call v42, v3, v10 calleeKey="ptr" calleeName="ffi.ptr"
// CHECK-NEXT: v44 = NewArray v43 contents=undefined|null|number|bigint
// CHECK-NEXT: v45 = Call v39, v38, v40, v44 calleeName="Reflect.construct"
// CHECK-NEXT: v46 = TypeOf v45
// CHECK-NEXT: v47 = PropGet v3 key="CString"
// CHECK-NEXT: v48 = Convert v47 declared={type=builtin(BunFfiCString) flags=[IsExpected]}
// CHECK-NEXT: v49 = PropGet v3 key="ptr"
// CHECK-NEXT: v50 = Convert v49 declared={type=builtin(BunFfiPtr) flags=[IsExpected]}
// CHECK-NEXT: v51 = Call v50, v3, v10 calleeKey="ptr" calleeName="ffi.ptr"
// CHECK-NEXT: v52 = Call v48, v3, v51 calleeKey="CString" calleeName="ffi.CString"
// CHECK-NEXT: v53 = TypeOf v52
// CHECK-NEXT: v54 = Call v37, v35, v46, v53 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v55 = Undefined
// CHECK-NEXT: Return v55
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v56 = PropGet v3 key="ptr"
// CHECK-NEXT: v57 = Convert v56 declared={type=builtin(BunFfiPtr) flags=[IsExpected]}
// CHECK-NEXT: v58 = Call v57, v3, v10 calleeKey="ptr" calleeName="ffi.ptr"
// CHECK-NEXT: v59 = Construct v32, -, v58 calleeName="Class"
// CHECK-NEXT: v60 = Builtin builtin=GlobalThis
// CHECK-NEXT: v61 = PropGet v60 key="console" [isFreeName]
// CHECK-NEXT: v62 = Convert v61 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v63 = PropGet v62 key="log"
// CHECK-NEXT: v64 = Convert v63 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v65 = TypeOf v59
// CHECK-NEXT: v66 = String string="Hi"
// CHECK-NEXT: v67 = StrictEq v59, v66
// CHECK-NEXT: v68 = TypeTest v59 testedType=string
// CHECK-NEXT: Branch v68 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v69) handler=b8():
// CHECK-NEXT: v70 = String string="a string"
// CHECK-NEXT: Jump -> next b7(v70)
// CHECK-NEXT: b6(v71) handler=b8():
// CHECK-NEXT: v72 = String string="no string"
// CHECK-NEXT: Jump -> next b7(v72)
// CHECK-NEXT: b7(v73) handler=b8():
// CHECK-NEXT: v74 = Call v64, v62, v65, v67, v73 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b8() role=IterationCleanup subject=v28:
// CHECK-NEXT: v75 = CatchException
// CHECK-NEXT: IteratorClose v28 completion=Throw
// CHECK-NEXT: Rethrow v75
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|symbol|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|symbol|object):
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = PropGet v0 key="name"
// CHECK-NEXT: v5 = String string="CString"
// CHECK-NEXT: v6 = StrictEq v4, v5
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
