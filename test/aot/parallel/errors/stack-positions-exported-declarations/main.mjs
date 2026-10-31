// Imports files whose exported declarations throw while they are evaluated, and prints the frames of each error.
function framesOf(error) {
  return String(error.stack)
    .split("\n")
    .map(text => /^\s*at (.*?) ?\(?[^ ()]*[\/\\]([\w.-]+):(\d+):(\d+)\)?$/.exec(text))
    .filter(found => found !== null)
    .map(found => found[1] + "@" + found[3] + ":" + found[4])
    .join(" < ");
}
async function show(load) {
  try {
    await load();
    console.log("no error");
  } catch (error) {
    console.log(framesOf(error));
  }
}
await show(() => import("./static-field.mjs"));
await show(() => import("./static-field-of-default-class.mjs"));
await show(() => import("./static-field-of-default-class-without-name.mjs"));
await show(() => import("./static-block.mjs"));
await show(() => import("./computed-static-key.mjs"));
await show(() => import("./computed-method-key.mjs"));
await show(() => import("./heritage.mjs"));
await show(() => import("./second-static-field.mjs"));
await show(() => import("./static-getter-read-by-a-field.mjs"));
await show(() => import("./static-field-that-converts.mjs"));
await show(() => import("./static-field-that-constructs.mjs"));
await show(() => import("./class-exported-below.mjs"));
await show(() => import("./class-expression.mjs"));
await show(() => import("./class-in-heritage.mjs"));
await show(() => import("./abstract-class.ts"));
await show(() => import("./default-abstract-class.ts"));
await show(() => import("./typed-static-field.ts"));
await show(() => import("./second-variable.mjs"));
await show(() => import("./default-of-a-pattern.mjs"));
await show(() => import("./default-value.mjs"));
await show(() => import("./default-list.mjs"));
await show(() => import("./default-object.mjs"));
await show(() => import("./default-call-of-an-arrow-function.mjs"));
await show(() => import("./variable-that-converts.mjs"));
await show(() => import("./default-that-converts.mjs"));
