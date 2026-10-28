// As its neighbor without "in unknown hands". Here a store under a key that nobody knows may have hit any global, and a function that nobody knows has been handed what require("node:os") answers.
const os = require("node:os");
globalThis[process.argv[5] ?? "nothing"] = JSON.parse(process.argv[6] ?? "0");
const functionNobodyKnows = globalThis[process.argv[7] ?? "Boolean"];
functionNobodyKnows(os);

const kindOf = read => {
  try {
    return typeof read();
  } catch (error) {
    return "throws " + error.message;
  }
};
const digest = pairs => {
  const counts = {};
  const thrown = [];
  for (const [key, kind] of pairs) {
    if (kind.startsWith("throws")) thrown.push(String(key) + ": " + kind);
    else counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return JSON.stringify(counts) + " " + JSON.stringify(thrown);
};

function walk() {
  console.log("keys", digest(Object.keys(os).map(key => [key, kindOf(() => os[key])])));
  console.log("values", kindOf(() => Object.values(os).length));
  console.log("entries", kindOf(() => Object.entries(os).length));
  console.log("spread", kindOf(() => ({ ...os })));
  console.log("assign", kindOf(() => Object.assign({}, os)));
  const inLoop = [];
  for (const key in os) inLoop.push([key, kindOf(() => os[key])]);
  console.log("for-in", digest(inLoop));
  console.log("own keys", digest(Reflect.ownKeys(os).map(key => [key, kindOf(() => Reflect.get(os, key))])));
  console.log("descriptors", kindOf(() => Object.getOwnPropertyDescriptors(os)));
  console.log("JSON", kindOf(() => JSON.stringify(os)));
}

// The analysis comes to the walks long after it has seen the object leave.
let steps = 0;
function level1(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level2(count);
}
function level2(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level3(count);
}
function level3(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level4(count);
}
function level4(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level5(count);
}
function level5(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level6(count);
}
function level6(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level7(count);
}
function level7(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level8(count);
}
function level8(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level9(count);
}
function level9(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level10(count);
}
function level10(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level11(count);
}
function level11(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level12(count);
}
function level12(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level13(count);
}
function level13(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level14(count);
}
function level14(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level15(count);
}
function level15(count) {
  for (let index = 0; index < count; index++) steps += index;
  return level16(count);
}
function level16(count) {
  for (let index = 0; index < count; index++) steps += index;
  return walk();
}
level1(process.argv.length);
