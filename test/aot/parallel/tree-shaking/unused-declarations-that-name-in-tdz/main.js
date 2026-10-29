// Each file declares something that nothing uses, and the declaration names a const, a let or a class that is declared further down, so evaluating it throws a ReferenceError. In `extends` the class further down is hoisted, and the file loads. `bun build --compile` without --aot removes these declarations.
const loads = {
  "plain-name": () => import("./cases/plain-name.js"),
  "call": () => import("./cases/call.js"),
  "object": () => import("./cases/object.js"),
  "array": () => import("./cases/array.js"),
  "extends": () => import("./cases/extends.js"),
  "static-field": () => import("./cases/static-field.js"),
  "typeof": () => import("./cases/typeof.js"),
  "comparison": () => import("./cases/comparison.js"),
  "conditional": () => import("./cases/conditional.js"),
};
for (const file in loads) {
  try {
    await loads[file]();
    console.log(file + ": loaded");
  } catch (error) {
    console.log(file + ": " + error.name);
  }
}
