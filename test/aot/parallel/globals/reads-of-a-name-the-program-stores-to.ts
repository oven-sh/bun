// A read of a global name that the program also stores to: before the name exists, before its first store, behind a delete, behind a change to an accessor, in a loop.
declare var storedFirst: number;
declare var readFirst: number;
declare var neverThere: number;
declare var deletedThenStored: number;
declare var madeAnAccessor: number;
declare var frozenLater: number;
const global = globalThis as any;

function readAbsent() {
  try {
    return neverThere;
  } catch (error) {
    return (error as Error).name;
  }
}
console.log(readAbsent());
function storeAbsent(value: number) {
  neverThere = value;
}
global.neverThere = 1;
console.log(readAbsent());
storeAbsent(2);
console.log(readAbsent());

global.storedFirst = 0;
storedFirst = 1;
function bump() {
  storedFirst = storedFirst + 1;
  return storedFirst;
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += bump();
console.log(sum, storedFirst);
global.storedFirst = "text";
console.log(bump());

global.readFirst = 5;
function readIt() {
  return readFirst;
}
for (let i = 0; i < 3; i++) console.log(readIt());
function storeIt(value: number) {
  readFirst = value;
}
storeIt(6);
console.log(readIt());
global.readFirst = 7;
console.log(readIt());

global.deletedThenStored = 1;
function readDeleted() {
  try {
    return deletedThenStored;
  } catch (error) {
    return (error as Error).name;
  }
}
function storeDeleted(value: number) {
  deletedThenStored = value;
}
console.log(readDeleted());
storeDeleted(2);
console.log(readDeleted());
delete global.deletedThenStored;
console.log(readDeleted());
global.other = 1;
global.deletedThenStored = 3;
console.log(readDeleted());
storeDeleted(4);
console.log(readDeleted());

global.madeAnAccessor = 1;
function readAccessor() {
  return madeAnAccessor;
}
function storeAccessor(value: number) {
  madeAnAccessor = value;
}
storeAccessor(2);
console.log(readAccessor());
let inner = 10;
Object.defineProperty(global, "madeAnAccessor", { get: () => inner++, set: value => (inner = value), configurable: true });
console.log(readAccessor(), readAccessor());
storeAccessor(20);
console.log(readAccessor());

global.frozenLater = 1;
function readFrozen() {
  return frozenLater;
}
function storeFrozen(value: number) {
  "use strict";
  try {
    frozenLater = value;
  } catch (error) {
    console.log((error as Error).name);
  }
}
storeFrozen(2);
console.log(readFrozen());
Object.defineProperty(global, "frozenLater", { writable: false });
storeFrozen(3);
console.log(readFrozen());
