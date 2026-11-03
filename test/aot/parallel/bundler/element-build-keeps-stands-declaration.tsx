// A build for which elements have side effects makes an element that nobody takes, also between the declaration of a variable and the `return` that gives it back.
// @ts-nocheck
// Flags: --jsx-runtime=classic --jsx-side-effects
// Reference: bun build --compile
/** @jsxRuntime classic */
/** @jsx React.createElement */
let n = 0;
const React = {
  createElement() {
    n++;
    return null;
  },
};
function f() {
  return "made";
}
function h() {
  const a = f();
  <div />;
  return a;
}
console.log(h(), n);
