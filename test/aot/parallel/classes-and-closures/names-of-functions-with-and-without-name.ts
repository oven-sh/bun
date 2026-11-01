// The name of a function is read out of a table that lists only the functions that have one: named and anonymous functions in turn, more than fill one group of the table, each read twice.
const functions: Function[] = [];
function named0() {}
function named1() {}
functions.push(named0, () => 0, named1, function () {}, class {}, class Named2 {}, async () => {}, async function named3() {}, function* () {}, function* named4() {});
for (let index = 0; index < 3; index++) {
  functions.push(
    () => index, function a() {}, () => index + 1, () => index + 2, function b() {}, function c() {}, () => index + 3, () => index + 4, () => index + 5, function d() {},
    () => index + 6, () => index + 7, () => index + 8, () => index + 9, function e() {}, () => index + 10, function f() {}, () => index + 11, () => index + 12, () => index + 13,
    function g() {}, function h() {}, function i() {}, () => index + 14, () => index + 15, () => index + 16, () => index + 17, () => index + 18, function j() {}, () => index + 19,
    () => index + 20, function k() {}, () => index + 21, () => index + 22, function l() {}, () => index + 23, () => index + 24, function m() {}, () => index + 25, function n() {},
  );
}
const holder = { method() {}, arrow: () => {}, get accessor() { return 1; }, ["computed" + 1]() {}, [Symbol.iterator]() {}, async *generator() {} };
functions.push(holder.method, holder.arrow, Object.getOwnPropertyDescriptor(holder, "accessor")!.get!, (holder as unknown as { computed1: Function }).computed1, holder[Symbol.iterator], holder.generator, named0.bind(null), (() => {}).bind(null));
const assigned = () => {};
let later;
later = function () {};
functions.push(assigned, later);
console.log(JSON.stringify(functions.map(each => each.name)));
console.log(JSON.stringify(functions.map(each => each.name)));
console.log(JSON.stringify(functions.map(each => each.length)));
console.log(functions.map(each => Object.getOwnPropertyNames(each).includes("name")).filter(has => !has).length);
