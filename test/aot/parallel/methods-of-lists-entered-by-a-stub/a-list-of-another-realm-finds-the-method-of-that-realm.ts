// The stub enters the library's function only for a list that finds it. A list of another realm finds the function of that realm, which makes its results and its errors there.
import vm from "node:vm";
function ask(list: number[]): string {
  return [list.some(v => v > 1), list.map(v => v + 1), list.filter(v => v > 1), list.at(0)].map(v => (Array.isArray(v) ? "[" + v.join() + "]" : String(v))).join(" ");
}
function realmOf(list: number[]): string {
  const mapped = list.map(v => v);
  const kept = list.filter(() => true);
  return [mapped instanceof Array, kept instanceof Array, Object.getPrototypeOf(mapped) === Object.getPrototypeOf(list)].join(" ");
}
const here = [1, 2, 3];
console.log(ask(here), realmOf(here));
const there = vm.runInNewContext("[1, 2, 3]") as number[];
console.log(ask(there), realmOf(there));
let error = "";
try {
  (there as any).some();
} catch (thrown) {
  error = String(thrown instanceof TypeError) + " " + (thrown as Error).name;
}
console.log(error);
