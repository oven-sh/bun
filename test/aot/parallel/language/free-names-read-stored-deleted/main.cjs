function report(action) {
  try {
    console.log(action());
  } catch (error) {
    console.log(error.name + ": " + error.message);
  }
}

report(() => neverBound);
console.log(typeof neverBound);

sloppyCreated = 1;
console.log(sloppyCreated, Object.getOwnPropertyDescriptor(globalThis, "sloppyCreated"));

function storeStrict(value) {
  "use strict";
  strictAbsent = value;
}
report(() => storeStrict(1));
console.log(typeof strictAbsent);
globalThis.strictAbsent = 2;
storeStrict(3);
console.log(strictAbsent);

function readChanging() {
  return changing;
}
function storeChanging(value) {
  changing = value;
}
function sumChanging(times) {
  let sum = 0;
  for (let i = 0; i < times; i++) sum += readChanging();
  return sum;
}

globalThis.changing = 1;
console.log(sumChanging(100));
globalThis.changing = 2;
console.log(sumChanging(100));
for (let i = 0; i < 100; i++) storeChanging(i);
console.log(readChanging(), globalThis.changing);

for (let i = 0; i < 40; i++) {
  globalThis["added" + i] = i;
  storeChanging(readChanging() + 1);
}
console.log(readChanging(), added0, added39);

let getterCalls = 0;
Object.defineProperty(globalThis, "changing", {
  get() {
    getterCalls++;
    return 7;
  },
  set(value) {
    console.log("setter", value);
  },
  configurable: true,
});
console.log(sumChanging(10), getterCalls);
storeChanging(8);

Object.defineProperty(globalThis, "changing", { value: 9, writable: false, configurable: true });
console.log(readChanging());
storeChanging(10);
console.log(readChanging());
report(() => {
  "use strict";
  changing = 11;
});

console.log(delete changing);
report(readChanging);
console.log(typeof changing);
storeChanging(12);
console.log(readChanging(), delete changing);

console.log(delete undefined, delete NaN, delete Infinity);
console.log(delete neverBound);
console.log(delete sloppyCreated, typeof sloppyCreated);

globalThis.neverChanged = "stable";
function readNeverChanged() {
  return neverChanged;
}
let stableLength = 0;
for (let i = 0; i < 100; i++) stableLength += readNeverChanged().length;
for (let i = 0; i < 40; i++) globalThis["later" + i] = i;
console.log(stableLength, readNeverChanged());
