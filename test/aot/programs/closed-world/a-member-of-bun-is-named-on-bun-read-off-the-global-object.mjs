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
