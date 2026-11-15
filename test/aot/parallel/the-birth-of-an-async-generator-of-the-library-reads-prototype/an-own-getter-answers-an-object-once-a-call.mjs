// A control: the read runs code of the program, once a call, and does not throw.
import { glob } from "node:fs/promises";
const made = glob;
const realm = Object.getPrototypeOf(async function* () {}).prototype;
function call() {
  const born = Reflect.apply(made, undefined, ["*.nothing-here"]);
  Promise.resolve(realm.return.call(born)).catch(() => 0);
  return born;
}
function above(born) {
  const found = Object.getPrototypeOf(born);
  return found === realm ? "the realm's" : found === null ? "null" : "mark" in found ? "mine: " + found.mark : "another";
}
function ask() {
  try {
    return above(call());
  } catch (error) {
    return "thrown: " + error.name + ": " + error.message;
  }
}
console.log(Object.hasOwn(made, "prototype"), ask());
let runs = 0;
Object.defineProperty(made, "prototype", { configurable: true, get() { runs++; return { mark: runs }; } });
console.log(ask(), ask(), runs);
