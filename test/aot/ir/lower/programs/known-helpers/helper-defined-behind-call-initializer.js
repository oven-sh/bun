// RUN: lower
// OPTIONS: builtin-modules

// A helper that is defined behind a call in its own initializer.
function early() {
    try {
        return __classPrivateFieldIn(C, {});
    } catch (error) {
        return error.constructor.name;
    }
}
function C() {}
var first;
var __classPrivateFieldIn = (first = early(), function(state, receiver) {
    if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object");
    return typeof state === "function" ? receiver === state : state.has(receiver);
});
console.log(first, early());

// GENERATED: C early
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="early"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b8():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = Data data=[[d_3]]
// CHECK-NEXT: v3 = IsClosureOf v0 function=[[f_4]]
// CHECK-NEXT: Branch v3 -> taken b3(), notTaken b6()
// CHECK-NEXT: b3() handler=b8():
// CHECK-NEXT: v4 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v4 -> taken b4(), notTaken b6()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v5 = TypeTest v2 testedType=object
// CHECK-NEXT: Branch v5 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5() handler=b8():
// CHECK-NEXT: v6 = StrictEq v2, v1
// CHECK-NEXT: Jump -> next b7(v6)
// CHECK-NEXT: b6() frequency=Unlikely handler=b8():
// CHECK-NEXT: v7 = Call v0, -, v1, v2 calleeName="__classPrivateFieldIn"
// CHECK-NEXT: Jump -> next b7(v7)
// CHECK-NEXT: b7(v8) handler=b8():
// CHECK-NEXT: Return v8
// CHECK-NEXT: b8() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = PropGet v9 key="constructor"
// CHECK-NEXT: v11 = PropGet v10 key="name"
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
