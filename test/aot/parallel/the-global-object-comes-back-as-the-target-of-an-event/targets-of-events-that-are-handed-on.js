// A control: built-in objects that inherit EventTarget.prototype are printed, handed to a function of the program's own and kept in a list. Nobody takes a method off them.
// STATISTIC: FunctionsLowered <= 1000
function look(given) {
  return typeof given;
}
const { signal } = new AbortController();
const kept = [performance, signal];
console.log(Bun.inspect(signal).length > 0, look(performance), look(AbortSignal.prototype), kept.length);
