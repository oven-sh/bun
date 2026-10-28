// Prints the line and column of each stack frame for errors thrown by expressions that are written over several lines.
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
check(0, 54, () => {
o[
"no" +
"pe"](
1);
});
// prettier-ignore
check(1, 61, () => {
 o[
"no" +
"pe" +
""](
1);
});
// prettier-ignore
check(2, 69, () => {
  o[
1 +
1](
);
});
// prettier-ignore
check(3, 76, () => {
o[
void 0](
);
});
// prettier-ignore
check(4, 82, () => {
 o[
true ? "a" : "b"](
);
});
// prettier-ignore
check(5, 88, () => {
  o
?.[
"no" +
"pe"](
);
});
// prettier-ignore
check(6, 96, () => {
o
.nested[
"de" +
"ep"](
);
});
// prettier-ignore
check(7, 104, () => {
 o
.nested[
"de" +
"ep"]
.x;
});
// prettier-ignore
check(8, 112, () => {
  o
.nested[
"de" +
"ep"][
"x" +
"y"];
});
// prettier-ignore
check(9, 121, () => {
id(
o)[
"no" +
"pe"](
);
});
// prettier-ignore
check(10, 129, () => {
 o[
"no" +
"pe"]`x`;
});
// prettier-ignore
check(11, 135, () => {
  o[
"no" +
"pe"](
...[
1]);
});
// prettier-ignore
check(12, 143, () => {
for (
const [
q] of
[
five]) ;
});
// prettier-ignore
check(13, 151, () => {
 for (
const {
q } of
[
n]) ;
});
// prettier-ignore
check(14, 159, () => {
  for (
const {
q: {
r } } of
[
{
q: n }]) ;
});
// prettier-ignore
check(15, 169, () => {
const {
a: {
x } } =
o;
});
// prettier-ignore
check(16, 176, () => {
 const {
a: {
x },
b } =
o;
});
// prettier-ignore
check(17, 184, () => {
  const {
nested: {
deep: {
x } } } =
o;
});
// prettier-ignore
check(18, 192, () => {
const {
a: [
x] } =
o;
});
// prettier-ignore
check(19, 199, () => {
 const [
x] =
n;
});
// prettier-ignore
check(20, 205, () => {
  const [
x] =
five;
});
// prettier-ignore
check(21, 211, () => {
const [
x] =
o;
});
// prettier-ignore
check(22, 217, () => {
 const [
x,
y] =
n;
});
// prettier-ignore
check(23, 224, () => {
  const [
[
x]] =
[
n];
});
// prettier-ignore
check(24, 232, () => {
const [
{
x }] =
[
n];
});
// prettier-ignore
check(25, 240, () => {
 const [
...r] =
n;
});
// prettier-ignore
check(26, 246, () => {
  const [
] =
n;
});
// prettier-ignore
check(27, 252, () => {
let x; (
{
a: {
x } } =
o);
});
// prettier-ignore
check(28, 260, () => {
 (
(
{
x }) => x)(
n);
});
// prettier-ignore
check(29, 268, () => {
  (
(
{
x },
y) => x)(
n);
});
// prettier-ignore
check(30, 277, () => {
(
(
y,
{
x }) => x)(
1,
n);
});
// prettier-ignore
check(31, 287, () => {
 (
(
[
x]) => x)(
n);
});
// prettier-ignore
check(32, 295, () => {
  (
function (
{
x }) {
return x; })(
n);
});
// prettier-ignore
check(33, 304, () => {
(
function g(
[
x]) {
return x; })(
n);
});
// prettier-ignore
check(34, 313, () => {
 (
(
{
x } =
n) => x)(
);
});
// prettier-ignore
check(35, 322, () => {
  class A extends
five {}
});
// prettier-ignore
check(36, 327, () => {
class A extends
o
.f {}
});
// prettier-ignore
check(37, 333, () => {
 class A {
#p; static h(
x) {
return #p in
x; } } A
.h(
5);
});
// prettier-ignore
check(38, 343, () => {
  (
void 0)
.x;
});
// prettier-ignore
check(39, 349, () => {
(
function (
{
x }) {
id(
1); id(
2); return x; })(
n);
});
// prettier-ignore
check(40, 360, () => {
 (
(
{
x }) => {
id(
1); id(
2); })(
n);
});
// prettier-ignore
check(41, 371, () => {
  function g(
{
x }) {
id(
1); } g(
n);
});
// prettier-ignore
check(42, 380, () => {
function g(
{
x }) {
} g(
n);
});
// prettier-ignore
check(43, 388, () => {
 function g(
{
x }) {
o
.s; } g(
n);
});
// prettier-ignore
check(44, 397, () => {
  function g(
{
x }) {
return 1; } g(
n);
});
// prettier-ignore
check(45, 405, () => {
function g(
{
x }) {
let z =
1; z++; return z; } g(
n);
});
// prettier-ignore
check(46, 414, () => {
 function g(
a,
{
x }) {
return a; } g(
1,
n);
});
// prettier-ignore
check(47, 424, () => {
  function g(
{
x },
{
y }) {
o
.s; id(
x); } g(
{},
n);
});
// prettier-ignore
check(48, 437, () => {
class A {
m(
{
x }) {
id(
1); } } new
A(
)
.m(
n);
});
// prettier-ignore
check(49, 450, () => {
 class A {
constructor(
{
x }) {
id(
1); } } new
A(
n);
});
// prettier-ignore
check(50, 461, () => {
  const q =
{
m(
{
x }) {
id(
1); } }; q
.m(
n);
});
// prettier-ignore
check(51, 473, () => {
function g(
{
x: {
y } }) {
id(
1); } g(
{
x: n });
});
// prettier-ignore
check(52, 484, () => {
 function g(
{
x =
id(
2) }) {
id(
1); } g(
n);
});
// prettier-ignore
check(53, 495, () => {
  function g(
a =
id(
1),
{
x }) {
id(
3); } g(
1,
n);
});
// prettier-ignore
check(54, 508, () => {
function g(
a =
id(
1),
{
x }) {
id(
3); } g(
undefined,
n);
});
// prettier-ignore
check(55, 521, () => {
 function g(
[
x]) {
id(
1); } g(
n);
});
// prettier-ignore
check(56, 530, () => {
  function g(
a,
[
x]) {
id(
1); } g(
1,
n);
});
// prettier-ignore
check(57, 541, () => {
function g(
a =
id(
1),
[
x]) {
id(
1); } g(
undefined,
n);
});
// prettier-ignore
check(58, 554, () => {
 function g(
{
...r }) {
id(
1); } g(
n);
});
// prettier-ignore
check(59, 563, () => {
  function g(
{}) {
id(
1); } g(
n);
});
// prettier-ignore
check(60, 571, () => {
function g(
{
[
k]: x }) {
id(
1); } g(
n);
});
// prettier-ignore
check(61, 581, () => {
 function g(
{
[
id(
k)]: x }) {
id(
1); } g(
n);
});
// prettier-ignore
check(62, 592, () => {
  function g(
...[
{
x }]) {
id(
1); } g(
n);
});
// prettier-ignore
check(63, 602, () => {
o[
-five](
);
});
// prettier-ignore
check(64, 608, () => {
 o[
!five](
);
});
// prettier-ignore
check(65, 614, () => {
  o[
typeof five](
);
});
// prettier-ignore
check(66, 620, () => {
o[
void five](
);
});
// prettier-ignore
check(67, 626, () => {
 o[
~five](
);
});
// prettier-ignore
check(68, 632, () => {
  o[
+five](
);
});
// prettier-ignore
check(69, 638, () => {
o[
-1 +
2](
);
});
// prettier-ignore
check(70, 645, () => {
 o[
"a" +
1](
);
});
// prettier-ignore
check(71, 652, () => {
  o[
1 +
"a"](
);
});
// prettier-ignore
check(72, 659, () => {
o[
`a` +
"b"](
);
});
// prettier-ignore
check(73, 666, () => {
 o[
"a" +
`b`](
);
});
// prettier-ignore
check(74, 673, () => {
  o[
`a${five}b`](
);
});
// prettier-ignore
check(75, 679, () => {
o[
`a${five}`](
);
});
// prettier-ignore
check(76, 685, () => {
 o[
2 * 3](
);
});
// prettier-ignore
check(77, 691, () => {
  o[
2 - 3](
);
});
// prettier-ignore
check(78, 697, () => {
o[
6 / 3](
);
});
// prettier-ignore
check(79, 703, () => {
 o[
1 << 2](
);
});
// prettier-ignore
check(80, 709, () => {
  o[
1 | 2](
);
});
// prettier-ignore
check(81, 715, () => {
o[
1 < 2](
);
});
// prettier-ignore
check(82, 721, () => {
 o[
1 === 1](
);
});
// prettier-ignore
check(83, 727, () => {
  o[
"a" === "a"](
);
});
// prettier-ignore
check(84, 733, () => {
o[
true ? five : "b"](
);
});
// prettier-ignore
check(85, 739, () => {
 o[
(
"a" +
"b")](
);
});
// prettier-ignore
check(86, 747, () => {
  o[
(
"a") +
(
"b")](
);
});
// prettier-ignore
check(87, 756, () => {
o[
five +
"a" +
"b"](
);
});
// prettier-ignore
check(88, 764, () => {
 o[
"a" +
(
"b" +
"c")](
);
});
// prettier-ignore
check(89, 773, () => {
  o[
!0 ? "a" : "b"](
);
});
// prettier-ignore
check(90, 779, () => {
o[
typeof 1 === "number" ? "a" : "b"](
);
});
// prettier-ignore
check(91, 785, () => {
 o[
class {}](
);
});
// prettier-ignore
check(92, 791, () => {
  o[
++o
.f](
);
});
// prettier-ignore
check(93, 798, () => {
o[
o
.f++](
);
});
// prettier-ignore
check(94, 805, () => {
 o[
delete o
.zz](
);
});
// prettier-ignore
check(95, 812, () => {
  (
void five)
.x;
});
// prettier-ignore
check(96, 818, () => {
(
void 0)(
);
});
// prettier-ignore
check(97, 824, () => {
 (
void five)(
);
});
// prettier-ignore
check(98, 830, () => {
  (
-five)(
);
});
// prettier-ignore
check(99, 836, () => {
(
!five)(
);
});
// prettier-ignore
check(100, 842, () => {
 (
typeof five)(
);
});
// prettier-ignore
check(101, 848, () => {
  (
1 +
1)(
);
});
// prettier-ignore
check(102, 855, () => {
(
"a" +
"b")(
);
});
// prettier-ignore
check(103, 862, () => {
 (
true ? 1 : 2)(
);
});
// prettier-ignore
check(104, 868, () => {
  `x${five}`(
);
});
// prettier-ignore
check(105, 873, () => {
class A extends
(
five) {}
});
// prettier-ignore
check(106, 879, () => {
 class A extends
id(
five) {}
});
// prettier-ignore
check(107, 885, () => {
  class A extends
o[
"f"] {}
});
// prettier-ignore
check(108, 891, () => {
class A extends
(
five ? five : 1) {}
});
// prettier-ignore
check(109, 897, () => {
 class A extends
(
(
) => {}) {}
});
// prettier-ignore
check(110, 904, () => {
  (
class extends
five {});
});
// prettier-ignore
check(111, 910, () => {
const C =
class extends
five {};
});
// prettier-ignore
check(112, 916, () => {
 id(
class A extends
five {});
});
// prettier-ignore
check(113, 922, () => {
  class A extends
Object
.assign(
function (
) {},
{
prototype: 5 }) {}
});
// prettier-ignore
check(114, 932, () => {
class A {
static h(
x) {
return #p in
x; } #p; } A
.h(
n);
});
// prettier-ignore
check(115, 942, () => {
 class A {
#p; static h(
x) {
return #p in
x
.y; } } A
.h(
{});
});
// prettier-ignore
check(116, 953, () => {
  class A {
#p; static h(
x) {
return #p in
id(
x); } } A
.h(
5);
});
// prettier-ignore
check(117, 964, () => {
class A {
#p; static h(
x) {
return (
#p in
x) && 1; } } A
.h(
5);
});
// prettier-ignore
check(118, 975, () => {
 for (
const [
q] of
[
n]) ;
});
// prettier-ignore
check(119, 983, () => {
  for (
const [
q,
r] of
[
five]) ;
});
// prettier-ignore
check(120, 992, () => {
for (
let [
q] of
[
five]) ;
});
// prettier-ignore
check(121, 1000, () => {
 for (
var [
q] of
[
five]) ;
});
// prettier-ignore
check(122, 1008, () => {
  let q; for (
{
q } of
[
n]) ;
});
// prettier-ignore
check(123, 1016, () => {
for (
const {
q } of
[
u]) id(
q);
});
// prettier-ignore
check(124, 1025, () => {
 for (
const {
q,
r } of
[
n]) ;
});
// prettier-ignore
check(125, 1034, () => {
  for (
const {
q } of
id(
[
n])) ;
});
// prettier-ignore
check(126, 1043, () => {
for (
const {
q } of
o
.arr
.map(
(
) => n)) ;
});
// prettier-ignore
check(127, 1054, () => {
 for (
const {
q =
1 } of
[
n]) ;
});
// prettier-ignore
check(128, 1063, () => {
  for (
const {
...q } of
[
n]) ;
});
// prettier-ignore
check(129, 1071, () => {
for (
const {} of
[
n]) ;
});
// prettier-ignore
check(130, 1078, () => {
 for (
const [
{
q }] of
[
[
n]]) ;
});
// prettier-ignore
check(131, 1088, () => {
  for (
const {
q: [
r] } of
[
{
q: n }]) ;
});
// prettier-ignore
check(132, 1098, () => {
const {
a: {
x } =
n } =
{};
});
// prettier-ignore
check(133, 1106, () => {
 const {
a: {
x } =
n } =
o;
});
// prettier-ignore
check(134, 1114, () => {
  const {
a: {
x } } =
id(
o);
});
// prettier-ignore
check(135, 1122, () => {
const {
a: {
x } } =
o
.nested
.deep ?? o;
});
// prettier-ignore
check(136, 1131, () => {
 const {
s,
a: {
x } } =
o;
});
// prettier-ignore
check(137, 1139, () => {
  const {
[
k]: {
x } } =
o;
});
// prettier-ignore
check(138, 1147, () => {
const {
[
id(
"a")]: {
x } } =
o;
});
// prettier-ignore
check(139, 1156, () => {
 const {
a: {
x },
...r } =
o;
});
// prettier-ignore
check(140, 1164, () => {
  const {
nested: {
deep: [
x] } } =
o;
});
// prettier-ignore
check(141, 1172, () => {
const {
arr: [
{
x }] } =
{
arr: [
n] };
});
// prettier-ignore
check(142, 1182, () => {
 const {
arr: [
[
x]] } =
{
arr: [
n] };
});
// prettier-ignore
check(143, 1192, () => {
  const [
x,
{
y }] =
[
1,
n];
});
// prettier-ignore
check(144, 1202, () => {
const [
x,
[
y]] =
[
1,
n];
});
// prettier-ignore
check(145, 1212, () => {
 const [
{
x } =
n] =
[
];
});
// prettier-ignore
check(146, 1221, () => {
  const [
[
x] =
n] =
[
];
});
// prettier-ignore
check(147, 1230, () => {
const [
,
[
x]] =
[
1,
n];
});
// prettier-ignore
check(148, 1240, () => {
 const [
...[
x]] =
n;
});
// prettier-ignore
check(149, 1247, () => {
  const [
...{
length }] =
n;
});
// prettier-ignore
check(150, 1254, () => {
const a1 =
id(
1),
[
x] =
n;
});
// prettier-ignore
check(151, 1263, () => {
 const a1 =
id(
1),
{
a: {
x } } =
o;
});
// prettier-ignore
check(152, 1273, () => {
  let [
x] =
n;
});
// prettier-ignore
check(153, 1279, () => {
var [
x] =
n;
});
// prettier-ignore
check(154, 1285, () => {
 let x; [
{
x }] =
[
n];
});
// prettier-ignore
check(155, 1293, () => {
  let x; (
{
a: {
x } } =
id(
o));
});
// prettier-ignore
check(156, 1302, () => {
export_: {
const [
x] =
n; }
});
// prettier-ignore
check(157, 1309, () => {
 try {
const [
x] =
n; } finally {
}
});
// prettier-ignore
check(158, 1317, () => {
  if (
five) {
const [
x] =
n; }
});
// prettier-ignore
check(159, 1325, () => {
(
{
...o,
a: 1 });
});
// prettier-ignore
check(160, 1332, () => {
 (
{
...id(
o) });
});
// prettier-ignore
check(161, 1339, () => {
  id(
{
...o });
});
// prettier-ignore
check(162, 1345, () => {
const z =
{
...o };
});
// prettier-ignore
check(163, 1351, () => {
 [
{
...o }];
});
// prettier-ignore
check(164, 1357, () => {
  (
{
a: {
...o } });
});
// prettier-ignore
check(165, 1364, () => {
(
{
...{
...o } });
});
// prettier-ignore
check(166, 1371, () => {
 (
five) +
sym;
});
// prettier-ignore
check(167, 1377, () => {
  (
sym) +
five;
});
// prettier-ignore
check(168, 1383, () => {
(
{
valueOf: fail }) +
1;
});
// prettier-ignore
check(169, 1390, () => {
 (
{
valueOf: fail }) - 1;
});
// prettier-ignore
check(170, 1396, () => {
  (
{
valueOf: fail }) != 1;
});
// prettier-ignore
check(171, 1402, () => {
(
{
valueOf: fail }) > 1;
});
// prettier-ignore
check(172, 1408, () => {
 (
{
valueOf: fail }) & 1;
});
// prettier-ignore
check(173, 1414, () => {
  (
{
valueOf: fail }) ** 1;
});
// prettier-ignore
check(174, 1420, () => {
(
{
valueOf: fail }) % 1;
});
// prettier-ignore
check(175, 1426, () => {
 function* g(
) {
try {
yield 1; } finally {
fail(
); } } const [
q] =
g(
);
});
// prettier-ignore
check(176, 1438, () => {
  o[
"" +
"m"](
);
});
// prettier-ignore
check(177, 1445, () => {
(
{
...o });
});
// prettier-ignore
check(178, 1451, () => {
 (
{
toString: fail }) +
"";
});
// prettier-ignore
check(179, 1458, () => {
  (
{
valueOf: fail }) < 1;
});
// prettier-ignore
check(180, 1464, () => {
(
{
[
Symbol
.toPrimitive]: fail }) * 1;
});
// prettier-ignore
check(181, 1472, () => {
 const [
x] =
{
[
Symbol
.iterator]: fail };
});
// prettier-ignore
check(182, 1481, () => {
  const [
x] =
{
[
Symbol
.iterator](
) {
return {
next: fail }; } };
});
// prettier-ignore
check(183, 1493, () => {
const [
x] =
{
[
Symbol
.iterator](
) {
return {
next(
) {
return {
done: false }; },
return: fail }; } };
});
