// A store or a definition under a key that only the run knows, through a value that only the run knows, puts a number or a text where a function of console, process, Intl or
// performance was. What is read there afterwards, by its own name, is what was put there, and a call of it throws.
function storeUnder(target, key, value) {
  target[key] = value;
}
function defineUnder(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, configurable: true });
}
const say = console.info.bind(console);
const rows = JSON.parse(
  '[["console","debug"],["console","table"],["process","emitWarning"],["Intl","getCanonicalLocales"],["performance","mark"]]',
);
rows.forEach(([holder, key], index) =>
  (index % 2 ? defineUnder : storeUnder)(globalThis[holder], key, index % 3 ? "text " + index : index),
);
say([typeof console.debug, console.debug, typeof console.table, console.table].join());
say([typeof process.emitWarning, process.emitWarning, typeof Intl.getCanonicalLocales, Intl.getCanonicalLocales].join());
say([typeof performance.mark, performance.mark].join());
const calls = [
  () => console.debug("x"),
  () => console.table([]),
  () => process.emitWarning("x"),
  () => Intl.getCanonicalLocales("en"),
  () => performance.mark("x"),
];
for (const call of calls) {
  try {
    say(String(call()));
  } catch (error) {
    say(error.name);
  }
}
