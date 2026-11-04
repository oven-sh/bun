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
  let held = unknown({ n: number() });
  return [read, write];
  function read() {
    return held.n;
  }
  function write(n) {
    held = unknown({ n });
  }
}
const [read, write] = make();
console.log(read());
write(7);
console.log(read());
