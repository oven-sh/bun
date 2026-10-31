// A spy redefines a property, so in a compiled executable `spyOn` throws where a built-in refuses the definition: a name that Object.prototype does not have, the accessor `size`, a member that Map.prototype keeps, and `toString`, a name that Math only inherits. A property of a locked object that is read-only and not configurable is refused too, whether the language fixes it (Math.PI) or the program defined it that way (Math.fixed). Array.prototype and Math take a name of the program's own, so a spy on any other such name answers as in plain Bun. console is not locked.
import { spyOn } from "bun:test";

function attempt(label, install, call) {
  const before = call();
  try {
    const spy = install();
    console.log(label + ": " + before + ", spied: " + call() + ", calls " + spy.mock.calls.length);
    spy.mockRestore();
  } catch (error) {
    console.log(label + ": " + before + ", throws " + error.name);
  }
  console.log(label + " afterwards: " + call());
}

attempt("Math.toString", () => spyOn(Math, "toString").mockReturnValue("spied"), () => Math.toString());
attempt("Object.prototype.notThere", () => spyOn(Object.prototype, "notThere").mockReturnValue(1), () => ({}).notThere);
attempt("Array.prototype.notThere", () => spyOn(Array.prototype, "notThere").mockReturnValue(1), () => [].notThere);
attempt("Map.prototype.size", () => spyOn(Map.prototype, "size").mockReturnValue(7), () => new Map([[1, 2]]).size);
attempt("Math.PI", () => spyOn(Math, "PI").mockReturnValue(3), () => Math.PI);

Object.defineProperty(Math, "added", { value: () => "real", writable: true, enumerable: true, configurable: true });
attempt("Math.added", () => spyOn(Math, "added").mockReturnValue("spied"), () => Math.added());

Object.defineProperty(Math, "fixed", { value: () => "real" });
attempt("Math.fixed", () => spyOn(Math, "fixed").mockReturnValue("spied"), () => Math.fixed());

const spy = spyOn(console, "warn").mockImplementation(() => {});
console.warn("hidden");
console.log("console.warn: calls " + spy.mock.calls.length);
spy.mockRestore();
/* Output:
Math.toString: [object Math], throws TypeError
Math.toString afterwards: [object Math]
Object.prototype.notThere: undefined, throws TypeError
Object.prototype.notThere afterwards: undefined
Array.prototype.notThere: undefined, spied: 1, calls 1
Array.prototype.notThere afterwards: undefined
Map.prototype.size: 1, throws TypeError
Map.prototype.size afterwards: 1
Math.PI: 3.141592653589793, throws TypeError
Math.PI afterwards: 3.141592653589793
Math.added: real, spied: spied, calls 1
Math.added afterwards: real
Math.fixed: real, throws TypeError
Math.fixed afterwards: real
console.warn: calls 1
*/
