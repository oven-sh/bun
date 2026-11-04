const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const number = () => (process.argv.length > 100 ? 1 : 2);
const handed = [];
function* make() {
  const read = () => limit.n;
  try {
    yield "first";
    const unused = number();
    yield unused;
  } finally {
    handed.push(tell(unknown(read)));
  }
  const limit = { n: number() };
  yield read();
}
const ended = make();
ended.next();
ended.return();
console.log(handed.join(), [...make()].join(), handed.join());
