// What stands one, two and three steps above objects of the host and the library, read at once, through a field, a list, a variable and a parameter, in one function and across functions.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
"use strict";
const labels = new Map([
  [Function.prototype, "Function.prototype"],
  [Object.prototype, "Object.prototype"],
  [Array.prototype, "Array.prototype"],
  [Error.prototype, "Error.prototype"],
  [Object.getPrototypeOf(async function () {}), "AsyncFunction.prototype"],
  [Object.getPrototypeOf(function* () {}), "GeneratorFunction.prototype"],
  [Object.getPrototypeOf(async function* () {}), "AsyncGeneratorFunction.prototype"],
  [Object.getPrototypeOf(Uint8Array), "TypedArray"],
  [Object.getPrototypeOf(Uint8Array.prototype), "TypedArray.prototype"],
]);
function label(x) {
  return x === null ? "null" : (labels.get(x) ?? typeof x);
}
function say(name, run) {
  let text;
  try {
    text = run();
  } catch (error) {
    text = "THROWS " + error.name;
  }
  console.log(name, text);
}
say("(Bun.sql) 1", function () {
  const direct = Object.getPrototypeOf(Bun.sql);
  const kept = { above: Object.getPrototypeOf(Bun.sql) };
  const list = [Object.getPrototypeOf(Bun.sql)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make0_1() {
  return { above: Object.getPrototypeOf(Bun.sql) };
}
function list0_1() {
  return [Object.getPrototypeOf(Bun.sql)];
}
function ask0_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held0_1;
function hold0_1() {
  held0_1 = Object.getPrototypeOf(Bun.sql);
}
say("(Bun.sql) 1 far", function () {
  const r = make0_1(),
    l = list0_1();
  hold0_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held0_1 === null,
    typeof held0_1,
    ask0_1(Object.getPrototypeOf(Bun.sql)),
    label(r.above),
    label(l[0]),
    label(held0_1),
  ].join();
});
say("(Bun.sql) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make0_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql)) };
}
function list0_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql))];
}
function ask0_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held0_2;
function hold0_2() {
  held0_2 = Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql));
}
say("(Bun.sql) 2 far", function () {
  const r = make0_2(),
    l = list0_2();
  hold0_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held0_2 === null,
    typeof held0_2,
    ask0_2(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql))),
    label(r.above),
    label(l[0]),
    label(held0_2),
  ].join();
});
say("(Bun.sql) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make0_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql))) };
}
function list0_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql)))];
}
function ask0_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held0_3;
function hold0_3() {
  held0_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql)));
}
say("(Bun.sql) 3 far", function () {
  const r = make0_3(),
    l = list0_3();
  hold0_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held0_3 === null,
    typeof held0_3,
    ask0_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql)))),
    label(r.above),
    label(l[0]),
    label(held0_3),
  ].join();
});
say("(Bun.sql) other", function () {
  const kept = { a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(Bun.sql)), b: Bun.sql.__proto__.__proto__ };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(Bun.sql),
    Function.prototype.isPrototypeOf(Bun.sql),
    Bun.sql instanceof Object,
    Bun.sql instanceof Function,
    "hasOwnProperty" in Bun.sql,
    typeof Bun.sql.hasOwnProperty,
    typeof Bun.sql.call,
  ].join();
});
say("(Bun.postgres) 1", function () {
  const direct = Object.getPrototypeOf(Bun.postgres);
  const kept = { above: Object.getPrototypeOf(Bun.postgres) };
  const list = [Object.getPrototypeOf(Bun.postgres)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make1_1() {
  return { above: Object.getPrototypeOf(Bun.postgres) };
}
function list1_1() {
  return [Object.getPrototypeOf(Bun.postgres)];
}
function ask1_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held1_1;
function hold1_1() {
  held1_1 = Object.getPrototypeOf(Bun.postgres);
}
say("(Bun.postgres) 1 far", function () {
  const r = make1_1(),
    l = list1_1();
  hold1_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held1_1 === null,
    typeof held1_1,
    ask1_1(Object.getPrototypeOf(Bun.postgres)),
    label(r.above),
    label(l[0]),
    label(held1_1),
  ].join();
});
say("(Bun.postgres) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make1_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres)) };
}
function list1_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres))];
}
function ask1_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held1_2;
function hold1_2() {
  held1_2 = Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres));
}
say("(Bun.postgres) 2 far", function () {
  const r = make1_2(),
    l = list1_2();
  hold1_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held1_2 === null,
    typeof held1_2,
    ask1_2(Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres))),
    label(r.above),
    label(l[0]),
    label(held1_2),
  ].join();
});
say("(Bun.postgres) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make1_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres))) };
}
function list1_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres)))];
}
function ask1_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held1_3;
function hold1_3() {
  held1_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres)));
}
say("(Bun.postgres) 3 far", function () {
  const r = make1_3(),
    l = list1_3();
  hold1_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held1_3 === null,
    typeof held1_3,
    ask1_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.postgres)))),
    label(r.above),
    label(l[0]),
    label(held1_3),
  ].join();
});
say("(Bun.postgres) other", function () {
  const kept = { a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(Bun.postgres)), b: Bun.postgres.__proto__.__proto__ };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(Bun.postgres),
    Function.prototype.isPrototypeOf(Bun.postgres),
    Bun.postgres instanceof Object,
    Bun.postgres instanceof Function,
    "hasOwnProperty" in Bun.postgres,
    typeof Bun.postgres.hasOwnProperty,
    typeof Bun.postgres.call,
  ].join();
});
say("(Bun.$) 1", function () {
  const direct = Object.getPrototypeOf(Bun.$);
  const kept = { above: Object.getPrototypeOf(Bun.$) };
  const list = [Object.getPrototypeOf(Bun.$)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make2_1() {
  return { above: Object.getPrototypeOf(Bun.$) };
}
function list2_1() {
  return [Object.getPrototypeOf(Bun.$)];
}
function ask2_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held2_1;
function hold2_1() {
  held2_1 = Object.getPrototypeOf(Bun.$);
}
say("(Bun.$) 1 far", function () {
  const r = make2_1(),
    l = list2_1();
  hold2_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held2_1 === null,
    typeof held2_1,
    ask2_1(Object.getPrototypeOf(Bun.$)),
    label(r.above),
    label(l[0]),
    label(held2_1),
  ].join();
});
say("(Bun.$) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Bun.$));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.$)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Bun.$))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make2_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.$)) };
}
function list2_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Bun.$))];
}
function ask2_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held2_2;
function hold2_2() {
  held2_2 = Object.getPrototypeOf(Object.getPrototypeOf(Bun.$));
}
say("(Bun.$) 2 far", function () {
  const r = make2_2(),
    l = list2_2();
  hold2_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held2_2 === null,
    typeof held2_2,
    ask2_2(Object.getPrototypeOf(Object.getPrototypeOf(Bun.$))),
    label(r.above),
    label(l[0]),
    label(held2_2),
  ].join();
});
say("(Bun.$) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.$)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.$))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.$)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make2_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.$))) };
}
function list2_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.$)))];
}
function ask2_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held2_3;
function hold2_3() {
  held2_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.$)));
}
say("(Bun.$) 3 far", function () {
  const r = make2_3(),
    l = list2_3();
  hold2_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held2_3 === null,
    typeof held2_3,
    ask2_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.$)))),
    label(r.above),
    label(l[0]),
    label(held2_3),
  ].join();
});
say("(Bun.$) other", function () {
  const kept = { a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(Bun.$)), b: Bun.$.__proto__.__proto__ };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(Bun.$),
    Function.prototype.isPrototypeOf(Bun.$),
    Bun.$ instanceof Object,
    Bun.$ instanceof Function,
    "hasOwnProperty" in Bun.$,
    typeof Bun.$.hasOwnProperty,
    typeof Bun.$.call,
  ].join();
});
say("(console) 1", function () {
  const direct = Object.getPrototypeOf(console);
  const kept = { above: Object.getPrototypeOf(console) };
  const list = [Object.getPrototypeOf(console)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make3_1() {
  return { above: Object.getPrototypeOf(console) };
}
function list3_1() {
  return [Object.getPrototypeOf(console)];
}
function ask3_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held3_1;
function hold3_1() {
  held3_1 = Object.getPrototypeOf(console);
}
say("(console) 1 far", function () {
  const r = make3_1(),
    l = list3_1();
  hold3_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held3_1 === null,
    typeof held3_1,
    ask3_1(Object.getPrototypeOf(console)),
    label(r.above),
    label(l[0]),
    label(held3_1),
  ].join();
});
say("(console) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(console));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(console)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(console))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make3_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(console)) };
}
function list3_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(console))];
}
function ask3_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held3_2;
function hold3_2() {
  held3_2 = Object.getPrototypeOf(Object.getPrototypeOf(console));
}
say("(console) 2 far", function () {
  const r = make3_2(),
    l = list3_2();
  hold3_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held3_2 === null,
    typeof held3_2,
    ask3_2(Object.getPrototypeOf(Object.getPrototypeOf(console))),
    label(r.above),
    label(l[0]),
    label(held3_2),
  ].join();
});
say("(console) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(console)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(console))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(console)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make3_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(console))) };
}
function list3_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(console)))];
}
function ask3_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held3_3;
function hold3_3() {
  held3_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(console)));
}
say("(console) 3 far", function () {
  const r = make3_3(),
    l = list3_3();
  hold3_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held3_3 === null,
    typeof held3_3,
    ask3_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(console)))),
    label(r.above),
    label(l[0]),
    label(held3_3),
  ].join();
});
say("(console) other", function () {
  const kept = { a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(console)), b: console.__proto__.__proto__ };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(console),
    Function.prototype.isPrototypeOf(console),
    console instanceof Object,
    console instanceof Function,
    "hasOwnProperty" in console,
    typeof console.hasOwnProperty,
    typeof console.call,
  ].join();
});
say("(globalThis.console) 1", function () {
  const direct = Object.getPrototypeOf(globalThis.console);
  const kept = { above: Object.getPrototypeOf(globalThis.console) };
  const list = [Object.getPrototypeOf(globalThis.console)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make4_1() {
  return { above: Object.getPrototypeOf(globalThis.console) };
}
function list4_1() {
  return [Object.getPrototypeOf(globalThis.console)];
}
function ask4_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held4_1;
function hold4_1() {
  held4_1 = Object.getPrototypeOf(globalThis.console);
}
say("(globalThis.console) 1 far", function () {
  const r = make4_1(),
    l = list4_1();
  hold4_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held4_1 === null,
    typeof held4_1,
    ask4_1(Object.getPrototypeOf(globalThis.console)),
    label(r.above),
    label(l[0]),
    label(held4_1),
  ].join();
});
say("(globalThis.console) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make4_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console)) };
}
function list4_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console))];
}
function ask4_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held4_2;
function hold4_2() {
  held4_2 = Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console));
}
say("(globalThis.console) 2 far", function () {
  const r = make4_2(),
    l = list4_2();
  hold4_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held4_2 === null,
    typeof held4_2,
    ask4_2(Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console))),
    label(r.above),
    label(l[0]),
    label(held4_2),
  ].join();
});
say("(globalThis.console) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make4_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console))) };
}
function list4_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console)))];
}
function ask4_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held4_3;
function hold4_3() {
  held4_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console)));
}
say("(globalThis.console) 3 far", function () {
  const r = make4_3(),
    l = list4_3();
  hold4_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held4_3 === null,
    typeof held4_3,
    ask4_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(globalThis.console)))),
    label(r.above),
    label(l[0]),
    label(held4_3),
  ].join();
});
say("(globalThis.console) other", function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(globalThis.console)),
    b: globalThis.console.__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(globalThis.console),
    Function.prototype.isPrototypeOf(globalThis.console),
    globalThis.console instanceof Object,
    globalThis.console instanceof Function,
    "hasOwnProperty" in globalThis.console,
    typeof globalThis.console.hasOwnProperty,
    typeof globalThis.console.call,
  ].join();
});
say('(require("node:console")) 1', function () {
  const direct = Object.getPrototypeOf(require("node:console"));
  const kept = { above: Object.getPrototypeOf(require("node:console")) };
  const list = [Object.getPrototypeOf(require("node:console"))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make5_1() {
  return { above: Object.getPrototypeOf(require("node:console")) };
}
function list5_1() {
  return [Object.getPrototypeOf(require("node:console"))];
}
function ask5_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held5_1;
function hold5_1() {
  held5_1 = Object.getPrototypeOf(require("node:console"));
}
say('(require("node:console")) 1 far', function () {
  const r = make5_1(),
    l = list5_1();
  hold5_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held5_1 === null,
    typeof held5_1,
    ask5_1(Object.getPrototypeOf(require("node:console"))),
    label(r.above),
    label(l[0]),
    label(held5_1),
  ].join();
});
say('(require("node:console")) 2', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(require("node:console")));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:console"))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(require("node:console")))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make5_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:console"))) };
}
function list5_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(require("node:console")))];
}
function ask5_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held5_2;
function hold5_2() {
  held5_2 = Object.getPrototypeOf(Object.getPrototypeOf(require("node:console")));
}
say('(require("node:console")) 2 far', function () {
  const r = make5_2(),
    l = list5_2();
  hold5_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held5_2 === null,
    typeof held5_2,
    ask5_2(Object.getPrototypeOf(Object.getPrototypeOf(require("node:console")))),
    label(r.above),
    label(l[0]),
    label(held5_2),
  ].join();
});
say('(require("node:console")) 3', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:console"))));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:console")))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:console"))))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make5_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:console")))) };
}
function list5_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:console"))))];
}
function ask5_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held5_3;
function hold5_3() {
  held5_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:console"))));
}
say('(require("node:console")) 3 far', function () {
  const r = make5_3(),
    l = list5_3();
  hold5_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held5_3 === null,
    typeof held5_3,
    ask5_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:console"))))),
    label(r.above),
    label(l[0]),
    label(held5_3),
  ].join();
});
say('(require("node:console")) other', function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(require("node:console"))),
    b: require("node:console").__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(require("node:console")),
    Function.prototype.isPrototypeOf(require("node:console")),
    require("node:console") instanceof Object,
    require("node:console") instanceof Function,
    "hasOwnProperty" in require("node:console"),
    typeof require("node:console").hasOwnProperty,
    typeof require("node:console").call,
  ].join();
});
say('(require("node:buffer").SlowBuffer) 1', function () {
  const direct = Object.getPrototypeOf(require("node:buffer").SlowBuffer);
  const kept = { above: Object.getPrototypeOf(require("node:buffer").SlowBuffer) };
  const list = [Object.getPrototypeOf(require("node:buffer").SlowBuffer)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make6_1() {
  return { above: Object.getPrototypeOf(require("node:buffer").SlowBuffer) };
}
function list6_1() {
  return [Object.getPrototypeOf(require("node:buffer").SlowBuffer)];
}
function ask6_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held6_1;
function hold6_1() {
  held6_1 = Object.getPrototypeOf(require("node:buffer").SlowBuffer);
}
say('(require("node:buffer").SlowBuffer) 1 far', function () {
  const r = make6_1(),
    l = list6_1();
  hold6_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held6_1 === null,
    typeof held6_1,
    ask6_1(Object.getPrototypeOf(require("node:buffer").SlowBuffer)),
    label(r.above),
    label(l[0]),
    label(held6_1),
  ].join();
});
say('(require("node:buffer").SlowBuffer) 2', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make6_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer)) };
}
function list6_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer))];
}
function ask6_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held6_2;
function hold6_2() {
  held6_2 = Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer));
}
say('(require("node:buffer").SlowBuffer) 2 far', function () {
  const r = make6_2(),
    l = list6_2();
  hold6_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held6_2 === null,
    typeof held6_2,
    ask6_2(Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer))),
    label(r.above),
    label(l[0]),
    label(held6_2),
  ].join();
});
say('(require("node:buffer").SlowBuffer) 3', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer)));
  const kept = {
    above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer))),
  };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make6_3() {
  return {
    above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer))),
  };
}
function list6_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer)))];
}
function ask6_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held6_3;
function hold6_3() {
  held6_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer)));
}
say('(require("node:buffer").SlowBuffer) 3 far', function () {
  const r = make6_3(),
    l = list6_3();
  hold6_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held6_3 === null,
    typeof held6_3,
    ask6_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer)))),
    label(r.above),
    label(l[0]),
    label(held6_3),
  ].join();
});
say('(require("node:buffer").SlowBuffer) other', function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(require("node:buffer").SlowBuffer)),
    b: require("node:buffer").SlowBuffer.__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(require("node:buffer").SlowBuffer),
    Function.prototype.isPrototypeOf(require("node:buffer").SlowBuffer),
    require("node:buffer").SlowBuffer instanceof Object,
    require("node:buffer").SlowBuffer instanceof Function,
    "hasOwnProperty" in require("node:buffer").SlowBuffer,
    typeof require("node:buffer").SlowBuffer.hasOwnProperty,
    typeof require("node:buffer").SlowBuffer.call,
  ].join();
});
say("(require.resolve) 1", function () {
  const direct = Object.getPrototypeOf(require.resolve);
  const kept = { above: Object.getPrototypeOf(require.resolve) };
  const list = [Object.getPrototypeOf(require.resolve)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make7_1() {
  return { above: Object.getPrototypeOf(require.resolve) };
}
function list7_1() {
  return [Object.getPrototypeOf(require.resolve)];
}
function ask7_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held7_1;
function hold7_1() {
  held7_1 = Object.getPrototypeOf(require.resolve);
}
say("(require.resolve) 1 far", function () {
  const r = make7_1(),
    l = list7_1();
  hold7_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held7_1 === null,
    typeof held7_1,
    ask7_1(Object.getPrototypeOf(require.resolve)),
    label(r.above),
    label(l[0]),
    label(held7_1),
  ].join();
});
say("(require.resolve) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(require.resolve));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(require.resolve)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(require.resolve))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make7_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(require.resolve)) };
}
function list7_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(require.resolve))];
}
function ask7_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held7_2;
function hold7_2() {
  held7_2 = Object.getPrototypeOf(Object.getPrototypeOf(require.resolve));
}
say("(require.resolve) 2 far", function () {
  const r = make7_2(),
    l = list7_2();
  hold7_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held7_2 === null,
    typeof held7_2,
    ask7_2(Object.getPrototypeOf(Object.getPrototypeOf(require.resolve))),
    label(r.above),
    label(l[0]),
    label(held7_2),
  ].join();
});
say("(require.resolve) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require.resolve)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require.resolve))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require.resolve)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make7_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require.resolve))) };
}
function list7_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require.resolve)))];
}
function ask7_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held7_3;
function hold7_3() {
  held7_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require.resolve)));
}
say("(require.resolve) 3 far", function () {
  const r = make7_3(),
    l = list7_3();
  hold7_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held7_3 === null,
    typeof held7_3,
    ask7_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require.resolve)))),
    label(r.above),
    label(l[0]),
    label(held7_3),
  ].join();
});
say("(require.resolve) other", function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(require.resolve)),
    b: require.resolve.__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(require.resolve),
    Function.prototype.isPrototypeOf(require.resolve),
    require.resolve instanceof Object,
    require.resolve instanceof Function,
    "hasOwnProperty" in require.resolve,
    typeof require.resolve.hasOwnProperty,
    typeof require.resolve.call,
  ].join();
});
say("(Bun.sql.bind(null)) 1", function () {
  const direct = Object.getPrototypeOf(Bun.sql.bind(null));
  const kept = { above: Object.getPrototypeOf(Bun.sql.bind(null)) };
  const list = [Object.getPrototypeOf(Bun.sql.bind(null))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make8_1() {
  return { above: Object.getPrototypeOf(Bun.sql.bind(null)) };
}
function list8_1() {
  return [Object.getPrototypeOf(Bun.sql.bind(null))];
}
function ask8_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held8_1;
function hold8_1() {
  held8_1 = Object.getPrototypeOf(Bun.sql.bind(null));
}
say("(Bun.sql.bind(null)) 1 far", function () {
  const r = make8_1(),
    l = list8_1();
  hold8_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held8_1 === null,
    typeof held8_1,
    ask8_1(Object.getPrototypeOf(Bun.sql.bind(null))),
    label(r.above),
    label(l[0]),
    label(held8_1),
  ].join();
});
say("(Bun.sql.bind(null)) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make8_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null))) };
}
function list8_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null)))];
}
function ask8_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held8_2;
function hold8_2() {
  held8_2 = Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null)));
}
say("(Bun.sql.bind(null)) 2 far", function () {
  const r = make8_2(),
    l = list8_2();
  hold8_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held8_2 === null,
    typeof held8_2,
    ask8_2(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null)))),
    label(r.above),
    label(l[0]),
    label(held8_2),
  ].join();
});
say("(Bun.sql.bind(null)) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null))));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null)))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null))))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make8_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null)))) };
}
function list8_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null))))];
}
function ask8_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held8_3;
function hold8_3() {
  held8_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null))));
}
say("(Bun.sql.bind(null)) 3 far", function () {
  const r = make8_3(),
    l = list8_3();
  hold8_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held8_3 === null,
    typeof held8_3,
    ask8_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql.bind(null))))),
    label(r.above),
    label(l[0]),
    label(held8_3),
  ].join();
});
say("(Bun.sql.bind(null)) other", function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(Bun.sql.bind(null))),
    b: Bun.sql.bind(null).__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(Bun.sql.bind(null)),
    Function.prototype.isPrototypeOf(Bun.sql.bind(null)),
    Bun.sql.bind(null) instanceof Object,
    Bun.sql.bind(null) instanceof Function,
    "hasOwnProperty" in Bun.sql.bind(null),
    typeof Bun.sql.bind(null).hasOwnProperty,
    typeof Bun.sql.bind(null).call,
  ].join();
});
say("(new Proxy(Bun.$, {})) 1", function () {
  const direct = Object.getPrototypeOf(new Proxy(Bun.$, {}));
  const kept = { above: Object.getPrototypeOf(new Proxy(Bun.$, {})) };
  const list = [Object.getPrototypeOf(new Proxy(Bun.$, {}))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make9_1() {
  return { above: Object.getPrototypeOf(new Proxy(Bun.$, {})) };
}
function list9_1() {
  return [Object.getPrototypeOf(new Proxy(Bun.$, {}))];
}
function ask9_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held9_1;
function hold9_1() {
  held9_1 = Object.getPrototypeOf(new Proxy(Bun.$, {}));
}
say("(new Proxy(Bun.$, {})) 1 far", function () {
  const r = make9_1(),
    l = list9_1();
  hold9_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held9_1 === null,
    typeof held9_1,
    ask9_1(Object.getPrototypeOf(new Proxy(Bun.$, {}))),
    label(r.above),
    label(l[0]),
    label(held9_1),
  ].join();
});
say("(new Proxy(Bun.$, {})) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {})));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {}))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {})))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make9_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {}))) };
}
function list9_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {})))];
}
function ask9_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held9_2;
function hold9_2() {
  held9_2 = Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {})));
}
say("(new Proxy(Bun.$, {})) 2 far", function () {
  const r = make9_2(),
    l = list9_2();
  hold9_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held9_2 === null,
    typeof held9_2,
    ask9_2(Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {})))),
    label(r.above),
    label(l[0]),
    label(held9_2),
  ].join();
});
say("(new Proxy(Bun.$, {})) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {}))));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {})))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {}))))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make9_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {})))) };
}
function list9_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {}))))];
}
function ask9_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held9_3;
function hold9_3() {
  held9_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {}))));
}
say("(new Proxy(Bun.$, {})) 3 far", function () {
  const r = make9_3(),
    l = list9_3();
  hold9_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held9_3 === null,
    typeof held9_3,
    ask9_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(new Proxy(Bun.$, {}))))),
    label(r.above),
    label(l[0]),
    label(held9_3),
  ].join();
});
say("(new Proxy(Bun.$, {})) other", function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(new Proxy(Bun.$, {}))),
    b: new Proxy(Bun.$, {}).__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(new Proxy(Bun.$, {})),
    Function.prototype.isPrototypeOf(new Proxy(Bun.$, {})),
    new Proxy(Bun.$, {}) instanceof Object,
    new Proxy(Bun.$, {}) instanceof Function,
    "hasOwnProperty" in new Proxy(Bun.$, {}),
    typeof new Proxy(Bun.$, {}).hasOwnProperty,
    typeof new Proxy(Bun.$, {}).call,
  ].join();
});
say("(Object.create(console)) 1", function () {
  const direct = Object.getPrototypeOf(Object.create(console));
  const kept = { above: Object.getPrototypeOf(Object.create(console)) };
  const list = [Object.getPrototypeOf(Object.create(console))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make10_1() {
  return { above: Object.getPrototypeOf(Object.create(console)) };
}
function list10_1() {
  return [Object.getPrototypeOf(Object.create(console))];
}
function ask10_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held10_1;
function hold10_1() {
  held10_1 = Object.getPrototypeOf(Object.create(console));
}
say("(Object.create(console)) 1 far", function () {
  const r = make10_1(),
    l = list10_1();
  hold10_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held10_1 === null,
    typeof held10_1,
    ask10_1(Object.getPrototypeOf(Object.create(console))),
    label(r.above),
    label(l[0]),
    label(held10_1),
  ].join();
});
say("(Object.create(console)) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make10_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console))) };
}
function list10_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console)))];
}
function ask10_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held10_2;
function hold10_2() {
  held10_2 = Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console)));
}
say("(Object.create(console)) 2 far", function () {
  const r = make10_2(),
    l = list10_2();
  hold10_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held10_2 === null,
    typeof held10_2,
    ask10_2(Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console)))),
    label(r.above),
    label(l[0]),
    label(held10_2),
  ].join();
});
say("(Object.create(console)) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console))));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console)))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console))))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make10_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console)))) };
}
function list10_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console))))];
}
function ask10_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held10_3;
function hold10_3() {
  held10_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console))));
}
say("(Object.create(console)) 3 far", function () {
  const r = make10_3(),
    l = list10_3();
  hold10_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held10_3 === null,
    typeof held10_3,
    ask10_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Object.create(console))))),
    label(r.above),
    label(l[0]),
    label(held10_3),
  ].join();
});
say("(Object.create(console)) other", function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(Object.create(console))),
    b: Object.create(console).__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(Object.create(console)),
    Function.prototype.isPrototypeOf(Object.create(console)),
    Object.create(console) instanceof Object,
    Object.create(console) instanceof Function,
    "hasOwnProperty" in Object.create(console),
    typeof Object.create(console).hasOwnProperty,
    typeof Object.create(console).call,
  ].join();
});
say('(class extends require("node:buffer").SlowBuffer {}) 1', function () {
  const direct = Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {});
  const kept = { above: Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {}) };
  const list = [Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make11_1() {
  return { above: Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {}) };
}
function list11_1() {
  return [Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})];
}
function ask11_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held11_1;
function hold11_1() {
  held11_1 = Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {});
}
say('(class extends require("node:buffer").SlowBuffer {}) 1 far', function () {
  const r = make11_1(),
    l = list11_1();
  hold11_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held11_1 === null,
    typeof held11_1,
    ask11_1(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})),
    label(r.above),
    label(l[0]),
    label(held11_1),
  ].join();
});
say('(class extends require("node:buffer").SlowBuffer {}) 2', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {}));
  const kept = {
    above: Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})),
  };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {}))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make11_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})) };
}
function list11_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {}))];
}
function ask11_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held11_2;
function hold11_2() {
  held11_2 = Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {}));
}
say('(class extends require("node:buffer").SlowBuffer {}) 2 far', function () {
  const r = make11_2(),
    l = list11_2();
  hold11_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held11_2 === null,
    typeof held11_2,
    ask11_2(Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {}))),
    label(r.above),
    label(l[0]),
    label(held11_2),
  ].join();
});
say('(class extends require("node:buffer").SlowBuffer {}) 3', function () {
  const direct = Object.getPrototypeOf(
    Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})),
  );
  const kept = {
    above: Object.getPrototypeOf(
      Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})),
    ),
  };
  const list = [
    Object.getPrototypeOf(
      Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})),
    ),
  ];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make11_3() {
  return {
    above: Object.getPrototypeOf(
      Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})),
    ),
  };
}
function list11_3() {
  return [
    Object.getPrototypeOf(
      Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})),
    ),
  ];
}
function ask11_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held11_3;
function hold11_3() {
  held11_3 = Object.getPrototypeOf(
    Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})),
  );
}
say('(class extends require("node:buffer").SlowBuffer {}) 3 far', function () {
  const r = make11_3(),
    l = list11_3();
  hold11_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held11_3 === null,
    typeof held11_3,
    ask11_3(
      Object.getPrototypeOf(
        Object.getPrototypeOf(Object.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})),
      ),
    ),
    label(r.above),
    label(l[0]),
    label(held11_3),
  ].join();
});
say('(class extends require("node:buffer").SlowBuffer {}) other', function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(class extends require("node:buffer").SlowBuffer {})),
    b: class extends require("node:buffer").SlowBuffer {}.__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(class extends require("node:buffer").SlowBuffer {}),
    Function.prototype.isPrototypeOf(class extends require("node:buffer").SlowBuffer {}),
    class extends require("node:buffer").SlowBuffer {} instanceof Object,
    class extends require("node:buffer").SlowBuffer {} instanceof Function,
    "hasOwnProperty" in class extends require("node:buffer").SlowBuffer {},
    typeof class extends require("node:buffer").SlowBuffer {}.hasOwnProperty,
    typeof class extends require("node:buffer").SlowBuffer {}.call,
  ].join();
});
say("(Bun.inspect) 1", function () {
  const direct = Object.getPrototypeOf(Bun.inspect);
  const kept = { above: Object.getPrototypeOf(Bun.inspect) };
  const list = [Object.getPrototypeOf(Bun.inspect)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make12_1() {
  return { above: Object.getPrototypeOf(Bun.inspect) };
}
function list12_1() {
  return [Object.getPrototypeOf(Bun.inspect)];
}
function ask12_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held12_1;
function hold12_1() {
  held12_1 = Object.getPrototypeOf(Bun.inspect);
}
say("(Bun.inspect) 1 far", function () {
  const r = make12_1(),
    l = list12_1();
  hold12_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held12_1 === null,
    typeof held12_1,
    ask12_1(Object.getPrototypeOf(Bun.inspect)),
    label(r.above),
    label(l[0]),
    label(held12_1),
  ].join();
});
say("(Bun.inspect) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make12_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect)) };
}
function list12_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect))];
}
function ask12_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held12_2;
function hold12_2() {
  held12_2 = Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect));
}
say("(Bun.inspect) 2 far", function () {
  const r = make12_2(),
    l = list12_2();
  hold12_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held12_2 === null,
    typeof held12_2,
    ask12_2(Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect))),
    label(r.above),
    label(l[0]),
    label(held12_2),
  ].join();
});
say("(Bun.inspect) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make12_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect))) };
}
function list12_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect)))];
}
function ask12_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held12_3;
function hold12_3() {
  held12_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect)));
}
say("(Bun.inspect) 3 far", function () {
  const r = make12_3(),
    l = list12_3();
  hold12_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held12_3 === null,
    typeof held12_3,
    ask12_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun.inspect)))),
    label(r.above),
    label(l[0]),
    label(held12_3),
  ].join();
});
say("(Bun.inspect) other", function () {
  const kept = { a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(Bun.inspect)), b: Bun.inspect.__proto__.__proto__ };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(Bun.inspect),
    Function.prototype.isPrototypeOf(Bun.inspect),
    Bun.inspect instanceof Object,
    Bun.inspect instanceof Function,
    "hasOwnProperty" in Bun.inspect,
    typeof Bun.inspect.hasOwnProperty,
    typeof Bun.inspect.call,
  ].join();
});
say("(process.hrtime) 1", function () {
  const direct = Object.getPrototypeOf(process.hrtime);
  const kept = { above: Object.getPrototypeOf(process.hrtime) };
  const list = [Object.getPrototypeOf(process.hrtime)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make13_1() {
  return { above: Object.getPrototypeOf(process.hrtime) };
}
function list13_1() {
  return [Object.getPrototypeOf(process.hrtime)];
}
function ask13_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held13_1;
function hold13_1() {
  held13_1 = Object.getPrototypeOf(process.hrtime);
}
say("(process.hrtime) 1 far", function () {
  const r = make13_1(),
    l = list13_1();
  hold13_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held13_1 === null,
    typeof held13_1,
    ask13_1(Object.getPrototypeOf(process.hrtime)),
    label(r.above),
    label(l[0]),
    label(held13_1),
  ].join();
});
say("(process.hrtime) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make13_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime)) };
}
function list13_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime))];
}
function ask13_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held13_2;
function hold13_2() {
  held13_2 = Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime));
}
say("(process.hrtime) 2 far", function () {
  const r = make13_2(),
    l = list13_2();
  hold13_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held13_2 === null,
    typeof held13_2,
    ask13_2(Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime))),
    label(r.above),
    label(l[0]),
    label(held13_2),
  ].join();
});
say("(process.hrtime) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make13_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime))) };
}
function list13_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime)))];
}
function ask13_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held13_3;
function hold13_3() {
  held13_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime)));
}
say("(process.hrtime) 3 far", function () {
  const r = make13_3(),
    l = list13_3();
  hold13_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held13_3 === null,
    typeof held13_3,
    ask13_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process.hrtime)))),
    label(r.above),
    label(l[0]),
    label(held13_3),
  ].join();
});
say("(process.hrtime) other", function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(process.hrtime)),
    b: process.hrtime.__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(process.hrtime),
    Function.prototype.isPrototypeOf(process.hrtime),
    process.hrtime instanceof Object,
    process.hrtime instanceof Function,
    "hasOwnProperty" in process.hrtime,
    typeof process.hrtime.hasOwnProperty,
    typeof process.hrtime.call,
  ].join();
});
say('(require("node:fs").readFile) 1', function () {
  const direct = Object.getPrototypeOf(require("node:fs").readFile);
  const kept = { above: Object.getPrototypeOf(require("node:fs").readFile) };
  const list = [Object.getPrototypeOf(require("node:fs").readFile)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make14_1() {
  return { above: Object.getPrototypeOf(require("node:fs").readFile) };
}
function list14_1() {
  return [Object.getPrototypeOf(require("node:fs").readFile)];
}
function ask14_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held14_1;
function hold14_1() {
  held14_1 = Object.getPrototypeOf(require("node:fs").readFile);
}
say('(require("node:fs").readFile) 1 far', function () {
  const r = make14_1(),
    l = list14_1();
  hold14_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held14_1 === null,
    typeof held14_1,
    ask14_1(Object.getPrototypeOf(require("node:fs").readFile)),
    label(r.above),
    label(l[0]),
    label(held14_1),
  ].join();
});
say('(require("node:fs").readFile) 2', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make14_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile)) };
}
function list14_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile))];
}
function ask14_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held14_2;
function hold14_2() {
  held14_2 = Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile));
}
say('(require("node:fs").readFile) 2 far', function () {
  const r = make14_2(),
    l = list14_2();
  hold14_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held14_2 === null,
    typeof held14_2,
    ask14_2(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile))),
    label(r.above),
    label(l[0]),
    label(held14_2),
  ].join();
});
say('(require("node:fs").readFile) 3', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile)));
  const kept = {
    above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile))),
  };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make14_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile))) };
}
function list14_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile)))];
}
function ask14_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held14_3;
function hold14_3() {
  held14_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile)));
}
say('(require("node:fs").readFile) 3 far', function () {
  const r = make14_3(),
    l = list14_3();
  hold14_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held14_3 === null,
    typeof held14_3,
    ask14_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").readFile)))),
    label(r.above),
    label(l[0]),
    label(held14_3),
  ].join();
});
say('(require("node:fs").readFile) other', function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(require("node:fs").readFile)),
    b: require("node:fs").readFile.__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(require("node:fs").readFile),
    Function.prototype.isPrototypeOf(require("node:fs").readFile),
    require("node:fs").readFile instanceof Object,
    require("node:fs").readFile instanceof Function,
    "hasOwnProperty" in require("node:fs").readFile,
    typeof require("node:fs").readFile.hasOwnProperty,
    typeof require("node:fs").readFile.call,
  ].join();
});
say('(require("node:fs").promises.readFile) 1', function () {
  const direct = Object.getPrototypeOf(require("node:fs").promises.readFile);
  const kept = { above: Object.getPrototypeOf(require("node:fs").promises.readFile) };
  const list = [Object.getPrototypeOf(require("node:fs").promises.readFile)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make15_1() {
  return { above: Object.getPrototypeOf(require("node:fs").promises.readFile) };
}
function list15_1() {
  return [Object.getPrototypeOf(require("node:fs").promises.readFile)];
}
function ask15_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held15_1;
function hold15_1() {
  held15_1 = Object.getPrototypeOf(require("node:fs").promises.readFile);
}
say('(require("node:fs").promises.readFile) 1 far', function () {
  const r = make15_1(),
    l = list15_1();
  hold15_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held15_1 === null,
    typeof held15_1,
    ask15_1(Object.getPrototypeOf(require("node:fs").promises.readFile)),
    label(r.above),
    label(l[0]),
    label(held15_1),
  ].join();
});
say('(require("node:fs").promises.readFile) 2', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make15_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile)) };
}
function list15_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile))];
}
function ask15_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held15_2;
function hold15_2() {
  held15_2 = Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile));
}
say('(require("node:fs").promises.readFile) 2 far', function () {
  const r = make15_2(),
    l = list15_2();
  hold15_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held15_2 === null,
    typeof held15_2,
    ask15_2(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile))),
    label(r.above),
    label(l[0]),
    label(held15_2),
  ].join();
});
say('(require("node:fs").promises.readFile) 3', function () {
  const direct = Object.getPrototypeOf(
    Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile)),
  );
  const kept = {
    above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile))),
  };
  const list = [
    Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile))),
  ];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make15_3() {
  return {
    above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile))),
  };
}
function list15_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile)))];
}
function ask15_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held15_3;
function hold15_3() {
  held15_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile)));
}
say('(require("node:fs").promises.readFile) 3 far', function () {
  const r = make15_3(),
    l = list15_3();
  hold15_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held15_3 === null,
    typeof held15_3,
    ask15_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:fs").promises.readFile)))),
    label(r.above),
    label(l[0]),
    label(held15_3),
  ].join();
});
say('(require("node:fs").promises.readFile) other', function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(require("node:fs").promises.readFile)),
    b: require("node:fs").promises.readFile.__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(require("node:fs").promises.readFile),
    Function.prototype.isPrototypeOf(require("node:fs").promises.readFile),
    require("node:fs").promises.readFile instanceof Object,
    require("node:fs").promises.readFile instanceof Function,
    "hasOwnProperty" in require("node:fs").promises.readFile,
    typeof require("node:fs").promises.readFile.hasOwnProperty,
    typeof require("node:fs").promises.readFile.call,
  ].join();
});
say('(require("node:events")) 1', function () {
  const direct = Object.getPrototypeOf(require("node:events"));
  const kept = { above: Object.getPrototypeOf(require("node:events")) };
  const list = [Object.getPrototypeOf(require("node:events"))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make16_1() {
  return { above: Object.getPrototypeOf(require("node:events")) };
}
function list16_1() {
  return [Object.getPrototypeOf(require("node:events"))];
}
function ask16_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held16_1;
function hold16_1() {
  held16_1 = Object.getPrototypeOf(require("node:events"));
}
say('(require("node:events")) 1 far', function () {
  const r = make16_1(),
    l = list16_1();
  hold16_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held16_1 === null,
    typeof held16_1,
    ask16_1(Object.getPrototypeOf(require("node:events"))),
    label(r.above),
    label(l[0]),
    label(held16_1),
  ].join();
});
say('(require("node:events")) 2', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(require("node:events")));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:events"))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(require("node:events")))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make16_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:events"))) };
}
function list16_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(require("node:events")))];
}
function ask16_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held16_2;
function hold16_2() {
  held16_2 = Object.getPrototypeOf(Object.getPrototypeOf(require("node:events")));
}
say('(require("node:events")) 2 far', function () {
  const r = make16_2(),
    l = list16_2();
  hold16_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held16_2 === null,
    typeof held16_2,
    ask16_2(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events")))),
    label(r.above),
    label(l[0]),
    label(held16_2),
  ].join();
});
say('(require("node:events")) 3', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events"))));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events")))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events"))))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make16_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events")))) };
}
function list16_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events"))))];
}
function ask16_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held16_3;
function hold16_3() {
  held16_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events"))));
}
say('(require("node:events")) 3 far', function () {
  const r = make16_3(),
    l = list16_3();
  hold16_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held16_3 === null,
    typeof held16_3,
    ask16_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events"))))),
    label(r.above),
    label(l[0]),
    label(held16_3),
  ].join();
});
say('(require("node:events")) other', function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(require("node:events"))),
    b: require("node:events").__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(require("node:events")),
    Function.prototype.isPrototypeOf(require("node:events")),
    require("node:events") instanceof Object,
    require("node:events") instanceof Function,
    "hasOwnProperty" in require("node:events"),
    typeof require("node:events").hasOwnProperty,
    typeof require("node:events").call,
  ].join();
});
say('(require("node:events").prototype) 1', function () {
  const direct = Object.getPrototypeOf(require("node:events").prototype);
  const kept = { above: Object.getPrototypeOf(require("node:events").prototype) };
  const list = [Object.getPrototypeOf(require("node:events").prototype)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make17_1() {
  return { above: Object.getPrototypeOf(require("node:events").prototype) };
}
function list17_1() {
  return [Object.getPrototypeOf(require("node:events").prototype)];
}
function ask17_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held17_1;
function hold17_1() {
  held17_1 = Object.getPrototypeOf(require("node:events").prototype);
}
say('(require("node:events").prototype) 1 far', function () {
  const r = make17_1(),
    l = list17_1();
  hold17_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held17_1 === null,
    typeof held17_1,
    ask17_1(Object.getPrototypeOf(require("node:events").prototype)),
    label(r.above),
    label(l[0]),
    label(held17_1),
  ].join();
});
say('(require("node:events").prototype) 2', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make17_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype)) };
}
function list17_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype))];
}
function ask17_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held17_2;
function hold17_2() {
  held17_2 = Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype));
}
say('(require("node:events").prototype) 2 far', function () {
  const r = make17_2(),
    l = list17_2();
  hold17_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held17_2 === null,
    typeof held17_2,
    ask17_2(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype))),
    label(r.above),
    label(l[0]),
    label(held17_2),
  ].join();
});
say('(require("node:events").prototype) 3', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype)));
  const kept = {
    above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype))),
  };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make17_3() {
  return {
    above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype))),
  };
}
function list17_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype)))];
}
function ask17_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held17_3;
function hold17_3() {
  held17_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype)));
}
say('(require("node:events").prototype) 3 far', function () {
  const r = make17_3(),
    l = list17_3();
  hold17_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held17_3 === null,
    typeof held17_3,
    ask17_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:events").prototype)))),
    label(r.above),
    label(l[0]),
    label(held17_3),
  ].join();
});
say('(require("node:events").prototype) other', function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(require("node:events").prototype)),
    b: require("node:events").prototype.__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(require("node:events").prototype),
    Function.prototype.isPrototypeOf(require("node:events").prototype),
    require("node:events").prototype instanceof Object,
    require("node:events").prototype instanceof Function,
    "hasOwnProperty" in require("node:events").prototype,
    typeof require("node:events").prototype.hasOwnProperty,
    typeof require("node:events").prototype.call,
  ].join();
});
say('(require("node:timers/promises").setInterval) 1', function () {
  const direct = Object.getPrototypeOf(require("node:timers/promises").setInterval);
  const kept = { above: Object.getPrototypeOf(require("node:timers/promises").setInterval) };
  const list = [Object.getPrototypeOf(require("node:timers/promises").setInterval)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make18_1() {
  return { above: Object.getPrototypeOf(require("node:timers/promises").setInterval) };
}
function list18_1() {
  return [Object.getPrototypeOf(require("node:timers/promises").setInterval)];
}
function ask18_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held18_1;
function hold18_1() {
  held18_1 = Object.getPrototypeOf(require("node:timers/promises").setInterval);
}
say('(require("node:timers/promises").setInterval) 1 far', function () {
  const r = make18_1(),
    l = list18_1();
  hold18_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held18_1 === null,
    typeof held18_1,
    ask18_1(Object.getPrototypeOf(require("node:timers/promises").setInterval)),
    label(r.above),
    label(l[0]),
    label(held18_1),
  ].join();
});
say('(require("node:timers/promises").setInterval) 2', function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make18_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval)) };
}
function list18_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval))];
}
function ask18_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held18_2;
function hold18_2() {
  held18_2 = Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval));
}
say('(require("node:timers/promises").setInterval) 2 far', function () {
  const r = make18_2(),
    l = list18_2();
  hold18_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held18_2 === null,
    typeof held18_2,
    ask18_2(Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval))),
    label(r.above),
    label(l[0]),
    label(held18_2),
  ].join();
});
say('(require("node:timers/promises").setInterval) 3', function () {
  const direct = Object.getPrototypeOf(
    Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval)),
  );
  const kept = {
    above: Object.getPrototypeOf(
      Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval)),
    ),
  };
  const list = [
    Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval))),
  ];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make18_3() {
  return {
    above: Object.getPrototypeOf(
      Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval)),
    ),
  };
}
function list18_3() {
  return [
    Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval))),
  ];
}
function ask18_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held18_3;
function hold18_3() {
  held18_3 = Object.getPrototypeOf(
    Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval)),
  );
}
say('(require("node:timers/promises").setInterval) 3 far', function () {
  const r = make18_3(),
    l = list18_3();
  hold18_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held18_3 === null,
    typeof held18_3,
    ask18_3(
      Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(require("node:timers/promises").setInterval))),
    ),
    label(r.above),
    label(l[0]),
    label(held18_3),
  ].join();
});
say('(require("node:timers/promises").setInterval) other', function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(require("node:timers/promises").setInterval)),
    b: require("node:timers/promises").setInterval.__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(require("node:timers/promises").setInterval),
    Function.prototype.isPrototypeOf(require("node:timers/promises").setInterval),
    require("node:timers/promises").setInterval instanceof Object,
    require("node:timers/promises").setInterval instanceof Function,
    "hasOwnProperty" in require("node:timers/promises").setInterval,
    typeof require("node:timers/promises").setInterval.hasOwnProperty,
    typeof require("node:timers/promises").setInterval.call,
  ].join();
});
say("(Buffer) 1", function () {
  const direct = Object.getPrototypeOf(Buffer);
  const kept = { above: Object.getPrototypeOf(Buffer) };
  const list = [Object.getPrototypeOf(Buffer)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make19_1() {
  return { above: Object.getPrototypeOf(Buffer) };
}
function list19_1() {
  return [Object.getPrototypeOf(Buffer)];
}
function ask19_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held19_1;
function hold19_1() {
  held19_1 = Object.getPrototypeOf(Buffer);
}
say("(Buffer) 1 far", function () {
  const r = make19_1(),
    l = list19_1();
  hold19_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held19_1 === null,
    typeof held19_1,
    ask19_1(Object.getPrototypeOf(Buffer)),
    label(r.above),
    label(l[0]),
    label(held19_1),
  ].join();
});
say("(Buffer) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Buffer));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Buffer)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Buffer))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make19_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Buffer)) };
}
function list19_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Buffer))];
}
function ask19_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held19_2;
function hold19_2() {
  held19_2 = Object.getPrototypeOf(Object.getPrototypeOf(Buffer));
}
say("(Buffer) 2 far", function () {
  const r = make19_2(),
    l = list19_2();
  hold19_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held19_2 === null,
    typeof held19_2,
    ask19_2(Object.getPrototypeOf(Object.getPrototypeOf(Buffer))),
    label(r.above),
    label(l[0]),
    label(held19_2),
  ].join();
});
say("(Buffer) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make19_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer))) };
}
function list19_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer)))];
}
function ask19_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held19_3;
function hold19_3() {
  held19_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer)));
}
say("(Buffer) 3 far", function () {
  const r = make19_3(),
    l = list19_3();
  hold19_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held19_3 === null,
    typeof held19_3,
    ask19_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer)))),
    label(r.above),
    label(l[0]),
    label(held19_3),
  ].join();
});
say("(Buffer) other", function () {
  const kept = { a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(Buffer)), b: Buffer.__proto__.__proto__ };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(Buffer),
    Function.prototype.isPrototypeOf(Buffer),
    Buffer instanceof Object,
    Buffer instanceof Function,
    "hasOwnProperty" in Buffer,
    typeof Buffer.hasOwnProperty,
    typeof Buffer.call,
  ].join();
});
say("(Buffer.alloc(1)) 1", function () {
  const direct = Object.getPrototypeOf(Buffer.alloc(1));
  const kept = { above: Object.getPrototypeOf(Buffer.alloc(1)) };
  const list = [Object.getPrototypeOf(Buffer.alloc(1))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make20_1() {
  return { above: Object.getPrototypeOf(Buffer.alloc(1)) };
}
function list20_1() {
  return [Object.getPrototypeOf(Buffer.alloc(1))];
}
function ask20_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held20_1;
function hold20_1() {
  held20_1 = Object.getPrototypeOf(Buffer.alloc(1));
}
say("(Buffer.alloc(1)) 1 far", function () {
  const r = make20_1(),
    l = list20_1();
  hold20_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held20_1 === null,
    typeof held20_1,
    ask20_1(Object.getPrototypeOf(Buffer.alloc(1))),
    label(r.above),
    label(l[0]),
    label(held20_1),
  ].join();
});
say("(Buffer.alloc(1)) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make20_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1))) };
}
function list20_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1)))];
}
function ask20_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held20_2;
function hold20_2() {
  held20_2 = Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1)));
}
say("(Buffer.alloc(1)) 2 far", function () {
  const r = make20_2(),
    l = list20_2();
  hold20_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held20_2 === null,
    typeof held20_2,
    ask20_2(Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1)))),
    label(r.above),
    label(l[0]),
    label(held20_2),
  ].join();
});
say("(Buffer.alloc(1)) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1))));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1)))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1))))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make20_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1)))) };
}
function list20_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1))))];
}
function ask20_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held20_3;
function hold20_3() {
  held20_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1))));
}
say("(Buffer.alloc(1)) 3 far", function () {
  const r = make20_3(),
    l = list20_3();
  hold20_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held20_3 === null,
    typeof held20_3,
    ask20_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Buffer.alloc(1))))),
    label(r.above),
    label(l[0]),
    label(held20_3),
  ].join();
});
say("(Buffer.alloc(1)) other", function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(Buffer.alloc(1))),
    b: Buffer.alloc(1).__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(Buffer.alloc(1)),
    Function.prototype.isPrototypeOf(Buffer.alloc(1)),
    Buffer.alloc(1) instanceof Object,
    Buffer.alloc(1) instanceof Function,
    "hasOwnProperty" in Buffer.alloc(1),
    typeof Buffer.alloc(1).hasOwnProperty,
    typeof Buffer.alloc(1).call,
  ].join();
});
say("(process) 1", function () {
  const direct = Object.getPrototypeOf(process);
  const kept = { above: Object.getPrototypeOf(process) };
  const list = [Object.getPrototypeOf(process)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make21_1() {
  return { above: Object.getPrototypeOf(process) };
}
function list21_1() {
  return [Object.getPrototypeOf(process)];
}
function ask21_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held21_1;
function hold21_1() {
  held21_1 = Object.getPrototypeOf(process);
}
say("(process) 1 far", function () {
  const r = make21_1(),
    l = list21_1();
  hold21_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held21_1 === null,
    typeof held21_1,
    ask21_1(Object.getPrototypeOf(process)),
    label(r.above),
    label(l[0]),
    label(held21_1),
  ].join();
});
say("(process) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(process));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(process)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(process))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make21_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(process)) };
}
function list21_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(process))];
}
function ask21_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held21_2;
function hold21_2() {
  held21_2 = Object.getPrototypeOf(Object.getPrototypeOf(process));
}
say("(process) 2 far", function () {
  const r = make21_2(),
    l = list21_2();
  hold21_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held21_2 === null,
    typeof held21_2,
    ask21_2(Object.getPrototypeOf(Object.getPrototypeOf(process))),
    label(r.above),
    label(l[0]),
    label(held21_2),
  ].join();
});
say("(process) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make21_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process))) };
}
function list21_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process)))];
}
function ask21_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held21_3;
function hold21_3() {
  held21_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process)));
}
say("(process) 3 far", function () {
  const r = make21_3(),
    l = list21_3();
  hold21_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held21_3 === null,
    typeof held21_3,
    ask21_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(process)))),
    label(r.above),
    label(l[0]),
    label(held21_3),
  ].join();
});
say("(process) other", function () {
  const kept = { a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(process)), b: process.__proto__.__proto__ };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(process),
    Function.prototype.isPrototypeOf(process),
    process instanceof Object,
    process instanceof Function,
    "hasOwnProperty" in process,
    typeof process.hasOwnProperty,
    typeof process.call,
  ].join();
});
say("(Bun) 1", function () {
  const direct = Object.getPrototypeOf(Bun);
  const kept = { above: Object.getPrototypeOf(Bun) };
  const list = [Object.getPrototypeOf(Bun)];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make22_1() {
  return { above: Object.getPrototypeOf(Bun) };
}
function list22_1() {
  return [Object.getPrototypeOf(Bun)];
}
function ask22_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held22_1;
function hold22_1() {
  held22_1 = Object.getPrototypeOf(Bun);
}
say("(Bun) 1 far", function () {
  const r = make22_1(),
    l = list22_1();
  hold22_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held22_1 === null,
    typeof held22_1,
    ask22_1(Object.getPrototypeOf(Bun)),
    label(r.above),
    label(l[0]),
    label(held22_1),
  ].join();
});
say("(Bun) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Bun));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun)) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Bun))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make22_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun)) };
}
function list22_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Bun))];
}
function ask22_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held22_2;
function hold22_2() {
  held22_2 = Object.getPrototypeOf(Object.getPrototypeOf(Bun));
}
say("(Bun) 2 far", function () {
  const r = make22_2(),
    l = list22_2();
  hold22_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held22_2 === null,
    typeof held22_2,
    ask22_2(Object.getPrototypeOf(Object.getPrototypeOf(Bun))),
    label(r.above),
    label(l[0]),
    label(held22_2),
  ].join();
});
say("(Bun) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun)));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun)))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make22_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun))) };
}
function list22_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun)))];
}
function ask22_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held22_3;
function hold22_3() {
  held22_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun)));
}
say("(Bun) 3 far", function () {
  const r = make22_3(),
    l = list22_3();
  hold22_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held22_3 === null,
    typeof held22_3,
    ask22_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Bun)))),
    label(r.above),
    label(l[0]),
    label(held22_3),
  ].join();
});
say("(Bun) other", function () {
  const kept = { a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(Bun)), b: Bun.__proto__.__proto__ };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(Bun),
    Function.prototype.isPrototypeOf(Bun),
    Bun instanceof Object,
    Bun instanceof Function,
    "hasOwnProperty" in Bun,
    typeof Bun.hasOwnProperty,
    typeof Bun.call,
  ].join();
});
say("(async function () {}) 1", function () {
  const direct = Object.getPrototypeOf(async function () {});
  const kept = { above: Object.getPrototypeOf(async function () {}) };
  const list = [Object.getPrototypeOf(async function () {})];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make23_1() {
  return { above: Object.getPrototypeOf(async function () {}) };
}
function list23_1() {
  return [Object.getPrototypeOf(async function () {})];
}
function ask23_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held23_1;
function hold23_1() {
  held23_1 = Object.getPrototypeOf(async function () {});
}
say("(async function () {}) 1 far", function () {
  const r = make23_1(),
    l = list23_1();
  hold23_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held23_1 === null,
    typeof held23_1,
    ask23_1(Object.getPrototypeOf(async function () {})),
    label(r.above),
    label(l[0]),
    label(held23_1),
  ].join();
});
say("(async function () {}) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(async function () {}));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(async function () {})) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(async function () {}))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make23_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(async function () {})) };
}
function list23_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(async function () {}))];
}
function ask23_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held23_2;
function hold23_2() {
  held23_2 = Object.getPrototypeOf(Object.getPrototypeOf(async function () {}));
}
say("(async function () {}) 2 far", function () {
  const r = make23_2(),
    l = list23_2();
  hold23_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held23_2 === null,
    typeof held23_2,
    ask23_2(Object.getPrototypeOf(Object.getPrototypeOf(async function () {}))),
    label(r.above),
    label(l[0]),
    label(held23_2),
  ].join();
});
say("(async function () {}) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(async function () {})));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(async function () {}))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(async function () {})))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make23_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(async function () {}))) };
}
function list23_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(async function () {})))];
}
function ask23_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held23_3;
function hold23_3() {
  held23_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(async function () {})));
}
say("(async function () {}) 3 far", function () {
  const r = make23_3(),
    l = list23_3();
  hold23_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held23_3 === null,
    typeof held23_3,
    ask23_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(async function () {})))),
    label(r.above),
    label(l[0]),
    label(held23_3),
  ].join();
});
say("(async function () {}) other", function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(async function () {})),
    b: async function () {}.__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(async function () {}),
    Function.prototype.isPrototypeOf(async function () {}),
    async function () {} instanceof Object,
    async function () {} instanceof Function,
    "hasOwnProperty" in async function () {},
    typeof async function () {}.hasOwnProperty,
    typeof async function () {}.call,
  ].join();
});
say("(function* () {}) 1", function () {
  const direct = Object.getPrototypeOf(function* () {});
  const kept = { above: Object.getPrototypeOf(function* () {}) };
  const list = [Object.getPrototypeOf(function* () {})];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make24_1() {
  return { above: Object.getPrototypeOf(function* () {}) };
}
function list24_1() {
  return [Object.getPrototypeOf(function* () {})];
}
function ask24_1(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held24_1;
function hold24_1() {
  held24_1 = Object.getPrototypeOf(function* () {});
}
say("(function* () {}) 1 far", function () {
  const r = make24_1(),
    l = list24_1();
  hold24_1();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held24_1 === null,
    typeof held24_1,
    ask24_1(Object.getPrototypeOf(function* () {})),
    label(r.above),
    label(l[0]),
    label(held24_1),
  ].join();
});
say("(function* () {}) 2", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(function* () {}));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(function* () {})) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(function* () {}))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make24_2() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(function* () {})) };
}
function list24_2() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(function* () {}))];
}
function ask24_2(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held24_2;
function hold24_2() {
  held24_2 = Object.getPrototypeOf(Object.getPrototypeOf(function* () {}));
}
say("(function* () {}) 2 far", function () {
  const r = make24_2(),
    l = list24_2();
  hold24_2();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held24_2 === null,
    typeof held24_2,
    ask24_2(Object.getPrototypeOf(Object.getPrototypeOf(function* () {}))),
    label(r.above),
    label(l[0]),
    label(held24_2),
  ].join();
});
say("(function* () {}) 3", function () {
  const direct = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(function* () {})));
  const kept = { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(function* () {}))) };
  const list = [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(function* () {})))];
  return [
    direct === null,
    typeof direct,
    kept.above === null,
    typeof kept.above,
    kept.above == null,
    kept.above === Function.prototype,
    kept.above === Object.prototype,
    list[0] === null,
    typeof list[0],
    kept.above ? 1 : 0,
    label(kept.above),
  ].join();
});
function make24_3() {
  return { above: Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(function* () {}))) };
}
function list24_3() {
  return [Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(function* () {})))];
}
function ask24_3(x) {
  return [x === null, typeof x, x == null, x ? 1 : 0, x === Function.prototype, x === Object.prototype].join();
}
let held24_3;
function hold24_3() {
  held24_3 = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(function* () {})));
}
say("(function* () {}) 3 far", function () {
  const r = make24_3(),
    l = list24_3();
  hold24_3();
  return [
    r.above === null,
    typeof r.above,
    r.above == null,
    r.above === Function.prototype,
    r.above === Object.prototype,
    r.above ? 1 : 0,
    l[0] === null,
    typeof l[0],
    l[0] === Function.prototype,
    held24_3 === null,
    typeof held24_3,
    ask24_3(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(function* () {})))),
    label(r.above),
    label(l[0]),
    label(held24_3),
  ].join();
});
say("(function* () {}) other", function () {
  const kept = {
    a: Reflect.getPrototypeOf(Reflect.getPrototypeOf(function* () {})),
    b: function* () {}.__proto__.__proto__,
  };
  return [
    kept.a === null,
    typeof kept.a,
    kept.b === null,
    typeof kept.b,
    Object.prototype.isPrototypeOf(function* () {}),
    Function.prototype.isPrototypeOf(function* () {}),
    function* () {} instanceof Object,
    function* () {} instanceof Function,
    "hasOwnProperty" in function* () {},
    typeof function* () {}.hasOwnProperty,
    typeof function* () {}.call,
  ].join();
});
