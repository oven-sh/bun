// Prints the line and column of each stack frame for errors thrown after interfaces and type aliases that take several lines.
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
check(0, 55, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
o[
"no" +
"pe"](
1);
});
// prettier-ignore
check(1, 68, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 o[
void 0](
);
});
// prettier-ignore
check(2, 80, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  o
.nested[
"de" +
"ep"](
);
});
// prettier-ignore
check(3, 94, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
id(
o)[
"no" +
"pe"](
);
});
// prettier-ignore
check(4, 108, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 for (
const [
q] of
[
five]) ;
});
// prettier-ignore
check(5, 122, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  const {
a: {
x } } =
o;
});
// prettier-ignore
check(6, 135, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
const {
a: [
x] } =
o;
});
// prettier-ignore
check(7, 148, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 const [
x] =
o;
});
// prettier-ignore
check(8, 160, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  const [
{
x }] =
[
n];
});
// prettier-ignore
check(9, 174, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
let x; (
{
a: {
x } } =
o);
});
// prettier-ignore
check(10, 188, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 (
(
y,
{
x }) => x)(
1,
n);
});
// prettier-ignore
check(11, 204, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  (
function g(
[
x]) {
return x; })(
n);
});
// prettier-ignore
check(12, 219, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
class A extends
o
.f {}
});
// prettier-ignore
check(13, 231, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
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
check(14, 248, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  function g(
{
x }) {
} g(
n);
});
// prettier-ignore
check(15, 262, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
function g(
{
x }) {
let z =
1; z++; return z; } g(
n);
});
// prettier-ignore
check(16, 277, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
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
check(17, 296, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
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
check(18, 313, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
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
check(19, 332, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
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
check(20, 351, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  function g(
{
[
k]: x }) {
id(
1); } g(
n);
});
// prettier-ignore
check(21, 367, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
o[
-five](
);
});
// prettier-ignore
check(22, 379, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 o[
void five](
);
});
// prettier-ignore
check(23, 391, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  o[
-1 +
2](
);
});
// prettier-ignore
check(24, 404, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
o[
`a` +
"b"](
);
});
// prettier-ignore
check(25, 417, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 o[
`a${five}`](
);
});
// prettier-ignore
check(26, 429, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  o[
6 / 3](
);
});
// prettier-ignore
check(27, 441, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
o[
1 < 2](
);
});
// prettier-ignore
check(28, 453, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 o[
true ? five : "b"](
);
});
// prettier-ignore
check(29, 465, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  o[
five +
"a" +
"b"](
);
});
// prettier-ignore
check(30, 479, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
o[
typeof 1 === "number" ? "a" : "b"](
);
});
// prettier-ignore
check(31, 491, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 o[
o
.f++](
);
});
// prettier-ignore
check(32, 504, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  (
void 0)(
);
});
// prettier-ignore
check(33, 516, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
(
!five)(
);
});
// prettier-ignore
check(34, 528, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 (
"a" +
"b")(
);
});
// prettier-ignore
check(35, 541, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  class A extends
(
five) {}
});
// prettier-ignore
check(36, 553, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
class A extends
(
five ? five : 1) {}
});
// prettier-ignore
check(37, 565, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 const C =
class extends
five {};
});
// prettier-ignore
check(38, 577, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  class A {
static h(
x) {
return #p in
x; } #p; } A
.h(
n);
});
// prettier-ignore
check(39, 593, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
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
check(40, 610, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 for (
let [
q] of
[
five]) ;
});
// prettier-ignore
check(41, 624, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  for (
const {
q } of
[
u]) id(
q);
});
// prettier-ignore
check(42, 639, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
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
check(43, 656, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 for (
const {} of
[
n]) ;
});
// prettier-ignore
check(44, 669, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  const {
a: {
x } =
n } =
{};
});
// prettier-ignore
check(45, 683, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
const {
a: {
x } } =
o
.nested
.deep ?? o;
});
// prettier-ignore
check(46, 698, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 const {
[
id(
"a")]: {
x } } =
o;
});
// prettier-ignore
check(47, 713, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  const {
arr: [
{
x }] } =
{
arr: [
n] };
});
// prettier-ignore
check(48, 729, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
const [
x,
[
y]] =
[
1,
n];
});
// prettier-ignore
check(49, 745, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 const [
,
[
x]] =
[
1,
n];
});
// prettier-ignore
check(50, 761, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  const a1 =
id(
1),
[
x] =
n;
});
// prettier-ignore
check(51, 776, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
var [
x] =
n;
});
// prettier-ignore
check(52, 788, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 export_: {
const [
x] =
n; }
});
// prettier-ignore
check(53, 801, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  (
{
...o,
a: 1 });
});
// prettier-ignore
check(54, 814, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
const z =
{
...o };
});
// prettier-ignore
check(55, 826, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 (
{
...{
...o } });
});
// prettier-ignore
check(56, 839, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  (
{
valueOf: fail }) +
1;
});
// prettier-ignore
check(57, 852, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
(
{
valueOf: fail }) > 1;
});
// prettier-ignore
check(58, 864, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 (
{
valueOf: fail }) % 1;
});
// prettier-ignore
check(59, 876, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  o[
"" +
"m"](
);
});
// prettier-ignore
check(60, 889, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
(
{
...o });
});
// prettier-ignore
check(61, 901, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 (
{
toString: fail }) +
"";
});
// prettier-ignore
check(62, 914, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
  (
{
valueOf: fail }) < 1;
});
// prettier-ignore
check(63, 926, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
(
{
[
Symbol
.toPrimitive]: fail }) * 1;
});
// prettier-ignore
check(64, 940, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
 const [
x] =
{
[
Symbol
.iterator]: fail };
});
// prettier-ignore
check(65, 955, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
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
check(66, 973, (): any => {
interface Before {
  a: number;
}
type Other =
  | 1
  | 2;
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
