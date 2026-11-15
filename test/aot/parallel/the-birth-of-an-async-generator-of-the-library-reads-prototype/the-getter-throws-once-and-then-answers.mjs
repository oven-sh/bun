// A generator function of the library has no `prototype` of its own, so a program can lay one on it, or change what stands above it. What the read throws is thrown by the call.
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
Object.defineProperty(made, "prototype", { configurable: true, get() { if (runs++ === 0) throw new RangeError("no"); return { mark: runs }; } });
console.log(ask(), ask(), runs);
