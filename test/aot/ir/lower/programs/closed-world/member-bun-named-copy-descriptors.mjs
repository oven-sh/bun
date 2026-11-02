// RUN: lower
// OPTIONS: builtin-modules

// Bun comes out of a built-in beside values that the build does not know, and every property of it is defined on a new object by its descriptor.

async function show(road, use) {
  try {
    console.log(road, await use());
  } catch (error) {
    console.log(road, "threw", error.name);
  }
}

await show("concat", () =>
  Object.defineProperties({}, Object.getOwnPropertyDescriptors([].concat(Bun)[0])).peek(Promise.resolve(3)),
);
await show("Array.from", () =>
  Object.defineProperties({}, Object.getOwnPropertyDescriptors(Array.from({ length: 1 }, () => Bun)[0])).$.braces(
    "{a,b}",
  ),
);

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v2 calleeName="use"
// CHECK-NEXT: v9 = Await v8, v1, v2
// CHECK-NEXT: v10 = Call v7, v5, v1, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string="threw"
// CHECK-NEXT: v18 = PropGet v11 key="name"
// CHECK-NEXT: v19 = Call v16, v14, v1, v17, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
