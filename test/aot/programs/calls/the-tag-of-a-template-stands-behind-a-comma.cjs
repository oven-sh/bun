// `(0, object.method)` is a value and no longer a member of an object: as the tag of a template it is called without a receiver. Plain Bun prints another output.
const object = {
  name: "the object",
  sloppy() {
    return this === globalThis ? "the global object" : this.name;
  },
  strict() {
    "use strict";
    return this === undefined ? "undefined" : this.name;
  },
};
const key = process.argv.length > 50 ? "sloppy" : "strict";
console.log("a member as the tag:", object.sloppy``, "|", object.strict``);
console.log("in parentheses:", (object.sloppy)``, "|", (object.strict)``);
console.log("behind a comma:", (0, object.sloppy)``, "|", (0, object.strict)``);
console.log("a key in brackets behind a comma:", (0, object["sloppy"])``, "|", (0, object[key])``);
console.log("with a value in the template:", (0, object.strict)`a${1}b`);
console.log("the same as a call:", (0, object.sloppy)(), "|", (0, object.strict)());
try {
  console.log("a built-in:", typeof (0, Iterator.prototype.drop)``);
} catch (error) {
  console.log("a built-in:", error.constructor.name);
}
console.log(
  "inside a function:",
  (function () {
    return (0, object.strict)``;
  })(),
);
