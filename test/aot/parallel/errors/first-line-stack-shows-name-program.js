// The first line of `stack` begins with the `name` that the object above the error holds. No code of this program reads that name.
const firstLine = error => String(error.stack).split("\n")[0];

console.log(firstLine(Object.setPrototypeOf(new Error("a literal"), { __proto__: null, name: "Alone" })));
console.log(firstLine(Object.setPrototypeOf(new Error("between two others"), { __proto__: null, first: 1, name: "Between", last: 2 })));
console.log(firstLine(Object.setPrototypeOf(new Error("below Object.prototype"), { name: "BelowObject" })));
console.log(firstLine(Object.setPrototypeOf(new Error("below Error.prototype"), { __proto__: Error.prototype, name: "BelowError" })));
console.log(firstLine(Object.setPrototypeOf(new TypeError("a TypeError"), { __proto__: null, name: "OverATypeError" })));
console.log(firstLine(Object.setPrototypeOf(Error("called"), { __proto__: null, name: "Called" })));

class WithField {
  name = "Field";
}
console.log(firstLine(Object.setPrototypeOf(new Error("an instance"), Object.setPrototypeOf(new WithField(), null))));

class Heir extends Error {}
console.log(firstLine(Object.setPrototypeOf(new Heir("an heir"), { __proto__: null, name: "OverAnHeir" })));

function target() {}
target.prototype = { __proto__: null, name: "OfNewTarget" };
console.log(firstLine(Reflect.construct(Error, ["constructed"], target)));

const linkedLate = new Error("linked late");
const above = { __proto__: null, name: "LinkedLate" };
Object.setPrototypeOf(linkedLate, above);
console.log(firstLine(linkedLate));

const captured = Object.setPrototypeOf(new Error("captured"), { __proto__: null, name: "Captured" });
Error.captureStackTrace(captured);
console.log(firstLine(captured));

const twoUp = Object.setPrototypeOf(new Error("two steps up"), { __proto__: { __proto__: null, name: "TooFar" } });
console.log(firstLine(twoUp));
