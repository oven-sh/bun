// Bun has gone into hands that nobody follows, and the store may have hit the global of that name. The compiler comes to `Bun.SQL` long after both: the callees in between are found one after the other.
const functionNobodyKnows = globalThis[process.argv[2] ?? "Boolean"];
globalThis[process.argv[3] ?? "nothing"] = functionNobodyKnows(1);
functionNobodyKnows(Bun);
const holder0 = { next: () => new Bun.SQL("postgres://127.0.0.1:1/x") };
const holder1 = { next: () => holder0.next() };
const holder2 = { next: () => holder1.next() };
const holder3 = { next: () => holder2.next() };
const holder4 = { next: () => holder3.next() };
const holder5 = { next: () => holder4.next() };
const holder6 = { next: () => holder5.next() };
console.log(typeof holder6.next());
