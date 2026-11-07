// What stands in a comment is no code: a decorator that no class follows, behind an `@import` tag in a function.
globalThis.hit = () => {
  console.log("code in a comment ran");
  return () => {};
};
function f() {
  /** @import inside (@hit()) */
  return 1;
}
console.log(f());
