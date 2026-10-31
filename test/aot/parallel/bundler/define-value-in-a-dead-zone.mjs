// A name whose `--define` value names a `const` of the file is that binding, also above the declaration: a read, a call and a store there throw as they do for the name itself.
// Flags: --define NAME=target --define ROOT=holder.value
globalThis.target = () => "the global";
globalThis.holder = { value: "the global" };
function attempt(action) {
  try {
    return action();
  } catch (error) {
    return `${error.constructor.name}: ${error.message}`;
  }
}
console.log(attempt(() => NAME));
console.log(attempt(() => NAME()));
console.log(attempt(() => ROOT));
console.log(attempt(() => (ROOT = 1)));
const target = () => "the binding";
const holder = { value: "the member" };
console.log(
  attempt(() => NAME()),
  attempt(() => ROOT),
);
