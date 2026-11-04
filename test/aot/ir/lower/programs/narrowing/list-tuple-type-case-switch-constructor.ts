// RUN: lower
// OPTIONS: builtin-modules

// @ts-ignore
// A list under a tuple type is a case of a switch beside a constructor.
const v: [number, string] = [-2115181073, 3221225475, -1267438535];
try { console.log("keys", Object.keys(v).join()); } catch { console.log("keys threw"); }
try {
    switch (v) {
        // @ts-ignore
        case WeakMap:
    }
} catch (e) {
}
try { console.log("length", v?.length); } catch { console.log("length threw"); }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|number|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="keys"
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v10 = Call v9, v8, v1 calleeName="Object.keys"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = PropGet v11 key="join"
// CHECK-NEXT: v13 = Call v12, v11 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Call v6, v4, v7, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v16 = CatchValue
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = String string="keys threw"
// CHECK-NEXT: v23 = Call v21, v19, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8(v1):
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="WeakMap" [isFreeName]
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(WeakMap) flags=[IsExpected]}
// CHECK-NEXT: v27 = StrictEq v1, v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v28) handler=b8(v28):
// CHECK-NEXT: Jump -> next b7(v28)
// CHECK-NEXT: b6(v29) handler=b8(v29):
// CHECK-NEXT: Jump -> next b7(v29)
// CHECK-NEXT: b7(v30: undefined|null|Array<undefined|null|number|string>) handler=b8(v30):
// CHECK-NEXT: Jump -> next b9(v30)
// CHECK-NEXT: b8(v31: undefined|null|Array<undefined|null|number|string>) role=CatchHandler:
// CHECK-NEXT: v32 = CatchValue
// CHECK-NEXT: Jump -> next b9(v31)
// CHECK-NEXT: b9(v33: undefined|null|Array<undefined|null|number|string>):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b14():
// CHECK-NEXT: v34 = Builtin builtin=GlobalThis
// CHECK-NEXT: v35 = PropGet v34 key="console" [isFreeName]
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v36 key="log"
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v39 = String string="length"
// CHECK-NEXT: v40 = TypeTest v33 testedType=undefined|null
// CHECK-NEXT: Branch v40 -> taken b11(| 0), notTaken b12(| 0)
// CHECK-NEXT: b11(v41) handler=b14():
// CHECK-NEXT: v42 = Undefined
// CHECK-NEXT: Jump -> next b13(v42)
// CHECK-NEXT: b12(v43) handler=b14():
// CHECK-NEXT: v44 = PropGet v43 key="length"
// CHECK-NEXT: Jump -> next b13(v44)
// CHECK-NEXT: b13(v45) handler=b14():
// CHECK-NEXT: v46 = Call v38, v36, v39, v45 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b14() role=CatchHandler:
// CHECK-NEXT: v47 = CatchValue
// CHECK-NEXT: v48 = Builtin builtin=GlobalThis
// CHECK-NEXT: v49 = PropGet v48 key="console" [isFreeName]
// CHECK-NEXT: v50 = Convert v49 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v51 = PropGet v50 key="log"
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v53 = String string="length threw"
// CHECK-NEXT: v54 = Call v52, v50, v53 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b15():
// CHECK-NEXT: v55 = Undefined
// CHECK-NEXT: Return v55
// CHECK-NEXT: }
