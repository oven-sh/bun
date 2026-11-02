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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="bun:ffi"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="Buffer" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="from"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(BufferFrom) flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="Hi\u{0}"
// CHECK-NEXT: v11 = Call v9, v7, v10 calleeKey="from" calleeName="Buffer.from"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Buffer flags=[IsExpected]}
// CHECK-NEXT: v13 = Builtin builtin=Object
// CHECK-NEXT: v14 = Builtin builtin=ObjectValues
// CHECK-NEXT: v15 = Call v14, v13, v4 calleeName="Object.values"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array<undefined|null|string|symbol|object> flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="filter"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v19 = NewClosure function=[[f_5]]
// CHECK-NEXT: v20 = Call v18, v16, v19 calleeKey="filter" calleeName="filter"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|Array<undefined|null|string|symbol|object> flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v4 key="CString"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v23 key="bind"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v26 = Null
// CHECK-NEXT: v27 = Call v25, v23, v26 calleeKey="bind" calleeName="ffi.CString.bind"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v29 = Builtin builtin=Proxy
// CHECK-NEXT: v30 = PropGet v4 key="CString"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v32 = Data data=[[d_8]]
// CHECK-NEXT: v33 = Construct v29, -, v31, v32 calleeName="Proxy"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v35 = Integer
// CHECK-NEXT: v36 = ElemGet v21, v35
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|string|symbol|object flags=[IsExpected]}
// CHECK-NEXT: v38 = NewArray v37, v28, v34 contents=undefined|null|string|symbol|object
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|Array<undefined|null|string|symbol|object> flags=[IsExpected]}
// CHECK-NEXT: v40 = IteratorOpen v39
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v42 = IteratorResume v40
// CHECK-NEXT: v43 = ResultAt v42
// CHECK-NEXT: v44 = ResultAt v42 index=1
// CHECK-NEXT: Branch v43 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v45 = Builtin builtin=GlobalThis
// CHECK-NEXT: v46 = PropGet v45 key="console" [isFreeName]
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v48 = PropGet v47 key="log"
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v50 = Builtin builtin=Reflect
// CHECK-NEXT: v51 = Builtin builtin=ReflectConstruct
// CHECK-NEXT: v52 = PropGet v4 key="CString"
// CHECK-NEXT: v53 = Convert v52 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v54 = PropGet v4 key="ptr"
// CHECK-NEXT: v55 = Convert v54 declared={type=builtin(BunFfiPtr) flags=[IsExpected]}
// CHECK-NEXT: v56 = Call v55, v4, v12 calleeKey="ptr" calleeName="ffi.ptr"
// CHECK-NEXT: v57 = Convert v56 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v58 = NewArray v57 contents=undefined|null|number|bigint
// CHECK-NEXT: v59 = Convert v58 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v60 = Call v51, v50, v53, v59 calleeName="Reflect.construct" [isDoneInPlace]
// CHECK-NEXT: v61 = Convert v60 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v62 = TypeOf v61
// CHECK-NEXT: v63 = PropGet v4 key="CString"
// CHECK-NEXT: v64 = Convert v63 declared={type=builtin(BunFfiCString) flags=[IsExpected]}
// CHECK-NEXT: v65 = PropGet v4 key="ptr"
// CHECK-NEXT: v66 = Convert v65 declared={type=builtin(BunFfiPtr) flags=[IsExpected]}
// CHECK-NEXT: v67 = Call v66, v4, v12 calleeKey="ptr" calleeName="ffi.ptr"
// CHECK-NEXT: v68 = Convert v67 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v69 = Call v64, v4, v68 calleeKey="CString" calleeName="ffi.CString"
// CHECK-NEXT: v70 = Convert v69 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v71 = TypeOf v70
// CHECK-NEXT: v72 = Call v49, v47, v62, v71 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v73 = Undefined
// CHECK-NEXT: Return v73
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b11():
// CHECK-NEXT: v74 = Convert v44 declared={type=undefined|null|string|symbol|object flags=[IsExpected]}
// CHECK-NEXT: v75 = PropGet v4 key="ptr"
// CHECK-NEXT: v76 = Convert v75 declared={type=builtin(BunFfiPtr) flags=[IsExpected]}
// CHECK-NEXT: v77 = Call v76, v4, v12 calleeKey="ptr" calleeName="ffi.ptr"
// CHECK-NEXT: v78 = Convert v77 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v79 = Construct v74, -, v78 calleeName="Class"
// CHECK-NEXT: v80 = Builtin builtin=GlobalThis
// CHECK-NEXT: v81 = PropGet v80 key="console" [isFreeName]
// CHECK-NEXT: v82 = Convert v81 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v83 = PropGet v82 key="log"
// CHECK-NEXT: v84 = Convert v83 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v85 = TypeOf v79
// CHECK-NEXT: v86 = String string="Hi"
// CHECK-NEXT: v87 = StrictEq v79, v86
// CHECK-NEXT: v88 = TypeTest v79 testedType=string
// CHECK-NEXT: Branch v88 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v89) handler=b11():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: v90 = String string="a string"
// CHECK-NEXT: Jump -> next b10(v90)
// CHECK-NEXT: b8(v91) handler=b11():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b11():
// CHECK-NEXT: v92 = String string="no string"
// CHECK-NEXT: Jump -> next b10(v92)
// CHECK-NEXT: b10(v93) handler=b11():
// CHECK-NEXT: v94 = Call v84, v82, v85, v87, v93 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b11() role=IterationCleanup subject=v40:
// CHECK-NEXT: v95 = CatchException
// CHECK-NEXT: IteratorClose v40 completion=Throw
// CHECK-NEXT: Rethrow v95
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|symbol|object flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|symbol|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|[[f_10]]|[[f_11]]|[[f_12]]|[[f_13]]|[[f_14]]|[[f_15]]|[[f_16]]|[[f_6]]|[[f_17]]|[[f_18]] flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="name"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="CString"
// CHECK-NEXT: v8 = StrictEq v6, v7
// CHECK-NEXT: Jump -> next b5(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Jump -> next b5(v9)
// CHECK-NEXT: b5(v10):
// CHECK-NEXT: v11 = Convert v10 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_19]]]
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
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_20]]]
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
