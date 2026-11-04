const unknown = globalThis.nobodySetsThis ?? (value => value);
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const number = () => (process.argv.length > 100 ? 1 : 2);
function make(early) {
  const read = () => limit.n;
  const said = [];
  if (early) said.push(tell(() => {
    limit = { n: 9 };
  }));
  said.push(tell(unknown(read)));
  let limit = { n: number() };
  said.push(read());
  return said.join();
}
console.log(make(false), "|", make(true));
