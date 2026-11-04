const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const unknown = globalThis.nobodySetsThis ?? (f => f);
const number = () => (process.argv.length > 100 ? 1 : 2);
function make() {
  const first = { n: number() };
  unknown(() => first.n)();
  class Reader {
    read() {
      return limit.n;
    }
    get now() {
      return limit.n + 1;
    }
    static early = tell(() => new Reader().read());
  }
  const limit = { n: number() };
  return unknown(new Reader());
}
const made = make();
console.log(made.read(), made.now, made.constructor.early);
