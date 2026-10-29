const modules = [
  ["array-holds-const", () => require("./modules/array-holds-const.js")],
  ["array-holds-object", () => require("./modules/array-holds-object.js")],
  ["sum-with-const", () => require("./modules/sum-with-const.js")],
  ["computed-key", () => require("./modules/computed-key.js")],
  ["typeof-const", () => require("./modules/typeof-const.js")],
  ["class-extends-class", () => require("./modules/class-extends-class.js")],
  ["namespace-member", () => require("./modules/namespace-member.js")],
  ["namespace-member-constant", () => require("./modules/namespace-member-constant.js")],
  ["reexported-const", () => require("./modules/reexported-const.js")],
  ["array-holds-function", () => require("./modules/array-holds-function.js")],
  ["array-holds-var", () => require("./modules/array-holds-var.js")],
  ["array-holds-namespace", () => require("./modules/array-holds-namespace.js")],
  ["closure-reads-const", () => require("./modules/closure-reads-const.js")],
];
for (const [name, load] of modules) {
  try {
    load();
    console.log(name, "loaded");
  } catch (error) {
    console.log(name, error.name);
  }
}
export {};
