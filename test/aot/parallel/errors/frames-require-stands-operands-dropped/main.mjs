// Stack frames of a require that stands behind operands that are dropped.
// Entry points: ./c1.cjs ./c2.cjs ./c3.cjs ./c4.cjs ./c5.cjs ./c6.cjs ./c7.cjs ./c8.cjs ./c9.cjs ./c10.cjs ./c11.cjs ./c12.cjs ./c13.cjs ./c14.cjs ./c15.cjs ./c16.cjs ./c17.cjs ./c18.cjs ./c19.cjs ./c20.cjs ./c21.cjs ./c22.cjs ./c23.cjs ./c24.cjs ./c25.cjs ./c26.cjs ./c27.cjs ./c28.cjs
globalThis.show = function show(label) {
  const frames = new Error().stack.split("\n").filter(line => /\bfrom\w+ /.test(line));
  console.log(label, "|", frames.map(line => line.trim().replace(/\(.*[\\/]/, "(")).join(" < "));
};
const none = 0;
const two = 0;
const name = "./c10.cjs";
let late = "./c11.cjs";
const holder = { member: 0 };
function call() {
  return 0;
}
function fromComma() {
  const r = 1 + (0, require)("./c1.cjs").a;
  return r;
}
function fromTwoCommas() {
  const r = 1 + (none, two, require)("./c2.cjs").a;
  return r;
}
function fromText() {
  const r = 1 + ("text", require)("./c3.cjs").a;
  return r;
}
// prettier-ignore
function fromInnerComma() { const r = 1 + (0, (0, require))("./c4.cjs").a; return r; }
// prettier-ignore
function fromTwoLines() { const r = 1 + (0,
  require)("./c5.cjs").a; return r; }
function fromVoid() {
  const r = 1 + (void 0, require)("./c6.cjs").a;
  return r;
}
function fromChain() {
  const r = 1 + (0, require)?.("./c7.cjs").a;
  return r;
}
function fromList() {
  const r = 1 + ([none, two], require)("./c8.cjs").a;
  return r;
}
// prettier-ignore
function fromParentheses() { const r = 1 + ((0), require)("./c9.cjs").a; return r; }
function fromName() {
  const r = 1 + (0, require)(name).a;
  return r;
}
function fromVariable() {
  const r = 1 + (0, require)(late).a;
  return r;
}
function fromTemplate() {
  const r = 1 + (0, require)(`./c12.cjs`).a;
  return r;
}
function fromJoinedTexts() {
  const r = 1 + (0, require)("./c" + "13.cjs").a;
  return r;
}
function fromTwoArguments() {
  const r = 1 + (0, require)("./c14.cjs", 1).a;
  return r;
}
function fromSpread() {
  const r = 1 + (0, require)(...["./c15.cjs"]).a;
  return r;
}
function fromCondition() {
  const r = 1 + (0, require)(late ? "./c16.cjs" : "./c1.cjs").a;
  return r;
}
function fromAnd() {
  const r = 1 + (1 && require)("./c17.cjs").a;
  return r;
}
function fromOr() {
  const r = 1 + (0 || require)("./c18.cjs").a;
  return r;
}
function fromNullish() {
  const r = 1 + (null ?? require)("./c19.cjs").a;
  return r;
}
function fromChosen() {
  const r = 1 + (true ? require : 0)("./c20.cjs").a;
  return r;
}
function fromElement() {
  const r = 1 + [require][0]("./c21.cjs").a;
  return r;
}
function fromCall() {
  const r = 1 + (call(), require)("./c22.cjs").a;
  return r;
}
function fromMember() {
  const r = 1 + (holder.member, require)("./c23.cjs").a;
  return r;
}
function fromSum() {
  const r = 1 + (none + two, require)("./c24.cjs").a;
  return r;
}
function fromKeptOr() {
  const r = 1 + (0, none || require)("./c25.cjs").a;
  return r;
}
fromComma();
fromTwoCommas();
fromText();
fromInnerComma();
fromTwoLines();
fromVoid();
fromChain();
fromList();
fromParentheses();
fromName();
fromVariable();
fromTemplate();
fromJoinedTexts();
fromTwoArguments();
fromSpread();
fromCondition();
fromAnd();
fromOr();
fromNullish();
fromChosen();
fromElement();
fromCall();
fromMember();
fromSum();
fromKeptOr();
require("./in-a-commonjs-file.cjs");
