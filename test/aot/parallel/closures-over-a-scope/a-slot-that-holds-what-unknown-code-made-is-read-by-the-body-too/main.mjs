const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const unknown = globalThis.nobodySetsThis ?? (f => f);
const number = () => (process.argv.length > 100 ? 1 : 2);
function make(early) {
  const said = early ? tell(() => held.n) : "not asked";
  const held = unknown({ n: number() });
  const now = held.n;
  return () => said + " " + now + " " + held.n;
}
console.log(make(false)(), make(true)());
