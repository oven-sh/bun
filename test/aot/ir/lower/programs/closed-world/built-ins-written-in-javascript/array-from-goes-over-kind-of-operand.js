// RUN: lower
// OPTIONS: builtin-modules

// Array.from alone in a program: whatever it calls on its operand is in the executable: the iterators of a set, a map, a string, a typed array and a generator, an iterator of the program with `return`, and the length and the elements of an array-like object.
console.log(Array.from(new Set([1, 2])).join());
console.log(Array.from(new Map([[1, 2]]).keys()).join(), Array.from(new Map([[1, 2]])).join("|"));
console.log(Array.from("a\u{1F600}b").length);
console.log(Array.from(new Uint8Array([7, 8])).join());
console.log(Array.from({ length: 2, 0: "x", 1: "y" }).join());
console.log(Array.from((function* () { yield 1; yield 2; })()).join());
const closing = {
  [Symbol.iterator]() {
    return {
      next: () => ({ done: false, value: 1 }),
      return() {
        console.log("closed");
        return {};
      },
    };
  },
};
try {
  Array.from(closing, () => {
    throw new Error("stop");
  });
} catch (error) {
  console.log(error.message);
}

// GENERATED: [Symbol.iterator] next return
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_2]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v2 = NewObject layout=[[L_1]]
// CHECK-NEXT: PropDefine v2, v1 key="next"
// CHECK-NEXT: v4 = NewClosure function=[[f_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v2, v5 key="return"
// CHECK-NEXT: v7 = FinishObject v2
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|[[L_6]] flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_7]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="return"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="closed"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v7 = Data data=[[d_8]]
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
