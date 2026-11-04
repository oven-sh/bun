const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
const unknown = globalThis.nobodySetsThis ?? (f => f);
const number = () => (process.argv.length > 100 ? 1 : 2);
function probe(read) {
  return [tell(() => String(read()))];
}
function main() {
  for (const x of probe(() => x)) console.log(x, (() => x)());
  for (const y in { [probe(() => y)[0]]: 1 }) console.log(y, (() => y)());
}
main();
