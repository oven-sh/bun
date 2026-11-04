// RUN: lower
// OPTIONS: builtin-modules

// Every initializer here depends on when it runs. A lazy one would answer differently.
let counter = 0;
function next() { return ++counter; }
const first = { n: next() };
const second = { n: next() };
const startedAt = { t: Date.now() };
const date = new Date();
const random = [Math.random()];
const clock = { p: performance.now() };
const hr = { h: process.hrtime.bigint() };
const failure = new Error("made at the start");
const where = { stack: new Error("x").stack };
const env = { home: process.env.LAZY_ATTACK };
const cwd = { dir: process.cwd() };
const argv = [...process.argv];
const memory = { rss: process.memoryUsage().rss > 0 };
let mutable = 1;
const snapshot = { m: mutable };
const table = { a: 1 };
const copy = { ...table };
const keys = Object.keys(table);
const picked = { a: table.a };
const listed = [table.a, table.a + 1];
const text = { s: JSON.stringify(table) };

function deep(n: number): unknown { return n ? deep(n - 1) : [failure.stack!.split("\n").length, where.stack!.split("\n").length]; }

function main() {
  mutable = 2;
  table.a = 99;
  (table as any).b = 5;
  process.env.LAZY_ATTACK = "changed";
  counter = 100;
  const later = Date.now();
  let spin = 0;
  while (Date.now() - later < 5) spin++;
  console.log(second.n, first.n);
  console.log(startedAt.t <= later, date.getTime() <= later, clock.p < performance.now() - 4, hr.h < process.hrtime.bigint());
  console.log(random[0] === random[0]);
  console.log(JSON.stringify(deep(20)));
  console.log(env.home, typeof cwd.dir, argv.length, memory.rss);
  console.log(snapshot.m, JSON.stringify(copy), keys.join(), picked.a, listed.join(), text.s);
}
main();

// GENERATED: deep next
// CHECK-LABEL: function {{*}}name="deep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Sub v0, v4
// CHECK-NEXT: v6 = Call v3, -, v5 calleeName="deep"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="failure"
// CHECK-NEXT: v10 = PropGet v9 key="stack"
// CHECK-NEXT: v11 = PropGet v10 key="split"
// CHECK-NEXT: v12 = String string="\n"
// CHECK-NEXT: v13 = Call v11, v10, v12 calleeKey="split" calleeName="failure.stack.split"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = PropGet v14 key="length"
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="where"
// CHECK-NEXT: v18 = PropGet v17 key="stack"
// CHECK-NEXT: v19 = PropGet v18 key="split"
// CHECK-NEXT: v20 = String string="\n"
// CHECK-NEXT: v21 = Call v19, v18, v20 calleeKey="split" calleeName="where.stack.split"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = PropGet v22 key="length"
// CHECK-NEXT: v24 = NewArray v15, v23 contents=anything
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="counter"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="counter"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_4]]
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
