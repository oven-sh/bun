// RUN: lower
// OPTIONS: builtin-modules

// Bun goes to a function that is picked at run time, and a store under a key that is picked at run time may replace any global, before Bun is read off the global object.
const hide = globalThis[process.argv[2] ?? "Boolean"];
globalThis[process.argv[3] ?? "nothing"] = hide(1);
hide(Bun);
const url = "postgres://127.0.0.1:1/x";
const open = bun => new bun.SQL(url);
const holder0 = {
  next: () => {
    const { Bun: bun } = globalThis;
    const {
      Bun: { SQL },
    } = globalThis;
    return [
      typeof open(globalThis.Bun),
      typeof new bun.SQL(url),
      typeof new SQL(url),
      typeof new (Reflect.get(globalThis.Bun, "SQL"))(url),
      typeof new (Reflect.get(self.Bun, "SQL"))(url),
      typeof new (Object.getOwnPropertyDescriptor(globalThis.Bun, "SQL").value)(url),
      typeof new { ...globalThis.Bun }.SQL(url),
    ];
  },
};
const holder1 = { next: () => holder0.next() };
const holder2 = { next: () => holder1.next() };
const holder3 = { next: () => holder2.next() };
const holder4 = { next: () => holder3.next() };
const holder5 = { next: () => holder4.next() };
const holder6 = { next: () => holder5.next() };
const holder7 = { next: () => holder6.next() };
const holder8 = { next: () => holder7.next() };
const holder9 = { next: () => holder8.next() };
const holder10 = { next: () => holder9.next() };
console.log(holder10.next().join(" "));

// GENERATED: open
// CHECK-LABEL: function {{*}}name="open"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="SQL"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="url"
// CHECK-NEXT: v5 = Construct v2, -, v4 calleeName="bun.SQL"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
