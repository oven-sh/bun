// RUN: lower
// OPTIONS: builtin-modules

// In the manner of the package symbol-observable: where Symbol.observable is missing it makes a symbol and assigns it to Symbol, and every library that loads afterwards finds the same one.
function ponyfill(root) {
  let result;
  const { Symbol } = root;
  if (typeof Symbol === "function") {
    if (Symbol.observable) result = Symbol.observable;
    else {
      result = Symbol("observable");
      Symbol.observable = result;
    }
  } else result = "@@observable";
  return result;
}

const first = ponyfill(globalThis);
const second = ponyfill(globalThis);
const store = { [first]() { return this; }, subscribe() { return "subscribed"; } };
console.log([typeof first, first === second, first === Symbol.observable, String(first), store[Symbol.observable]().subscribe(), Object.keys(Symbol).join(), Symbol.observable in store].join(" "));
console.log([typeof Symbol.iterator, [][Symbol.iterator] === [].values, Symbol("a").description, Symbol.for("b") === Symbol.for("b")].join(" "));

// GENERATED: ponyfill subscribe
// CHECK-LABEL: function {{*}}name="ponyfill"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v3 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v5 = NewRuntimeError runtimeError=NotDestructurable name="Symbol"
// CHECK-NEXT: Throw v5
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: v7 = PropGet v6 key="Symbol"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v9 = TypeTest v8 testedType=function
// CHECK-NEXT: Branch v9 -> taken b5(| 0), notTaken b12(| 0)
// CHECK-NEXT: b5(v10):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v11 = PropGet v10 key="observable"
// CHECK-NEXT: v12 = ToBoolean v11
// CHECK-NEXT: Branch v12 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v13):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v14 = PropGet v10 key="observable"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b11(v15)
// CHECK-NEXT: b9(v16):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v17 = String string="observable"
// CHECK-NEXT: v18 = Call v10, -, v17 calleeName="Symbol"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v10, v19 key="observable"
// CHECK-NEXT: Jump -> next b11(v19)
// CHECK-NEXT: b11(v21):
// CHECK-NEXT: Jump -> next b14(v21)
// CHECK-NEXT: b12(v22):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v23 = String string="@@observable"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b14(v24)
// CHECK-NEXT: b14(v25):
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="subscribe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="subscribed"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
