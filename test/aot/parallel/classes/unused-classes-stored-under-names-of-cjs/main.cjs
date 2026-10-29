// Each CommonJS module stores a class under a name that nothing reads. Defining the class checks what it extends and converts its computed keys.
const modules = [
  ["object", () => require("./object.cjs").used],
  ["undefined", () => require("./undefined.cjs").used],
  ["arrow-function", () => require("./arrow-function.cjs").used],
  ["error", () => require("./error.cjs").used],
  ["function", () => require("./function.cjs").used],
  ["function-with-a-number-as-prototype", () => require("./function-with-a-number-as-prototype.cjs").used],
  ["class", () => require("./class.cjs").used],
  ["null", () => require("./null.cjs").used],
  ["two-names", () => require("./two-names.cjs").used],
  ["module-exports", () => require("./module-exports.cjs").used],
  ["declaration-stored-later", () => require("./declaration-stored-later.cjs").used],
  ["key", () => require("./key.cjs").used],
  ["static-key", () => require("./static-key.cjs").used],
  ["static-prototype", () => require("./static-prototype.cjs").used],
  ["required-object", () => require("./required-object.cjs").used],
  ["required-class", () => require("./required-class.cjs").used],
  ["member-of-a-required-module", () => require("./member-of-a-required-module.cjs").used],
];
for (const [name, load] of modules) {
  try {
    console.log(name, load());
  } catch (error) {
    console.log(name, error.name, error.message);
  }
}
