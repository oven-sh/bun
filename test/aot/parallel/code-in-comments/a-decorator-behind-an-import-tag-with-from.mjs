// What stands in a comment is no code: a decorator that no class follows, where an `@import` tag names its module.
globalThis.hit = () => {
  console.log("code in a comment ran");
  return () => {};
};
/** @import x from (@hit()) */
function f() {
  return 1;
}
console.log(f());
