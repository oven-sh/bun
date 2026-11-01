// What stands in a comment is no code: a decorator that no class follows, in a computed name of the type of a `@typedef` tag.
globalThis.hit = () => {
  console.log("code in a comment ran");
  return () => {};
};
/** @typedef {{ [(@hit())]: number }} T */
function f() {
  return 1;
}
console.log(f());
