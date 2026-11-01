// What stands in a comment is no code: a decorator that no class follows, behind an `@import` tag.
globalThis.hit = () => {
  console.log("code in a comment ran");
  return () => {};
};
/** @import inside (@hit()) */
function f() {
  return 1;
}
console.log(f());
