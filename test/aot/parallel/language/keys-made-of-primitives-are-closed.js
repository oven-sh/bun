// A prototype under the usual lock takes no key that the language makes of a value that is no string: the text of a number, `undefined`, `null`, `true`, `false`. So `array[key]` with a key that was read past the end finds nothing, whatever else the program adds. A store under such a key throws in strict code. An ordinary new name is stored, and so is such a key on an object that is no locked prototype. language/keys-made-of-primitives-are-closed-sloppy has the stores that are ignored, language/key-made-of-a-primitive-stops-the-build the store that stops the build.
function store(object, key) {
  try { object[key] = "added"; } catch (e) { return e.name; }
  const stored = object[key] === "added";
  delete object[key];
  return stored ? "stored" : "ignored";
}
const keys = [undefined, null, true, false, NaN, Infinity, -Infinity, -1, 1.5, 1e21, 1e-7, 4294967295, 4294967296, "undefined", "null", "nothing", "True"];
function row(name, object) {
  let line = name + ":";
  for (const key of keys) line += " " + (typeof key === "string" ? JSON.stringify(key) : String(key)) + " " + store(object, key);
  console.log(line);
}
row("Array.prototype", Array.prototype);
row("String.prototype", String.prototype);
row("Number.prototype", Number.prototype);
row("Map.prototype", Map.prototype);
row("Uint8Array.prototype", Uint8Array.prototype);
row("the prototype of typed arrays", Object.getPrototypeOf(Uint8Array.prototype));
row("Promise", Promise);
row("Date.prototype", Date.prototype);
row("WeakRef.prototype", WeakRef.prototype);
row("an array", []);
row("an object", {});

const numbers = [1, 2, 5];
let key = 1;
for (let i = 0; i < 5; i++) key = numbers[key];
console.log("read past the end:", key, numbers[undefined], numbers[null], "abc"[undefined], new Uint8Array(2)[true]);
export {};
/* Output:
Array.prototype: undefined TypeError null TypeError true TypeError false TypeError NaN TypeError Infinity TypeError -Infinity TypeError -1 TypeError 1.5 TypeError 1e+21 TypeError 1e-7 TypeError 4294967295 TypeError 4294967296 TypeError "undefined" TypeError "null" TypeError "nothing" stored "True" stored
String.prototype: undefined TypeError null TypeError true TypeError false TypeError NaN TypeError Infinity TypeError -Infinity TypeError -1 TypeError 1.5 TypeError 1e+21 TypeError 1e-7 TypeError 4294967295 TypeError 4294967296 TypeError "undefined" TypeError "null" TypeError "nothing" stored "True" stored
Number.prototype: undefined TypeError null TypeError true TypeError false TypeError NaN TypeError Infinity TypeError -Infinity TypeError -1 TypeError 1.5 TypeError 1e+21 TypeError 1e-7 TypeError 4294967295 TypeError 4294967296 TypeError "undefined" TypeError "null" TypeError "nothing" stored "True" stored
Map.prototype: undefined TypeError null TypeError true TypeError false TypeError NaN TypeError Infinity TypeError -Infinity TypeError -1 TypeError 1.5 TypeError 1e+21 TypeError 1e-7 TypeError 4294967295 TypeError 4294967296 TypeError "undefined" TypeError "null" TypeError "nothing" stored "True" stored
Uint8Array.prototype: undefined TypeError null TypeError true TypeError false TypeError NaN TypeError Infinity TypeError -Infinity TypeError -1 TypeError 1.5 TypeError 1e+21 TypeError 1e-7 TypeError 4294967295 TypeError 4294967296 TypeError "undefined" TypeError "null" TypeError "nothing" stored "True" stored
the prototype of typed arrays: undefined TypeError null TypeError true TypeError false TypeError NaN TypeError Infinity TypeError -Infinity TypeError -1 TypeError 1.5 TypeError 1e+21 TypeError 1e-7 TypeError 4294967295 TypeError 4294967296 TypeError "undefined" TypeError "null" TypeError "nothing" stored "True" stored
Promise: undefined stored null stored true stored false stored NaN stored Infinity stored -Infinity stored -1 stored 1.5 stored 1e+21 stored 1e-7 stored 4294967295 stored 4294967296 stored "undefined" stored "null" stored "nothing" stored "True" stored
Date.prototype: undefined TypeError null TypeError true TypeError false TypeError NaN TypeError Infinity TypeError -Infinity TypeError -1 TypeError 1.5 TypeError 1e+21 TypeError 1e-7 TypeError 4294967295 TypeError 4294967296 TypeError "undefined" TypeError "null" TypeError "nothing" stored "True" stored
WeakRef.prototype: undefined stored null stored true stored false stored NaN stored Infinity stored -Infinity stored -1 stored 1.5 stored 1e+21 stored 1e-7 stored 4294967295 stored 4294967296 stored "undefined" stored "null" stored "nothing" stored "True" stored
an array: undefined stored null stored true stored false stored NaN stored Infinity stored -Infinity stored -1 stored 1.5 stored 1e+21 stored 1e-7 stored 4294967295 stored 4294967296 stored "undefined" stored "null" stored "nothing" stored "True" stored
an object: undefined stored null stored true stored false stored NaN stored Infinity stored -Infinity stored -1 stored 1.5 stored 1e+21 stored 1e-7 stored 4294967295 stored 4294967296 stored "undefined" stored "null" stored "nothing" stored "True" stored
read past the end: undefined undefined undefined undefined undefined
*/
