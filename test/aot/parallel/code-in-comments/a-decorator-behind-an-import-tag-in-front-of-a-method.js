// What stands in a comment is no code: a decorator that no class follows, behind an `@import` tag in front of a method.
globalThis.hit = () => {
  console.log("code in a comment ran");
  return () => {};
};
class C {
  /** @import inside (@hit()) */
  m() {
    return 1;
  }
}
console.log(new C().m());
