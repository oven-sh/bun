/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Frag */
const early = <div />;
const earlyInFunction = (() => <p />)();
const earlyFragment = <></>;
var x = 1;
var DEBUG = false;
var Frag = "frag";
function h(tag) {
  return [tag, x ? "filled" : "empty", inner(), DEBUG === undefined ? "not yet set" : "set"].join(" ");
}
function inner() {
  return x ? "t" : "f";
}
console.log(early);
console.log(earlyInFunction);
console.log(earlyFragment);
console.log(<div />);
console.log(<></>);
