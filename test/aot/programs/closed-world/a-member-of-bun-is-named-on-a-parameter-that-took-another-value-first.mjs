// `open` hands its parameter on to a function that is picked at run time, and is called with that function's result before it is called with Bun.
const hide = globalThis[process.argv[2] ?? "Object"];
const open = bun => {
  hide(bun);
  return [typeof new bun.SQL("postgres://127.0.0.1:1/x"), typeof Reflect.get(bun, "Glob"), typeof bun.semver.satisfies];
};
try {
  open(hide({}));
} catch (error) {
  console.log(error.constructor.name);
}
const holder0 = { next: () => open(Bun) };
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
