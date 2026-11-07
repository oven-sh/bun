// setMaxListeners and getMaxListeners of `process`, called through a variable, have no `this`: they throw, and store nothing in the scope of their caller.
const { getMaxListeners, setMaxListeners } = process;
globalThis.getLimit = getMaxListeners;
globalThis.setLimit = setMaxListeners;
let _maxListeners = "a variable of the module";
const outcome = fn => {
  try {
    return typeof fn();
  } catch (error) {
    return error.code ?? error.name;
  }
};
console.log(
  outcome(getMaxListeners),
  outcome(() => setMaxListeners(2)),
  outcome(() => getLimit()),
  outcome(() => setLimit(2)),
);
console.log(_maxListeners, typeof globalThis._maxListeners, process._maxListeners, process.getMaxListeners());
function inFunction() {
  let _maxListeners = "a variable of the function";
  const results = [
    outcome(() => getMaxListeners()),
    outcome(() => setMaxListeners(3)),
    outcome(() => setMaxListeners("x")),
  ];
  return [...results, _maxListeners].join();
}
console.log(inFunction());
console.log(
  outcome(() => getMaxListeners.call(process)),
  outcome(() => setMaxListeners.call(process, 4)),
  process.getMaxListeners(),
);
