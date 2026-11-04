const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const unknown = globalThis.nobodySetsThis ?? (f => f);
const number = () => (process.argv.length > 100 ? 1 : 2);
function make(fail) {
  const first = { n: number() };
  let read;
  unknown(() => first.n)();
  try {
    read = () => limit.n + first.n;
    if (fail) throw new Error("stop");
    const limit = { n: number() };
    return unknown(read)();
  } catch (error) {
    return error.message + ", " + tell(read);
  }
}
console.log(make(false), make(true));
