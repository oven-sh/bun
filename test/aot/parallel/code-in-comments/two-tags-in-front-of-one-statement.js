// What stands in a comment is no code: two comments in front of one statement, each with a decorator that no class follows.
globalThis.hit = () => {
  console.log("code in a comment ran");
  return () => {};
};
/** @import inside (@hit()) */
/** @import again (@hit()) */
function f() {
  return 1;
}
console.log(f());
