const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const number = () => (process.argv.length > 100 ? 1 : 2);
function make(fail) {
  try {
    if (fail) throw { a: undefined, b: { n: number() } };
    return "nothing thrown";
  } catch ({ a = tell(unknown(() => b.n)), b }) {
    const read = () => b.n;
    return a + " " + unknown(read)();
  }
}
console.log(make(false), "|", make(true));
