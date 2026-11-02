// Prints the line and column of each stack frame for errors thrown by computed keys, patterns, classes and operators.
const listFrames = (error, firstLine) =>
  String(error.stack)
    .split("\n")
    .filter(line => /:\d+:\d+\)?$/.test(line))
    .map(line => {
      const [, name, lineNumber, column] = /^\s*at (?:(.*?) \()?.*?:(\d+):(\d+)\)?$/.exec(line);
      return `${name ?? "-"}@${Number(lineNumber) - firstLine}:${column}`;
    });
function check(label, firstLine, run) {
  try {
    run();
    console.log(label, "no error");
  } catch (error) {
    const frames = listFrames(error, firstLine);
    const own = frames.findIndex(frame => frame.startsWith("check@"));
    console.log(label, error.constructor.name, frames.slice(0, own).join(" < "));
  }
}
let five = 5,
  k = "nope";
const n = null,
  u = undefined,
  sym = Symbol("s");
const o = {
  a: null,
  f: 5,
  s: "str",
  arr: [1],
  nested: { deep: null },
  g() {
    return { h: 1 };
  },
  get bad() {
    throw new Error("getter");
  },
  set bad(v) {
    throw new Error("setter");
  },
  m() {
    throw new Error("m");
  },
};
function fail() {
  throw new Error("fail");
}
function F() {
  throw new Error("F");
}
function id(x) {
  return x;
}
// prettier-ignore
check(0, 54, () => { o["no" + "pe"](1); });
// prettier-ignore
check(1, 56, () => {  o["no" + "pe" + ""](1); });
// prettier-ignore
check(2, 58, () => {   o[1 + 1](); });
// prettier-ignore
check(3, 60, () => { o[void 0](); });
// prettier-ignore
check(4, 62, () => {  o[true ? "a" : "b"](); });
// prettier-ignore
check(5, 64, () => {   o?.["no" + "pe"](); });
// prettier-ignore
check(6, 66, () => { o.nested["de" + "ep"](); });
// prettier-ignore
check(7, 68, () => {  o.nested["de" + "ep"].x; });
// prettier-ignore
check(8, 70, () => {   o.nested["de" + "ep"]["x" + "y"]; });
// prettier-ignore
check(9, 72, () => { id(o)["no" + "pe"](); });
// prettier-ignore
check(10, 74, () => {  o["no" + "pe"]`x`; });
// prettier-ignore
check(11, 76, () => {   o["no" + "pe"](...[1]); });
// prettier-ignore
check(12, 78, () => { for (const [q] of [five]) ; });
// prettier-ignore
check(13, 80, () => {  for (const { q } of [n]) ; });
// prettier-ignore
check(14, 82, () => {   for (const { q: { r } } of [{ q: n }]) ; });
// prettier-ignore
check(15, 84, () => { const { a: { x } } = o; });
// prettier-ignore
check(16, 86, () => {  const { a: { x }, b } = o; });
// prettier-ignore
check(17, 88, () => {   const { nested: { deep: { x } } } = o; });
// prettier-ignore
check(18, 90, () => { const { a: [x] } = o; });
// prettier-ignore
check(19, 92, () => {  const [x] = n; });
// prettier-ignore
check(20, 94, () => {   const [x] = five; });
// prettier-ignore
check(21, 96, () => { const [x] = o; });
// prettier-ignore
check(22, 98, () => {  const [x, y] = n; });
// prettier-ignore
check(23, 100, () => {   const [[x]] = [n]; });
// prettier-ignore
check(24, 102, () => { const [{ x }] = [n]; });
// prettier-ignore
check(25, 104, () => {  const [...r] = n; });
// prettier-ignore
check(26, 106, () => {   const [] = n; });
// prettier-ignore
check(27, 108, () => { let x; ({ a: { x } } = o); });
// prettier-ignore
check(28, 110, () => {  (({ x }) => x)(n); });
// prettier-ignore
check(29, 112, () => {   (({ x }, y) => x)(n); });
// prettier-ignore
check(30, 114, () => { ((y, { x }) => x)(1, n); });
// prettier-ignore
check(31, 116, () => {  (([x]) => x)(n); });
// prettier-ignore
check(32, 118, () => {   (function ({ x }) { return x; })(n); });
// prettier-ignore
check(33, 120, () => { (function g([x]) { return x; })(n); });
// prettier-ignore
check(34, 122, () => {  (({ x } = n) => x)(); });
// prettier-ignore
check(35, 124, () => {   class A extends five {} });
// prettier-ignore
check(36, 126, () => { class A extends o.f {} });
// prettier-ignore
check(37, 128, () => {  class A { #p; static h(x) { return #p in x; } } A.h(5); });
// prettier-ignore
check(38, 130, () => {   (void 0).x; });
// prettier-ignore
check(39, 132, () => { (function ({ x }) { id(1); id(2); return x; })(n); });
// prettier-ignore
check(40, 134, () => {  (({ x }) => { id(1); id(2); })(n); });
// prettier-ignore
check(41, 136, () => {   function g({ x }) { id(1); } g(n); });
// prettier-ignore
check(42, 138, () => { function g({ x }) { } g(n); });
// prettier-ignore
check(43, 140, () => {  function g({ x }) { o.s; } g(n); });
// prettier-ignore
check(44, 142, () => {   function g({ x }) { return 1; } g(n); });
// prettier-ignore
check(45, 144, () => { function g({ x }) { let z = 1; z++; return z; } g(n); });
// prettier-ignore
check(46, 146, () => {  function g(a, { x }) { return a; } g(1, n); });
// prettier-ignore
check(47, 148, () => {   function g({ x }, { y }) { o.s; id(x); } g({}, n); });
// prettier-ignore
check(48, 150, () => { class A { m({ x }) { id(1); } } new A().m(n); });
// prettier-ignore
check(49, 152, () => {  class A { constructor({ x }) { id(1); } } new A(n); });
// prettier-ignore
check(50, 154, () => {   const q = { m({ x }) { id(1); } }; q.m(n); });
// prettier-ignore
check(51, 156, () => { function g({ x: { y } }) { id(1); } g({ x: n }); });
// prettier-ignore
check(52, 158, () => {  function g({ x = id(2) }) { id(1); } g(n); });
// prettier-ignore
check(53, 160, () => {   function g(a = id(1), { x }) { id(3); } g(1, n); });
// prettier-ignore
check(54, 162, () => { function g(a = id(1), { x }) { id(3); } g(undefined, n); });
// prettier-ignore
check(55, 164, () => {  function g([x]) { id(1); } g(n); });
// prettier-ignore
check(56, 166, () => {   function g(a, [x]) { id(1); } g(1, n); });
// prettier-ignore
check(57, 168, () => { function g(a = id(1), [x]) { id(1); } g(undefined, n); });
// prettier-ignore
check(58, 170, () => {  function g({ ...r }) { id(1); } g(n); });
// prettier-ignore
check(59, 172, () => {   function g({}) { id(1); } g(n); });
// prettier-ignore
check(60, 174, () => { function g({ [k]: x }) { id(1); } g(n); });
// prettier-ignore
check(61, 176, () => {  function g({ [id(k)]: x }) { id(1); } g(n); });
// prettier-ignore
check(62, 178, () => {   function g(...[{ x }]) { id(1); } g(n); });
// prettier-ignore
check(63, 180, () => { o[-five](); });
// prettier-ignore
check(64, 182, () => {  o[!five](); });
// prettier-ignore
check(65, 184, () => {   o[typeof five](); });
// prettier-ignore
check(66, 186, () => { o[void five](); });
// prettier-ignore
check(67, 188, () => {  o[~five](); });
// prettier-ignore
check(68, 190, () => {   o[+five](); });
// prettier-ignore
check(69, 192, () => { o[-1 + 2](); });
// prettier-ignore
check(70, 194, () => {  o["a" + 1](); });
// prettier-ignore
check(71, 196, () => {   o[1 + "a"](); });
// prettier-ignore
check(72, 198, () => { o[`a` + "b"](); });
// prettier-ignore
check(73, 200, () => {  o["a" + `b`](); });
// prettier-ignore
check(74, 202, () => {   o[`a${five}b`](); });
// prettier-ignore
check(75, 204, () => { o[`a${five}`](); });
// prettier-ignore
check(76, 206, () => {  o[2 * 3](); });
// prettier-ignore
check(77, 208, () => {   o[2 - 3](); });
// prettier-ignore
check(78, 210, () => { o[6 / 3](); });
// prettier-ignore
check(79, 212, () => {  o[1 << 2](); });
// prettier-ignore
check(80, 214, () => {   o[1 | 2](); });
// prettier-ignore
check(81, 216, () => { o[1 < 2](); });
// prettier-ignore
check(82, 218, () => {  o[1 === 1](); });
// prettier-ignore
check(83, 220, () => {   o["a" === "a"](); });
// prettier-ignore
check(84, 222, () => { o[true ? five : "b"](); });
// prettier-ignore
check(85, 224, () => {  o[("a" + "b")](); });
// prettier-ignore
check(86, 226, () => {   o[("a") + ("b")](); });
// prettier-ignore
check(87, 228, () => { o[five + "a" + "b"](); });
// prettier-ignore
check(88, 230, () => {  o["a" + ("b" + "c")](); });
// prettier-ignore
check(89, 232, () => {   o[!0 ? "a" : "b"](); });
// prettier-ignore
check(90, 234, () => { o[typeof 1 === "number" ? "a" : "b"](); });
// prettier-ignore
check(91, 236, () => {  o[class {}](); });
// prettier-ignore
check(92, 238, () => {   o[++o.f](); });
// prettier-ignore
check(93, 240, () => { o[o.f++](); });
// prettier-ignore
check(94, 242, () => {  o[delete o.zz](); });
// prettier-ignore
check(95, 244, () => {   (void five).x; });
// prettier-ignore
check(96, 246, () => { (void 0)(); });
// prettier-ignore
check(97, 248, () => {  (void five)(); });
// prettier-ignore
check(98, 250, () => {   (-five)(); });
// prettier-ignore
check(99, 252, () => { (!five)(); });
// prettier-ignore
check(100, 254, () => {  (typeof five)(); });
// prettier-ignore
check(101, 256, () => {   (1 + 1)(); });
// prettier-ignore
check(102, 258, () => { ("a" + "b")(); });
// prettier-ignore
check(103, 260, () => {  (true ? 1 : 2)(); });
// prettier-ignore
check(104, 262, () => {   `x${five}`(); });
// prettier-ignore
check(105, 264, () => { class A extends (five) {} });
// prettier-ignore
check(106, 266, () => {  class A extends id(five) {} });
// prettier-ignore
check(107, 268, () => {   class A extends o["f"] {} });
// prettier-ignore
check(108, 270, () => { class A extends (five ? five : 1) {} });
// prettier-ignore
check(109, 272, () => {  class A extends (() => {}) {} });
// prettier-ignore
check(110, 274, () => {   (class extends five {}); });
// prettier-ignore
check(111, 276, () => { const C = class extends five {}; });
// prettier-ignore
check(112, 278, () => {  id(class A extends five {}); });
// prettier-ignore
check(113, 280, () => {   class A extends Object.assign(function () {}, { prototype: 5 }) {} });
// prettier-ignore
check(114, 282, () => { class A { static h(x) { return #p in x; } #p; } A.h(n); });
// prettier-ignore
check(115, 284, () => {  class A { #p; static h(x) { return #p in x.y; } } A.h({}); });
// prettier-ignore
check(116, 286, () => {   class A { #p; static h(x) { return #p in id(x); } } A.h(5); });
// prettier-ignore
check(117, 288, () => { class A { #p; static h(x) { return (#p in x) && 1; } } A.h(5); });
// prettier-ignore
check(118, 290, () => {  for (const [q] of [n]) ; });
// prettier-ignore
check(119, 292, () => {   for (const [q, r] of [five]) ; });
// prettier-ignore
check(120, 294, () => { for (let [q] of [five]) ; });
// prettier-ignore
check(121, 296, () => {  for (var [q] of [five]) ; });
// prettier-ignore
check(122, 298, () => {   let q; for ({ q } of [n]) ; });
// prettier-ignore
check(123, 300, () => { for (const { q } of [u]) id(q); });
// prettier-ignore
check(124, 302, () => {  for (const { q, r } of [n]) ; });
// prettier-ignore
check(125, 304, () => {   for (const { q } of id([n])) ; });
// prettier-ignore
check(126, 306, () => { for (const { q } of o.arr.map(() => n)) ; });
// prettier-ignore
check(127, 308, () => {  for (const { q = 1 } of [n]) ; });
// prettier-ignore
check(128, 310, () => {   for (const { ...q } of [n]) ; });
// prettier-ignore
check(129, 312, () => { for (const {} of [n]) ; });
// prettier-ignore
check(130, 314, () => {  for (const [{ q }] of [[n]]) ; });
// prettier-ignore
check(131, 316, () => {   for (const { q: [r] } of [{ q: n }]) ; });
// prettier-ignore
check(132, 318, () => { const { a: { x } = n } = {}; });
// prettier-ignore
check(133, 320, () => {  const { a: { x } = n } = o; });
// prettier-ignore
check(134, 322, () => {   const { a: { x } } = id(o); });
// prettier-ignore
check(135, 324, () => { const { a: { x } } = o.nested.deep ?? o; });
// prettier-ignore
check(136, 326, () => {  const { s, a: { x } } = o; });
// prettier-ignore
check(137, 328, () => {   const { [k]: { x } } = o; });
// prettier-ignore
check(138, 330, () => { const { [id("a")]: { x } } = o; });
// prettier-ignore
check(139, 332, () => {  const { a: { x }, ...r } = o; });
// prettier-ignore
check(140, 334, () => {   const { nested: { deep: [x] } } = o; });
// prettier-ignore
check(141, 336, () => { const { arr: [{ x }] } = { arr: [n] }; });
// prettier-ignore
check(142, 338, () => {  const { arr: [[x]] } = { arr: [n] }; });
// prettier-ignore
check(143, 340, () => {   const [x, { y }] = [1, n]; });
// prettier-ignore
check(144, 342, () => { const [x, [y]] = [1, n]; });
// prettier-ignore
check(145, 344, () => {  const [{ x } = n] = []; });
// prettier-ignore
check(146, 346, () => {   const [[x] = n] = []; });
// prettier-ignore
check(147, 348, () => { const [, [x]] = [1, n]; });
// prettier-ignore
check(148, 350, () => {  const [...[x]] = n; });
// prettier-ignore
check(149, 352, () => {   const [...{ length }] = n; });
// prettier-ignore
check(150, 354, () => { const a1 = id(1), [x] = n; });
// prettier-ignore
check(151, 356, () => {  const a1 = id(1), { a: { x } } = o; });
// prettier-ignore
check(152, 358, () => {   let [x] = n; });
// prettier-ignore
check(153, 360, () => { var [x] = n; });
// prettier-ignore
check(154, 362, () => {  let x; [{ x }] = [n]; });
// prettier-ignore
check(155, 364, () => {   let x; ({ a: { x } } = id(o)); });
// prettier-ignore
check(156, 366, () => { export_: { const [x] = n; } });
// prettier-ignore
check(157, 368, () => {  try { const [x] = n; } finally { } });
// prettier-ignore
check(158, 370, () => {   if (five) { const [x] = n; } });
// prettier-ignore
check(159, 372, () => { ({ ...o, a: 1 }); });
// prettier-ignore
check(160, 374, () => {  ({ ...id(o) }); });
// prettier-ignore
check(161, 376, () => {   id({ ...o }); });
// prettier-ignore
check(162, 378, () => { const z = { ...o }; });
// prettier-ignore
check(163, 380, () => {  [{ ...o }]; });
// prettier-ignore
check(164, 382, () => {   ({ a: { ...o } }); });
// prettier-ignore
check(165, 384, () => { ({ ...{ ...o } }); });
// prettier-ignore
check(166, 386, () => {  (five) + sym; });
// prettier-ignore
check(167, 388, () => {   (sym) + five; });
// prettier-ignore
check(168, 390, () => { ({ valueOf: fail }) + 1; });
// prettier-ignore
check(169, 392, () => {  ({ valueOf: fail }) - 1; });
// prettier-ignore
check(170, 394, () => {   ({ valueOf: fail }) != 1; });
// prettier-ignore
check(171, 396, () => { ({ valueOf: fail }) > 1; });
// prettier-ignore
check(172, 398, () => {  ({ valueOf: fail }) & 1; });
// prettier-ignore
check(173, 400, () => {   ({ valueOf: fail }) ** 1; });
// prettier-ignore
check(174, 402, () => { ({ valueOf: fail }) % 1; });
// prettier-ignore
check(175, 404, () => {  function* g() { try { yield 1; } finally { fail(); } } const [q] = g(); });
