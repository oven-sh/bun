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
  class Held {
    n = number();
  }
  unknown(Held);
  return build;
  function build() {
    return new Held().n;
  }
}
console.log(make()());
