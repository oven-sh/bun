// RUN: lower
// OPTIONS: builtin-modules

// Prints the line and column of each stack frame for errors thrown after type annotations on the same line.
// @ts-nocheck
const listFrames = (error: any, firstLine: number) =>
  String(error.stack)
    .split("\n")
    .filter(line => /:\d+:\d+\)?$/.test(line))
    .map(line => {
      const [, name, lineNumber, column] = /^\s*at (?:(.*?) \()?.*?:(\d+):(\d+)\)?$/.exec(line)!;
      return `${name ?? "-"}@${Number(lineNumber) - firstLine}:${column}`;
    });
function check(label: number, firstLine: number, run: () => unknown) {
  try {
    run();
    console.log(label, "no error");
  } catch (error: any) {
    const frames = listFrames(error, firstLine);
    const own = frames.findIndex(frame => frame.startsWith("check@"));
    console.log(label, error.constructor.name, frames.slice(0, own).join(" < "));
  }
}
let five: any = 5,
  k: any = "nope";
const n: any = null,
  u: any = undefined,
  sym = Symbol("s");
const o: any = {
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
  set bad(v: any) {
    throw new Error("setter");
  },
  m() {
    throw new Error("m");
  },
};
function fail(...rest: any[]): any {
  throw new Error("fail");
}
function F(this: any, ...rest: any[]): any {
  throw new Error("F");
}
function id(...values: any[]): any {
  return values[0];
}
// prettier-ignore
check(0, 55, (): any => { const before: Array<number | string> = [1 as number]; o["no" + "pe"](1); });
// prettier-ignore
check(1, 57, (): any => { const before: Array<number | string> = [1 as number];  o["no" + "pe" + ""](1); });
// prettier-ignore
check(2, 59, (): any => { const before: Array<number | string> = [1 as number];   o[1 + 1](); });
// prettier-ignore
check(3, 61, (): any => { const before: Array<number | string> = [1 as number]; o[void 0](); });
// prettier-ignore
check(4, 63, (): any => { const before: Array<number | string> = [1 as number];  o[true ? "a" : "b"](); });
// prettier-ignore
check(5, 65, (): any => { const before: Array<number | string> = [1 as number];   o?.["no" + "pe"](); });
// prettier-ignore
check(6, 67, (): any => { const before: Array<number | string> = [1 as number]; o.nested["de" + "ep"](); });
// prettier-ignore
check(7, 69, (): any => { const before: Array<number | string> = [1 as number];  o.nested["de" + "ep"].x; });
// prettier-ignore
check(8, 71, (): any => { const before: Array<number | string> = [1 as number];   o.nested["de" + "ep"]["x" + "y"]; });
// prettier-ignore
check(9, 73, (): any => { const before: Array<number | string> = [1 as number]; id(o)["no" + "pe"](); });
// prettier-ignore
check(10, 75, (): any => { const before: Array<number | string> = [1 as number];  o["no" + "pe"]`x`; });
// prettier-ignore
check(11, 77, (): any => { const before: Array<number | string> = [1 as number];   o["no" + "pe"](...[1]); });
// prettier-ignore
check(12, 79, (): any => { const before: Array<number | string> = [1 as number]; for (const [q] of [five]) ; });
// prettier-ignore
check(13, 81, (): any => { const before: Array<number | string> = [1 as number];  for (const { q } of [n]) ; });
// prettier-ignore
check(14, 83, (): any => { const before: Array<number | string> = [1 as number];   for (const { q: { r } } of [{ q: n }]) ; });
// prettier-ignore
check(15, 85, (): any => { const before: Array<number | string> = [1 as number]; const { a: { x } } = o; });
// prettier-ignore
check(16, 87, (): any => { const before: Array<number | string> = [1 as number];  const { a: { x }, b } = o; });
// prettier-ignore
check(17, 89, (): any => { const before: Array<number | string> = [1 as number];   const { nested: { deep: { x } } } = o; });
// prettier-ignore
check(18, 91, (): any => { const before: Array<number | string> = [1 as number]; const { a: [x] } = o; });
// prettier-ignore
check(19, 93, (): any => { const before: Array<number | string> = [1 as number];  const [x] = n; });
// prettier-ignore
check(20, 95, (): any => { const before: Array<number | string> = [1 as number];   const [x] = five; });
// prettier-ignore
check(21, 97, (): any => { const before: Array<number | string> = [1 as number]; const [x] = o; });
// prettier-ignore
check(22, 99, (): any => { const before: Array<number | string> = [1 as number];  const [x, y] = n; });
// prettier-ignore
check(23, 101, (): any => { const before: Array<number | string> = [1 as number];   const [[x]] = [n]; });
// prettier-ignore
check(24, 103, (): any => { const before: Array<number | string> = [1 as number]; const [{ x }] = [n]; });
// prettier-ignore
check(25, 105, (): any => { const before: Array<number | string> = [1 as number];  const [...r] = n; });
// prettier-ignore
check(26, 107, (): any => { const before: Array<number | string> = [1 as number];   const [] = n; });
// prettier-ignore
check(27, 109, (): any => { const before: Array<number | string> = [1 as number]; let x; ({ a: { x } } = o); });
// prettier-ignore
check(28, 111, (): any => { const before: Array<number | string> = [1 as number];  (({ x }) => x)(n); });
// prettier-ignore
check(29, 113, (): any => { const before: Array<number | string> = [1 as number];   (({ x }, y) => x)(n); });
// prettier-ignore
check(30, 115, (): any => { const before: Array<number | string> = [1 as number]; ((y, { x }) => x)(1, n); });
// prettier-ignore
check(31, 117, (): any => { const before: Array<number | string> = [1 as number];  (([x]) => x)(n); });
// prettier-ignore
check(32, 119, (): any => { const before: Array<number | string> = [1 as number];   (function ({ x }) { return x; })(n); });
// prettier-ignore
check(33, 121, (): any => { const before: Array<number | string> = [1 as number]; (function g([x]) { return x; })(n); });
// prettier-ignore
check(34, 123, (): any => { const before: Array<number | string> = [1 as number];  (({ x } = n) => x)(); });
// prettier-ignore
check(35, 125, (): any => { const before: Array<number | string> = [1 as number];   class A extends five {} });
// prettier-ignore
check(36, 127, (): any => { const before: Array<number | string> = [1 as number]; class A extends o.f {} });
// prettier-ignore
check(37, 129, (): any => { const before: Array<number | string> = [1 as number];  class A { #p; static h(x) { return #p in x; } } A.h(5); });
// prettier-ignore
check(38, 131, (): any => { const before: Array<number | string> = [1 as number];   (void 0).x; });
// prettier-ignore
check(39, 133, (): any => { const before: Array<number | string> = [1 as number]; (function ({ x }) { id(1); id(2); return x; })(n); });
// prettier-ignore
check(40, 135, (): any => { const before: Array<number | string> = [1 as number];  (({ x }) => { id(1); id(2); })(n); });
// prettier-ignore
check(41, 137, (): any => { const before: Array<number | string> = [1 as number];   function g({ x }) { id(1); } g(n); });
// prettier-ignore
check(42, 139, (): any => { const before: Array<number | string> = [1 as number]; function g({ x }) { } g(n); });
// prettier-ignore
check(43, 141, (): any => { const before: Array<number | string> = [1 as number];  function g({ x }) { o.s; } g(n); });
// prettier-ignore
check(44, 143, (): any => { const before: Array<number | string> = [1 as number];   function g({ x }) { return 1; } g(n); });
// prettier-ignore
check(45, 145, (): any => { const before: Array<number | string> = [1 as number]; function g({ x }) { let z = 1; z++; return z; } g(n); });
// prettier-ignore
check(46, 147, (): any => { const before: Array<number | string> = [1 as number];  function g(a, { x }) { return a; } g(1, n); });
// prettier-ignore
check(47, 149, (): any => { const before: Array<number | string> = [1 as number];   function g({ x }, { y }) { o.s; id(x); } g({}, n); });
// prettier-ignore
check(48, 151, (): any => { const before: Array<number | string> = [1 as number]; class A { m({ x }) { id(1); } } new A().m(n); });
// prettier-ignore
check(49, 153, (): any => { const before: Array<number | string> = [1 as number];  class A { constructor({ x }) { id(1); } } new A(n); });
// prettier-ignore
check(50, 155, (): any => { const before: Array<number | string> = [1 as number];   const q = { m({ x }) { id(1); } }; q.m(n); });
// prettier-ignore
check(51, 157, (): any => { const before: Array<number | string> = [1 as number]; function g({ x: { y } }) { id(1); } g({ x: n }); });
// prettier-ignore
check(52, 159, (): any => { const before: Array<number | string> = [1 as number];  function g({ x = id(2) }) { id(1); } g(n); });
// prettier-ignore
check(53, 161, (): any => { const before: Array<number | string> = [1 as number];   function g(a = id(1), { x }) { id(3); } g(1, n); });
// prettier-ignore
check(54, 163, (): any => { const before: Array<number | string> = [1 as number]; function g(a = id(1), { x }) { id(3); } g(undefined, n); });
// prettier-ignore
check(55, 165, (): any => { const before: Array<number | string> = [1 as number];  function g([x]) { id(1); } g(n); });
// prettier-ignore
check(56, 167, (): any => { const before: Array<number | string> = [1 as number];   function g(a, [x]) { id(1); } g(1, n); });
// prettier-ignore
check(57, 169, (): any => { const before: Array<number | string> = [1 as number]; function g(a = id(1), [x]) { id(1); } g(undefined, n); });
// prettier-ignore
check(58, 171, (): any => { const before: Array<number | string> = [1 as number];  function g({ ...r }) { id(1); } g(n); });
// prettier-ignore
check(59, 173, (): any => { const before: Array<number | string> = [1 as number];   function g({}) { id(1); } g(n); });
// prettier-ignore
check(60, 175, (): any => { const before: Array<number | string> = [1 as number]; function g({ [k]: x }) { id(1); } g(n); });
// prettier-ignore
check(61, 177, (): any => { const before: Array<number | string> = [1 as number];  function g({ [id(k)]: x }) { id(1); } g(n); });
// prettier-ignore
check(62, 179, (): any => { const before: Array<number | string> = [1 as number];   function g(...[{ x }]) { id(1); } g(n); });
// prettier-ignore
check(63, 181, (): any => { const before: Array<number | string> = [1 as number]; o[-five](); });
// prettier-ignore
check(64, 183, (): any => { const before: Array<number | string> = [1 as number];  o[!five](); });
// prettier-ignore
check(65, 185, (): any => { const before: Array<number | string> = [1 as number];   o[typeof five](); });
// prettier-ignore
check(66, 187, (): any => { const before: Array<number | string> = [1 as number]; o[void five](); });
// prettier-ignore
check(67, 189, (): any => { const before: Array<number | string> = [1 as number];  o[~five](); });
// prettier-ignore
check(68, 191, (): any => { const before: Array<number | string> = [1 as number];   o[+five](); });
// prettier-ignore
check(69, 193, (): any => { const before: Array<number | string> = [1 as number]; o[-1 + 2](); });
// prettier-ignore
check(70, 195, (): any => { const before: Array<number | string> = [1 as number];  o["a" + 1](); });
// prettier-ignore
check(71, 197, (): any => { const before: Array<number | string> = [1 as number];   o[1 + "a"](); });
// prettier-ignore
check(72, 199, (): any => { const before: Array<number | string> = [1 as number]; o[`a` + "b"](); });
// prettier-ignore
check(73, 201, (): any => { const before: Array<number | string> = [1 as number];  o["a" + `b`](); });
// prettier-ignore
check(74, 203, (): any => { const before: Array<number | string> = [1 as number];   o[`a${five}b`](); });
// prettier-ignore
check(75, 205, (): any => { const before: Array<number | string> = [1 as number]; o[`a${five}`](); });
// prettier-ignore
check(76, 207, (): any => { const before: Array<number | string> = [1 as number];  o[2 * 3](); });
// prettier-ignore
check(77, 209, (): any => { const before: Array<number | string> = [1 as number];   o[2 - 3](); });
// prettier-ignore
check(78, 211, (): any => { const before: Array<number | string> = [1 as number]; o[6 / 3](); });
// prettier-ignore
check(79, 213, (): any => { const before: Array<number | string> = [1 as number];  o[1 << 2](); });
// prettier-ignore
check(80, 215, (): any => { const before: Array<number | string> = [1 as number];   o[1 | 2](); });
// prettier-ignore
check(81, 217, (): any => { const before: Array<number | string> = [1 as number]; o[1 < 2](); });
// prettier-ignore
check(82, 219, (): any => { const before: Array<number | string> = [1 as number];  o[1 === 1](); });
// prettier-ignore
check(83, 221, (): any => { const before: Array<number | string> = [1 as number];   o["a" === "a"](); });
// prettier-ignore
check(84, 223, (): any => { const before: Array<number | string> = [1 as number]; o[true ? five : "b"](); });
// prettier-ignore
check(85, 225, (): any => { const before: Array<number | string> = [1 as number];  o[("a" + "b")](); });
// prettier-ignore
check(86, 227, (): any => { const before: Array<number | string> = [1 as number];   o[("a") + ("b")](); });
// prettier-ignore
check(87, 229, (): any => { const before: Array<number | string> = [1 as number]; o[five + "a" + "b"](); });
// prettier-ignore
check(88, 231, (): any => { const before: Array<number | string> = [1 as number];  o["a" + ("b" + "c")](); });
// prettier-ignore
check(89, 233, (): any => { const before: Array<number | string> = [1 as number];   o[!0 ? "a" : "b"](); });
// prettier-ignore
check(90, 235, (): any => { const before: Array<number | string> = [1 as number]; o[typeof 1 === "number" ? "a" : "b"](); });
// prettier-ignore
check(91, 237, (): any => { const before: Array<number | string> = [1 as number];  o[class {}](); });
// prettier-ignore
check(92, 239, (): any => { const before: Array<number | string> = [1 as number];   o[++o.f](); });
// prettier-ignore
check(93, 241, (): any => { const before: Array<number | string> = [1 as number]; o[o.f++](); });
// prettier-ignore
check(94, 243, (): any => { const before: Array<number | string> = [1 as number];  o[delete o.zz](); });
// prettier-ignore
check(95, 245, (): any => { const before: Array<number | string> = [1 as number];   (void five).x; });
// prettier-ignore
check(96, 247, (): any => { const before: Array<number | string> = [1 as number]; (void 0)(); });
// prettier-ignore
check(97, 249, (): any => { const before: Array<number | string> = [1 as number];  (void five)(); });
// prettier-ignore
check(98, 251, (): any => { const before: Array<number | string> = [1 as number];   (-five)(); });
// prettier-ignore
check(99, 253, (): any => { const before: Array<number | string> = [1 as number]; (!five)(); });
// prettier-ignore
check(100, 255, (): any => { const before: Array<number | string> = [1 as number];  (typeof five)(); });
// prettier-ignore
check(101, 257, (): any => { const before: Array<number | string> = [1 as number];   (1 + 1)(); });
// prettier-ignore
check(102, 259, (): any => { const before: Array<number | string> = [1 as number]; ("a" + "b")(); });
// prettier-ignore
check(103, 261, (): any => { const before: Array<number | string> = [1 as number];  (true ? 1 : 2)(); });
// prettier-ignore
check(104, 263, (): any => { const before: Array<number | string> = [1 as number];   `x${five}`(); });
// prettier-ignore
check(105, 265, (): any => { const before: Array<number | string> = [1 as number]; class A extends (five) {} });
// prettier-ignore
check(106, 267, (): any => { const before: Array<number | string> = [1 as number];  class A extends id(five) {} });
// prettier-ignore
check(107, 269, (): any => { const before: Array<number | string> = [1 as number];   class A extends o["f"] {} });
// prettier-ignore
check(108, 271, (): any => { const before: Array<number | string> = [1 as number]; class A extends (five ? five : 1) {} });
// prettier-ignore
check(109, 273, (): any => { const before: Array<number | string> = [1 as number];  class A extends (() => {}) {} });
// prettier-ignore
check(110, 275, (): any => { const before: Array<number | string> = [1 as number];   (class extends five {}); });
// prettier-ignore
check(111, 277, (): any => { const before: Array<number | string> = [1 as number]; const C = class extends five {}; });
// prettier-ignore
check(112, 279, (): any => { const before: Array<number | string> = [1 as number];  id(class A extends five {}); });
// prettier-ignore
check(113, 281, (): any => { const before: Array<number | string> = [1 as number];   class A extends Object.assign(function () {}, { prototype: 5 }) {} });
// prettier-ignore
check(114, 283, (): any => { const before: Array<number | string> = [1 as number]; class A { static h(x) { return #p in x; } #p; } A.h(n); });
// prettier-ignore
check(115, 285, (): any => { const before: Array<number | string> = [1 as number];  class A { #p; static h(x) { return #p in x.y; } } A.h({}); });
// prettier-ignore
check(116, 287, (): any => { const before: Array<number | string> = [1 as number];   class A { #p; static h(x) { return #p in id(x); } } A.h(5); });
// prettier-ignore
check(117, 289, (): any => { const before: Array<number | string> = [1 as number]; class A { #p; static h(x) { return (#p in x) && 1; } } A.h(5); });
// prettier-ignore
check(118, 291, (): any => { const before: Array<number | string> = [1 as number];  for (const [q] of [n]) ; });
// prettier-ignore
check(119, 293, (): any => { const before: Array<number | string> = [1 as number];   for (const [q, r] of [five]) ; });
// prettier-ignore
check(120, 295, (): any => { const before: Array<number | string> = [1 as number]; for (let [q] of [five]) ; });
// prettier-ignore
check(121, 297, (): any => { const before: Array<number | string> = [1 as number];  for (var [q] of [five]) ; });
// prettier-ignore
check(122, 299, (): any => { const before: Array<number | string> = [1 as number];   let q; for ({ q } of [n]) ; });
// prettier-ignore
check(123, 301, (): any => { const before: Array<number | string> = [1 as number]; for (const { q } of [u]) id(q); });
// prettier-ignore
check(124, 303, (): any => { const before: Array<number | string> = [1 as number];  for (const { q, r } of [n]) ; });
// prettier-ignore
check(125, 305, (): any => { const before: Array<number | string> = [1 as number];   for (const { q } of id([n])) ; });
// prettier-ignore
check(126, 307, (): any => { const before: Array<number | string> = [1 as number]; for (const { q } of o.arr.map(() => n)) ; });
// prettier-ignore
check(127, 309, (): any => { const before: Array<number | string> = [1 as number];  for (const { q = 1 } of [n]) ; });
// prettier-ignore
check(128, 311, (): any => { const before: Array<number | string> = [1 as number];   for (const { ...q } of [n]) ; });
// prettier-ignore
check(129, 313, (): any => { const before: Array<number | string> = [1 as number]; for (const {} of [n]) ; });
// prettier-ignore
check(130, 315, (): any => { const before: Array<number | string> = [1 as number];  for (const [{ q }] of [[n]]) ; });
// prettier-ignore
check(131, 317, (): any => { const before: Array<number | string> = [1 as number];   for (const { q: [r] } of [{ q: n }]) ; });
// prettier-ignore
check(132, 319, (): any => { const before: Array<number | string> = [1 as number]; const { a: { x } = n } = {}; });
// prettier-ignore
check(133, 321, (): any => { const before: Array<number | string> = [1 as number];  const { a: { x } = n } = o; });
// prettier-ignore
check(134, 323, (): any => { const before: Array<number | string> = [1 as number];   const { a: { x } } = id(o); });
// prettier-ignore
check(135, 325, (): any => { const before: Array<number | string> = [1 as number]; const { a: { x } } = o.nested.deep ?? o; });
// prettier-ignore
check(136, 327, (): any => { const before: Array<number | string> = [1 as number];  const { s, a: { x } } = o; });
// prettier-ignore
check(137, 329, (): any => { const before: Array<number | string> = [1 as number];   const { [k]: { x } } = o; });
// prettier-ignore
check(138, 331, (): any => { const before: Array<number | string> = [1 as number]; const { [id("a")]: { x } } = o; });
// prettier-ignore
check(139, 333, (): any => { const before: Array<number | string> = [1 as number];  const { a: { x }, ...r } = o; });
// prettier-ignore
check(140, 335, (): any => { const before: Array<number | string> = [1 as number];   const { nested: { deep: [x] } } = o; });
// prettier-ignore
check(141, 337, (): any => { const before: Array<number | string> = [1 as number]; const { arr: [{ x }] } = { arr: [n] }; });
// prettier-ignore
check(142, 339, (): any => { const before: Array<number | string> = [1 as number];  const { arr: [[x]] } = { arr: [n] }; });
// prettier-ignore
check(143, 341, (): any => { const before: Array<number | string> = [1 as number];   const [x, { y }] = [1, n]; });
// prettier-ignore
check(144, 343, (): any => { const before: Array<number | string> = [1 as number]; const [x, [y]] = [1, n]; });
// prettier-ignore
check(145, 345, (): any => { const before: Array<number | string> = [1 as number];  const [{ x } = n] = []; });
// prettier-ignore
check(146, 347, (): any => { const before: Array<number | string> = [1 as number];   const [[x] = n] = []; });
// prettier-ignore
check(147, 349, (): any => { const before: Array<number | string> = [1 as number]; const [, [x]] = [1, n]; });
// prettier-ignore
check(148, 351, (): any => { const before: Array<number | string> = [1 as number];  const [...[x]] = n; });
// prettier-ignore
check(149, 353, (): any => { const before: Array<number | string> = [1 as number];   const [...{ length }] = n; });
// prettier-ignore
check(150, 355, (): any => { const before: Array<number | string> = [1 as number]; const a1 = id(1), [x] = n; });
// prettier-ignore
check(151, 357, (): any => { const before: Array<number | string> = [1 as number];  const a1 = id(1), { a: { x } } = o; });
// prettier-ignore
check(152, 359, (): any => { const before: Array<number | string> = [1 as number];   let [x] = n; });
// prettier-ignore
check(153, 361, (): any => { const before: Array<number | string> = [1 as number]; var [x] = n; });
// prettier-ignore
check(154, 363, (): any => { const before: Array<number | string> = [1 as number];  let x; [{ x }] = [n]; });
// prettier-ignore
check(155, 365, (): any => { const before: Array<number | string> = [1 as number];   let x; ({ a: { x } } = id(o)); });
// prettier-ignore
check(156, 367, (): any => { const before: Array<number | string> = [1 as number]; export_: { const [x] = n; } });
// prettier-ignore
check(157, 369, (): any => { const before: Array<number | string> = [1 as number];  try { const [x] = n; } finally { } });
// prettier-ignore
check(158, 371, (): any => { const before: Array<number | string> = [1 as number];   if (five) { const [x] = n; } });
// prettier-ignore
check(159, 373, (): any => { const before: Array<number | string> = [1 as number]; ({ ...o, a: 1 }); });
// prettier-ignore
check(160, 375, (): any => { const before: Array<number | string> = [1 as number];  ({ ...id(o) }); });
// prettier-ignore
check(161, 377, (): any => { const before: Array<number | string> = [1 as number];   id({ ...o }); });
// prettier-ignore
check(162, 379, (): any => { const before: Array<number | string> = [1 as number]; const z = { ...o }; });
// prettier-ignore
check(163, 381, (): any => { const before: Array<number | string> = [1 as number];  [{ ...o }]; });
// prettier-ignore
check(164, 383, (): any => { const before: Array<number | string> = [1 as number];   ({ a: { ...o } }); });
// prettier-ignore
check(165, 385, (): any => { const before: Array<number | string> = [1 as number]; ({ ...{ ...o } }); });
// prettier-ignore
check(166, 387, (): any => { const before: Array<number | string> = [1 as number];  (five) + sym; });
// prettier-ignore
check(167, 389, (): any => { const before: Array<number | string> = [1 as number];   (sym) + five; });
// prettier-ignore
check(168, 391, (): any => { const before: Array<number | string> = [1 as number]; ({ valueOf: fail }) + 1; });
// prettier-ignore
check(169, 393, (): any => { const before: Array<number | string> = [1 as number];  ({ valueOf: fail }) - 1; });
// prettier-ignore
check(170, 395, (): any => { const before: Array<number | string> = [1 as number];   ({ valueOf: fail }) != 1; });
// prettier-ignore
check(171, 397, (): any => { const before: Array<number | string> = [1 as number]; ({ valueOf: fail }) > 1; });
// prettier-ignore
check(172, 399, (): any => { const before: Array<number | string> = [1 as number];  ({ valueOf: fail }) & 1; });
// prettier-ignore
check(173, 401, (): any => { const before: Array<number | string> = [1 as number];   ({ valueOf: fail }) ** 1; });
// prettier-ignore
check(174, 403, (): any => { const before: Array<number | string> = [1 as number]; ({ valueOf: fail }) % 1; });
// prettier-ignore
check(175, 405, (): any => { const before: Array<number | string> = [1 as number];  function* g() { try { yield 1; } finally { fail(); } } const [q] = g(); });
// prettier-ignore
check(176, 407, (): any => { const before: Array<number | string> = [1 as number];   o["" + "m"](); });
// prettier-ignore
check(177, 409, (): any => { const before: Array<number | string> = [1 as number]; ({ ...o }); });
// prettier-ignore
check(178, 411, (): any => { const before: Array<number | string> = [1 as number];  ({ toString: fail }) + ""; });
// prettier-ignore
check(179, 413, (): any => { const before: Array<number | string> = [1 as number];   ({ valueOf: fail }) < 1; });
// prettier-ignore
check(180, 415, (): any => { const before: Array<number | string> = [1 as number]; ({ [Symbol.toPrimitive]: fail }) * 1; });
// prettier-ignore
check(181, 417, (): any => { const before: Array<number | string> = [1 as number];  const [x] = { [Symbol.iterator]: fail }; });
// prettier-ignore
check(182, 419, (): any => { const before: Array<number | string> = [1 as number];   const [x] = { [Symbol.iterator]() { return { next: fail }; } }; });
// prettier-ignore
check(183, 421, (): any => { const before: Array<number | string> = [1 as number]; const [x] = { [Symbol.iterator]() { return { next() { return { done: false }; }, return: fail }; } }; });

// GENERATED: fail F h C next
// CHECK-LABEL: function {{*}}name="fail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Error" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="fail"
// CHECK-NEXT: v5 = Construct v3, -, v4 calleeName="Error"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: Throw v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="F"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasThis, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="F"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: classtoken, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PrivateHas v1, v0 layout=[[L_3]] field=1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: classtoken, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PrivateHas v1, v0 layout=[[L_7]] field=1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_8]] flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: classtoken, v1: undefined|null|[[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="y"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v4 = PrivateHas v3, v0 layout=[[L_10]] field=1
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v3 = Call v2, -, v1 calleeName="id"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v5 = PrivateHas v4, v0 layout=[[L_13]] field=1
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=false|1 flags=[IsExpected]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: classtoken, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PrivateHas v1, v0 layout=[[L_15]] field=1
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b5(v7):
// CHECK-NEXT: v8 = Convert v7 declared={type=false|1 flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_16]] flags=[IsExpected]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_18]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_16]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
