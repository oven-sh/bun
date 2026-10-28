// As its neighbor without "in unknown hands". Here a store under a key that nobody knows may have hit any global, and a function that nobody knows has been handed the namespace of node:util.
import * as util from "node:util";
globalThis[process.argv[5] ?? "nothing"] = JSON.parse(process.argv[6] ?? "0");
const functionNobodyKnows = globalThis[process.argv[7] ?? "Boolean"];
functionNobodyKnows(util);

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
  console.log("keys", digest(Object.keys(util).map(key => [key, kindOf(() => util[key])])));
  console.log("values", kindOf(() => Object.values(util).length));
  console.log("entries", kindOf(() => Object.entries(util).length));
  console.log("spread", kindOf(() => ({ ...util })));
  console.log("assign", kindOf(() => Object.assign({}, util)));
  const inLoop = [];
  for (const key in util) inLoop.push([key, kindOf(() => util[key])]);
  console.log("for-in", digest(inLoop));
  console.log("own keys", digest(Reflect.ownKeys(util).map(key => [key, kindOf(() => Reflect.get(util, key))])));
  console.log("descriptors", kindOf(() => Object.getOwnPropertyDescriptors(util)));
  console.log("JSON", kindOf(() => JSON.stringify(util)));
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
