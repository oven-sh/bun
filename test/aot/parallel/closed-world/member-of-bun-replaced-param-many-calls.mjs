// Bun goes to a function that is picked at run time, and a store under a key that is picked at run time may replace any global, before Bun is handed to the functions that change it.
const hide = globalThis[process.argv[2] ?? "Boolean"];
globalThis[process.argv[3] ?? "nothing"] = hide(1);
hide(Bun);
const mine = name => ({ replaced: () => name });
const store = bun => {
  bun.stdout = mine("stored on a parameter");
};
const storeBehindAnotherCall = bun => store(bun);
const define = (bun, name, value) => Object.defineProperty(bun, name, { value });
const storeAfterHandingOn = bun => {
  hide(bun);
  bun.nanoseconds = () => "stored on a parameter that was handed on first";
};
const remove = bun => Reflect.deleteProperty(bun, "stdin");
class Holder {
  constructor(bun) {
    this.bun = bun;
  }
  store() {
    this.bun.which = () => "stored on a field";
  }
}
const holder0 = {
  next: () => {
    store(Bun);
    const answers = [Bun.stdout.replaced()];
    Bun.stdout = mine("stored again");
    storeBehindAnotherCall(globalThis.Bun);
    answers.push(Bun.stdout.replaced());
    define(Bun, "stderr", mine("defined on a parameter"));
    answers.push(Bun.stderr.replaced());
    storeAfterHandingOn(Bun);
    answers.push(Bun.nanoseconds());
    answers.push(remove(Bun), typeof Bun.stdin);
    new Holder(Bun).store();
    answers.push(Bun.which());
    return answers;
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
console.log(holder10.next().join("\n"));
