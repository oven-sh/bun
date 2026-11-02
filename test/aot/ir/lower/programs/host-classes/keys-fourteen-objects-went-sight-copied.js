// RUN: lower
// OPTIONS: builtin-modules

// Keys of fourteen objects that went out of sight and were copied.
const names = holder => Reflect.ownKeys(holder).map(String).join();

JSON.stringify(1);
[JSON].map(each => Object.entries(each));
console.log("JSON", names(JSON));

Reflect.has({}, "a");
const kept = new Map([[1, Reflect]]);
({ ...kept.get(1) });
console.log("Reflect", names(Reflect));

Array.of(1);
const list = Object.getPrototypeOf(JSON.parse("[]")).constructor;
({ ...list });
console.log("Array", names(list));

String.fromCharCode(65);
Object.entries.bind(null, String)();
console.log("String", names(String));

BigInt.asIntN(8, 1n);
Reflect.apply(Object.assign, null, [{}, BigInt]);
console.log("BigInt", names(BigInt));

Object.is(1, 1);
const { is, ...rest } = new WeakRef(Object).deref();
console.log("Object", names(Object));

Symbol.for("a");
function* symbols() {
  yield Symbol;
}
for (const each of symbols()) {
  Object.entries(each);
  console.log("Symbol", names(each));
}

Buffer.alloc(1);
const bytes = Buffer.alloc(4).slice(1, 3).constructor;
Object.assign({}, bytes);
console.log("Buffer", names(bytes));

Atomics.isLockFree(4);
for (const each of new Set([Atomics])) {
  ({ ...each });
  console.log("Atomics", names(each));
}

Number.isNaN(1);
Promise.resolve(Number).then(each => {
  Object.assign({}, each);
  console.log("Number", names(each));
});

Promise.all([]);
const settled = Promise.resolve(1);
settled.then(() => {
  ({ ...settled.constructor });
  console.log("Promise", names(settled.constructor));
});

Math.hypot(1);
process.nextTick(each => {
  Object.values(each);
  console.log("Math", names(each));
}, Math);

Intl.getCanonicalLocales("en");
queueMicrotask(function () {
  const each = this ?? Intl;
  Object.entries(each);
  console.log("Intl", names(each));
});

Date.now();
setTimeout(
  each => {
    ({ ...each });
    console.log("Date", names(each));
  },
  0,
  Date,
);

// GENERATED: symbols names
// CHECK-LABEL: function {{*}}name="symbols"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|[[f_1]]> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Builtin builtin=Symbol
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="names"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="map"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="map" calleeName="map"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, v9 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
