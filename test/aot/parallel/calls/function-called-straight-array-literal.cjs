// Functions are taken out of array literals by a constant index and called at once: `this` is the array. Plain Bun prints another output.
function which() {
  return this === globalThis ? "the global object" : Array.isArray(this) ? "the array of " + this.length : typeof this;
}
function other() {}
function stores() {
  this.stored = "stored";
  return Array.isArray(this) ? "on the array" : "elsewhere";
}
console.log("a constant index:", [other, which][1]());
console.log("the first element:", [which][0]());
console.log("an index that is computed:", [other, which][process.argv.length > 50 ? 0 : 1]());
console.log("an index in quotes:", [other, which]["1"]());
console.log("an optional call:", [other, which][1]?.());
console.log("an optional member:", [other, which]?.[1]());
console.log("in parentheses:", ([other, which][1])());
console.log("behind a comma:", (0, [other, which][1])());
console.log("a tag:", [other, which][1]``);
console.log("with arguments:", [other, which, other][1](1, 2));
console.log("a store through this:", [other, stores][1](), typeof globalThis.stored);
console.log(
  "inside a function:",
  (function () {
    return [other, which][1]();
  })(),
);
/* Output:
a constant index: the array of 2
the first element: the array of 1
an index that is computed: the array of 2
an index in quotes: the array of 2
an optional call: the array of 2
an optional member: the array of 2
in parentheses: the array of 2
behind a comma: the global object
a tag: the array of 2
with arguments: the array of 3
a store through this: on the array undefined
inside a function: the array of 2
*/
