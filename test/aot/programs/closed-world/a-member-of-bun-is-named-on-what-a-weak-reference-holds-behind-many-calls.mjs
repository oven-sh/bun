// Bun goes to a function that is picked at run time, and a store under a key that is picked at run time may replace any global, before the member is named.
const hide = globalThis[process.argv[2] ?? "Boolean"];
globalThis[process.argv[3] ?? "nothing"] = hide(1);
hide(Bun);
const url = "postgres://127.0.0.1:1/x";
const holder0 = {
  next: async () => {
    const bun = new WeakRef(Bun).deref();
    return typeof new bun.SQL(url);
  },
};
const holder1 = { next: () => holder0.next() };
const holder2 = { next: () => holder1.next() };
const holder3 = { next: () => holder2.next() };
const holder4 = { next: () => holder3.next() };
const holder5 = { next: () => holder4.next() };
const holder6 = { next: () => holder5.next() };
console.log(await holder6.next());
