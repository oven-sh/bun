// A literal gets its number out of a field of another object, which the program shows integers. In each case that other field gets something else late, in a way of its own,
// and what the literal holds is read where its shape is known.
"use strict";
const say = v => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "object" : String(v));
const decoded = text => Buffer.from(text, "base64").toString();
const shown = { v: 1 };
const others = JSON.parse(
  decoded(
    Buffer.from(
      '[{"v":0.5},{"v":2147483648},{"v":1099511627776},{"v":-0},{"v":"text"},{"v":null},{"v":{"n":1}},{"v":-2147483644},{"v":1e300},{}]',
    ).toString("base64"),
  ),
);
if (others.length !== 10) others.push(shown);
const reachedName = decoded("cmVhY2hlZA==");
const indexNobodyKnows = Number(decoded("MA=="));
const numberOf = k => k * 0.5 + (k & 1 ? 2147483648 : 0.25);
const kept = [];

const given0 = { port0: 8080, path: "/" };
given0.port0 = 8080;
given0.path = "/";

function keep0(i) {
  const options = { port0: given0.port0, path: given0.path, mark0: i & 3 };
  kept[i & 7] = options;
  return options.port0 + options.path.length + options.mark0;
}
function change0(v) {}
function run0() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change0(others[k].v);
      last = keep0(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port0) + ";";
  }
  console.log("nothing else ever", line);
}
run0();

const given1 = { port1: 8080, path: "/" };
given1.port1 = 8080;
given1.path = "/";

function keep1(i) {
  const options = { port1: given1.port1, path: given1.path, mark1: i & 3 };
  kept[i & 7] = options;
  return options.port1 + options.path.length + options.mark1;
}
function change1(v) {
  given1.port1 = v;
}
function run1() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change1(others[k].v);
      last = keep1(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port1) + ";";
  }
  console.log("a store by name", line);
}
run1();

const given2 = { port2: 8080, path: "/" };
given2.port2 = 8080;
given2.path = "/";

function keep2(i) {
  const options = { port2: given2.port2, path: given2.path, mark2: i & 3 };
  kept[i & 7] = options;
  return options.port2 + options.path.length + options.mark2;
}
function change2(v) {
  given2[decoded("cG9ydDI=")] = v;
}
function run2() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change2(others[k].v);
      last = keep2(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port2) + ";";
  }
  console.log("a store under a key nobody knows", line);
}
run2();

const given3 = { port3: 8080, path: "/" };
given3.port3 = 8080;
given3.path = "/";

function keep3(i) {
  const options = { port3: given3.port3, path: given3.path, mark3: i & 3 };
  kept[i & 7] = options;
  return options.port3 + options.path.length + options.mark3;
}
function change3(v) {
  Object.assign(given3, { port3: v });
}
function run3() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change3(others[k].v);
      last = keep3(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port3) + ";";
  }
  console.log("Object.assign", line);
}
run3();

const given4 = { port4: 8080, path: "/" };
given4.port4 = 8080;
given4.path = "/";

function keep4(i) {
  const options = { port4: given4.port4, path: given4.path, mark4: i & 3 };
  kept[i & 7] = options;
  return options.port4 + options.path.length + options.mark4;
}
function change4(v) {
  Reflect.set(given4, "port4", v);
}
function run4() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change4(others[k].v);
      last = keep4(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port4) + ";";
  }
  console.log("Reflect.set", line);
}
run4();

const given5 = { port5: 8080, path: "/" };
given5.port5 = 8080;
given5.path = "/";

function keep5(i) {
  const options = { port5: given5.port5, path: given5.path, mark5: i & 3 };
  kept[i & 7] = options;
  return options.port5 + options.path.length + options.mark5;
}
function change5(v) {
  Object.defineProperty(given5, "port5", { value: v, writable: true, enumerable: true, configurable: true });
}
function run5() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change5(others[k].v);
      last = keep5(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port5) + ";";
  }
  console.log("a definition", line);
}
run5();

const given6 = { port6: 8080, path: "/" };
given6.port6 = 8080;
given6.path = "/";

function keep6(i) {
  const options = { port6: given6.port6, path: given6.path, mark6: i & 3 };
  kept[i & 7] = options;
  return options.port6 + options.path.length + options.mark6;
}
function change6(v) {
  Object.defineProperty(given6, "port6", { get: () => v, enumerable: true, configurable: true });
}
function run6() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change6(others[k].v);
      last = keep6(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port6) + ";";
  }
  console.log("a getter", line);
}
run6();

const given7 = { port7: 8080, path: "/" };
given7.port7 = 8080;
given7.path = "/";

function keep7(i) {
  const options = { port7: given7.port7, path: given7.path, mark7: i & 3 };
  kept[i & 7] = options;
  return options.port7 + options.path.length + options.mark7;
}
function change7(v) {
  Object.setPrototypeOf(given7, { port7: v });
  delete given7.port7;
}
function run7() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change7(others[k].v);
      last = keep7(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port7) + ";";
  }
  console.log("deleted below a prototype that has the name", line);
}
run7();

const given8 = { port8: 8080, path: "/" };
given8.port8 = 8080;
given8.path = "/";
const before8 = { port8: 8080, path: "/" };
before8.port8 = 8080;
function keep8(i) {
  const options = { port8: given8.port8, path: given8.path, mark8: i & 3 };
  kept[i & 7] = options;
  return options.port8 + options.path.length + options.mark8;
}
function change8(v) {
  before8.port8 = v;
  given8.port8 = before8.port8;
}
function run8() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change8(others[k].v);
      last = keep8(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port8) + ";";
  }
  console.log("through a second field", line);
}
run8();

const given9 = { port9: 8080, path: "/" };
given9.port9 = 8080;
given9.path = "/";
globalThis.reached9 = given9;
function keep9(i) {
  const options = { port9: given9.port9, path: given9.path, mark9: i & 3 };
  kept[i & 7] = options;
  return options.port9 + options.path.length + options.mark9;
}
function change9(v) {
  globalThis[reachedName + "9"].port9 = v;
}
function run9() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change9(others[k].v);
      last = keep9(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port9) + ";";
  }
  console.log("an object that everybody can reach", line);
}
run9();

const given10 = { port10: 8080, path: "/" };
given10.port10 = 8080;
given10.path = "/";

function keep10(i) {
  const options = { port10: given10.port10, path: given10.path, mark10: i & 3 };
  kept[i & 7] = options;
  return options.port10 + options.path.length + options.mark10;
}
function change10(v) {
  Object.assign(given10, { port10: v });
}
function run10() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change10(others[k].v);
      last = keep10(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port10) + ";";
  }
  console.log("a copy onto it", line);
}
run10();

const given11 = { port11: 8080, path: "/" };
given11.port11 = 8080;
given11.path = "/";
const list11 = [given11];
function keep11(i) {
  const options = { port11: given11.port11, path: given11.path, mark11: i & 3 };
  kept[i & 7] = options;
  return options.port11 + options.path.length + options.mark11;
}
function change11(v) {
  list11[indexNobodyKnows].port11 = v;
}
function run11() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change11(others[k].v);
      last = keep11(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port11) + ";";
  }
  console.log("a list that holds it", line);
}
run11();

const given12 = { port12: 8080, path: "/" };
given12.port12 = 8080;
given12.path = "/";

function keep12(i) {
  const options = { port12: given12.port12, path: given12.path, mark12: i & 3 };
  kept[i & 7] = options;
  return options.port12 + options.path.length + options.mark12;
}
function change12(v) {}
function run12() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change12(numberOf(k));
      last = keep12(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port12) + ";";
  }
  console.log("nothing else ever, numbers alone", line);
}
run12();

const given13 = { port13: 8080, path: "/" };
given13.port13 = 8080;
given13.path = "/";

function keep13(i) {
  const options = { port13: given13.port13, path: given13.path, mark13: i & 3 };
  kept[i & 7] = options;
  return options.port13 + options.path.length + options.mark13;
}
function change13(v) {
  given13.port13 = v;
}
function run13() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change13(numberOf(k));
      last = keep13(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port13) + ";";
  }
  console.log("a store by name, numbers alone", line);
}
run13();

const given14 = { port14: 8080, path: "/" };
given14.port14 = 8080;
given14.path = "/";

function keep14(i) {
  const options = { port14: given14.port14, path: given14.path, mark14: i & 3 };
  kept[i & 7] = options;
  return options.port14 + options.path.length + options.mark14;
}
function change14(v) {
  given14[decoded("cG9ydDE0")] = v;
}
function run14() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change14(numberOf(k));
      last = keep14(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port14) + ";";
  }
  console.log("a store under a key nobody knows, numbers alone", line);
}
run14();

const given15 = { port15: 8080, path: "/" };
given15.port15 = 8080;
given15.path = "/";

function keep15(i) {
  const options = { port15: given15.port15, path: given15.path, mark15: i & 3 };
  kept[i & 7] = options;
  return options.port15 + options.path.length + options.mark15;
}
function change15(v) {
  Object.assign(given15, { port15: v });
}
function run15() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change15(numberOf(k));
      last = keep15(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port15) + ";";
  }
  console.log("Object.assign, numbers alone", line);
}
run15();

const given16 = { port16: 8080, path: "/" };
given16.port16 = 8080;
given16.path = "/";

function keep16(i) {
  const options = { port16: given16.port16, path: given16.path, mark16: i & 3 };
  kept[i & 7] = options;
  return options.port16 + options.path.length + options.mark16;
}
function change16(v) {
  Reflect.set(given16, "port16", v);
}
function run16() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change16(numberOf(k));
      last = keep16(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port16) + ";";
  }
  console.log("Reflect.set, numbers alone", line);
}
run16();

const given17 = { port17: 8080, path: "/" };
given17.port17 = 8080;
given17.path = "/";

function keep17(i) {
  const options = { port17: given17.port17, path: given17.path, mark17: i & 3 };
  kept[i & 7] = options;
  return options.port17 + options.path.length + options.mark17;
}
function change17(v) {
  Object.defineProperty(given17, "port17", { value: v, writable: true, enumerable: true, configurable: true });
}
function run17() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change17(numberOf(k));
      last = keep17(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port17) + ";";
  }
  console.log("a definition, numbers alone", line);
}
run17();

const given18 = { port18: 8080, path: "/" };
given18.port18 = 8080;
given18.path = "/";

function keep18(i) {
  const options = { port18: given18.port18, path: given18.path, mark18: i & 3 };
  kept[i & 7] = options;
  return options.port18 + options.path.length + options.mark18;
}
function change18(v) {
  Object.defineProperty(given18, "port18", { get: () => v, enumerable: true, configurable: true });
}
function run18() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change18(numberOf(k));
      last = keep18(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port18) + ";";
  }
  console.log("a getter, numbers alone", line);
}
run18();

const given19 = { port19: 8080, path: "/" };
given19.port19 = 8080;
given19.path = "/";

function keep19(i) {
  const options = { port19: given19.port19, path: given19.path, mark19: i & 3 };
  kept[i & 7] = options;
  return options.port19 + options.path.length + options.mark19;
}
function change19(v) {
  Object.setPrototypeOf(given19, { port19: v });
  delete given19.port19;
}
function run19() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change19(numberOf(k));
      last = keep19(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port19) + ";";
  }
  console.log("deleted below a prototype that has the name, numbers alone", line);
}
run19();

const given20 = { port20: 8080, path: "/" };
given20.port20 = 8080;
given20.path = "/";
const before20 = { port20: 8080, path: "/" };
before20.port20 = 8080;
function keep20(i) {
  const options = { port20: given20.port20, path: given20.path, mark20: i & 3 };
  kept[i & 7] = options;
  return options.port20 + options.path.length + options.mark20;
}
function change20(v) {
  before20.port20 = v;
  given20.port20 = before20.port20;
}
function run20() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change20(numberOf(k));
      last = keep20(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port20) + ";";
  }
  console.log("through a second field, numbers alone", line);
}
run20();

const given21 = { port21: 8080, path: "/" };
given21.port21 = 8080;
given21.path = "/";
globalThis.reached21 = given21;
function keep21(i) {
  const options = { port21: given21.port21, path: given21.path, mark21: i & 3 };
  kept[i & 7] = options;
  return options.port21 + options.path.length + options.mark21;
}
function change21(v) {
  globalThis[reachedName + "21"].port21 = v;
}
function run21() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change21(numberOf(k));
      last = keep21(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port21) + ";";
  }
  console.log("an object that everybody can reach, numbers alone", line);
}
run21();

const given22 = { port22: 8080, path: "/" };
given22.port22 = 8080;
given22.path = "/";

function keep22(i) {
  const options = { port22: given22.port22, path: given22.path, mark22: i & 3 };
  kept[i & 7] = options;
  return options.port22 + options.path.length + options.mark22;
}
function change22(v) {
  Object.assign(given22, { port22: v });
}
function run22() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change22(numberOf(k));
      last = keep22(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port22) + ";";
  }
  console.log("a copy onto it, numbers alone", line);
}
run22();

const given23 = { port23: 8080, path: "/" };
given23.port23 = 8080;
given23.path = "/";
const list23 = [given23];
function keep23(i) {
  const options = { port23: given23.port23, path: given23.path, mark23: i & 3 };
  kept[i & 7] = options;
  return options.port23 + options.path.length + options.mark23;
}
function change23(v) {
  list23[indexNobodyKnows].port23 = v;
}
function run23() {
  let line = "";
  for (let k = 0; k < others.length; k++) {
    let sum = 0;
    let last;
    for (let i = 0; i < 900; i++) {
      if (i === 600) change23(numberOf(k));
      last = keep23(i);
      if (typeof last === "number") sum += last;
    }
    line += say(sum) + "|" + say(last) + "|" + typeof last + "|" + say(kept[3].port23) + ";";
  }
  console.log("a list that holds it, numbers alone", line);
}
run23();
