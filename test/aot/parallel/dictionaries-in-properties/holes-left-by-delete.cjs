// COUNT: operation:operationAOTDeleteByVal <= 40
// COUNT: operation:operationAOTDeleteByValSloppy <= 40
// An element of an ordinary object is deleted in place: a hole stays.
"use strict";
function drop(object, key) {
  return delete object[key];
}
const made = JSON.parse('[{ "0": 1 }, { "0": 1.5, "1": 2 }, { "a": 1 }]');
class Holder {
  constructor() {
    this.name = "h";
  }
}
let text = "";
for (let k = 0; k < 400; k++) {
  for (const object of made) {
    object[k & 7] = k;
    object[(k & 7) + 1] = "s" + k;
    drop(object, k & 7);
    if (k % 80 === 79) text += JSON.stringify(object) + (k & 7 in object) + "\n";
  }
  const holder = new Holder();
  holder[0] = k;
  holder[1] = "one";
  drop(holder, 0);
  if (k % 100 === 99) text += JSON.stringify(holder) + holder[0] + holder[1] + (0 in holder) + Object.keys(holder) + "\n";
}
console.log(text);
const above = Object.create({ 3: "above" });
above[3] = "own";
console.log(above[3], drop(above, 3), above[3], drop(above, 3), drop(above, 9));
const list = [1, 2, 3];
console.log(drop(list, 1), list, list.length, 1 in list);
for (const held of [Object.freeze({ 0: 1 }), Object.seal({ 0: 1, 1: 2 }), Object.preventExtensions({ 0: 1 }), Object.defineProperty({}, 0, { value: 1 }), Object.defineProperty({ 1: 1 }, 1, { get() { return 5; }, configurable: true })]) {
  for (const key of [0, 1, -1, 1.5, 4294967295]) {
    try {
      console.log(drop(held, key), JSON.stringify(Object.getOwnPropertyNames(held)), held[key]);
    } catch (error) {
      console.log(error instanceof TypeError);
    }
  }
}
for (const value of ["text", 5, true, function () {}, Symbol("s"), new Uint8Array(2), new Proxy({ 0: 1 }, { deleteProperty(target, key) { console.log("trap", key); return delete target[key]; } })]) {
  try {
    console.log(drop(value, 0));
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
(function () { console.log(drop(arguments, 0), arguments[0], arguments.length); })(1, 2);
