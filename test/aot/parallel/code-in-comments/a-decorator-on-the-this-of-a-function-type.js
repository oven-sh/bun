// What stands in a comment is no code: a mistake in one stops no build, and the decorator never runs.
globalThis.hit = () => {
  console.log("code in a comment ran");
  return () => {};
};
/** @param {(this: @hit() number) => void} a */
function f(a) {
  return 1;
}
console.log(f());
