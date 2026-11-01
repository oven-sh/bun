// What stands in a comment is no code: a decorator that no class follows, behind an `@import` tag in front of a field.
globalThis.hit = () => {
  console.log("code in a comment ran");
  return () => {};
};
class C {
  /** @import inside (@hit()) */
  a = 1;
}
const o = {
  /** @import inside (@hit()) */
  b: 2,
};
console.log(new C().a, o.b);
