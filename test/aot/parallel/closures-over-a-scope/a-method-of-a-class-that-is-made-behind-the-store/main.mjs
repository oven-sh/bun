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
  const limit = { n: number() };
  class Reader {
    read() {
      return limit.n;
    }
    get now() {
      return limit.n + 1;
    }
  }
  return new Reader();
}
console.log(make().read(), make().now);
