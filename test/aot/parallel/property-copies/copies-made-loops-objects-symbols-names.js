// Object.assign, spreads and rests copy, in loops and inside try, objects that hold symbols between names; what they make is printed.
const local = Symbol("local");
const other = Symbol("other");
const stores = [];
function show(label, made) {
  console.log(label, Bun.inspect(made).replace(/\s+/g, " "), Reflect.ownKeys(made), Object.keys(made), stores.join());
}
function make0() {
  return { [local]: "s", name0: "n" };
}
for (let turn = 0; turn < 40; turn++) {
  const source = make0();
  let answer;
  try {
    answer = Object.assign({}, source);
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("assigned onto an empty literal", answer);
  }
  stores.length = 0;
}
function make1() {
  return { [local]: "s", name1: "n" };
}
for (let turn = 0; turn < 40; turn++) {
  const source = make1();
  let answer;
  try {
    answer = Object.assign({ z1: 0 }, source);
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("assigned onto a literal", answer);
  }
  stores.length = 0;
}
function make2() {
  return { [local]: "s", name2: "n" };
}
for (let turn = 0; turn < 40; turn++) {
  const source = make2();
  let answer;
  try {
    answer = Object.assign({ z2: 0 }, source, { tail2: 1 }, source);
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("assigned twice onto a literal", answer);
  }
  stores.length = 0;
}
function make3() {
  const made = {};
  made.first3 = 1;
  made[local] = 2;
  made.last3 = 3;
  made[other] = 4;
  made.end3 = 5;
  return made;
}
for (let turn = 0; turn < 40; turn++) {
  const source = make3();
  let answer;
  try {
    answer = Object.assign({}, source);
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("filled key by key, assigned", answer);
  }
  stores.length = 0;
}
function make4() {
  const made = {};
  made.first4 = 1;
  made[local] = 2;
  made.last4 = 3;
  made[other] = 4;
  made.end4 = 5;
  return made;
}
for (let turn = 0; turn < 40; turn++) {
  const source = make4();
  let answer;
  try {
    answer = { before4: 0, ...source, after4: 1 };
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("filled key by key, spread", answer);
  }
  stores.length = 0;
}
function make5() {
  return { [local]: "s", name5: "n" };
}
for (let turn = 0; turn < 40; turn++) {
  const source = make5();
  let answer;
  try {
    answer = { ...source };
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("spread alone", answer);
  }
  stores.length = 0;
}
function make6() {
  return { first6: 1, [local]: 2, last6: 3, [other]: 4, end6: 5 };
}
for (let turn = 0; turn < 40; turn++) {
  const source = make6();
  let answer;
  try {
    ({ first6: stores[0], ...answer } = source);
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("rest", answer);
  }
  stores.length = 0;
}
function make7() {
  return { [other]: 0, first7: 1, [local]: 2, last7: 3 };
}
for (let turn = 0; turn < 40; turn++) {
  const source = make7();
  let answer;
  try {
    ({ [other]: stores[0], ...answer } = source);
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("rest without a symbol", answer);
  }
  stores.length = 0;
}
function make8() {
  return new (class {
    [local] = 1;
    field8 = 2;
    [other] = 3;
    more8 = 4;
  })();
}
for (let turn = 0; turn < 40; turn++) {
  const source = make8();
  let answer;
  try {
    answer = Object.assign({}, source);
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("an instance assigned", answer);
  }
  stores.length = 0;
}
function make10() {
  return { [local]: "s", name10: "n" };
}
for (let turn = 0; turn < 40; turn++) {
  const source = make10();
  let answer;
  try {
    answer = Object.assign({}, { ...source, tail10: turn });
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("a copy of a copy", answer);
  }
  stores.length = 0;
}
function make11() {
  const made = {};
  Object.defineProperty(made, local, { value: 1, enumerable: false, writable: true, configurable: true });
  made.seen11 = 2;
  made[other] = 3;
  made.end11 = 4;
  return made;
}
for (let turn = 0; turn < 40; turn++) {
  const source = make11();
  let answer;
  try {
    answer = Object.assign({}, source);
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("a symbol that is not enumerable", answer);
  }
  stores.length = 0;
}
function make12() {
  return { [local]: "s", name12: "n" };
}
for (let turn = 0; turn < 40; turn++) {
  const source = make12();
  let answer;
  try {
    answer = Object.assign(
      {
        set name12(value) {
          stores.push("name");
        },
        set [local](value) {
          stores.push("local");
        },
      },
      source,
    );
  } catch (error) {}
  if (turn === 0 || turn === 39) {
    show("the source", source);
    show("onto setters", answer);
  }
  stores.length = 0;
}
