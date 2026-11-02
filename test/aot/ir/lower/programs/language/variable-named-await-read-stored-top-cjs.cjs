// RUN: lower
// OPTIONS: builtin-modules

// Declares a variable named `await` at the top of a CommonJS file, reads it, stores to it and calls it there. The file stays sloppy-mode code. Plain Bun prints another output.
var await = 1;
console.log("read:", await);
var copy = await;
console.log("copied:", copy);
await = 2;
console.log("stored to:", await);
await++;
console.log("counted up:", await);
console.log("in a sum:", await + 1, await - 1, await * 2);
console.log("negated behind it:", await - 1);
await += 4;
console.log("added to:", await);
[await] = [8];
console.log("out of a list:", await);
({ await } = { await: 9 });
console.log("out of an object:", await, { await }.await);
console.log("its type:", typeof await, typeof await);
function twice(a, a) {
  return a;
}
console.log("two parameters of one name:", twice(1, 2), await);
console.log(
  "this of a function:",
  (function () {
    return this === globalThis;
  })(),
);
await = function (value) {
  return "called with " + value;
};
console.log(await(3));
console.log(await`text`);
console.log(await.name, await.length);
await = [10, 11];
console.log("an element:", await[1]);
for (await of [12, 13]);
console.log("a loop variable:", await);
for (await in { key: 1 });
console.log("a key:", await);
async function waits() {
  return (await Promise.resolve(14)) + 1;
}
waits().then(value => console.log("the operator in an async function:", value));
console.log("on the module:", typeof module, typeof exports, typeof require);

// GENERATED: waits await
// CHECK-LABEL: function {{*}}name="waits"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsSloppy, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<number> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToThis v0
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Promise" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="resolve"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v7 = Integer integer=14
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Promise<number> flags=[IsExpected]}
// CHECK-NEXT: v10 = Await v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=number|object flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="await"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="called with "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
