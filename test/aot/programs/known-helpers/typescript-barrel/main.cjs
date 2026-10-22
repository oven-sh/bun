// A barrel as TypeScript 5.9 emits it for CommonJS: `export * from` twice, one level deep and two, and a cycle.
// STATISTIC: KnownHelperFunctions >= 6
// STATISTIC: KnownHelperCalls >= 5
"use strict";
const barrel = require("./index.js");
const describe = object => Reflect.ownKeys(object).map(key => {
  const d = Object.getOwnPropertyDescriptor(object, key);
  return `${String(key)}: ${Object.keys(d).map(name => `${name}=${typeof d[name] === "function" ? String(d[name]) : d[name]}`).join(" ")}`;
}).join("\n");
const attempt = (label, work) => {
  try {
    console.log(label, work());
  } catch (error) {
    console.log(label, "threw", error.constructor.name, error.message);
  }
};
console.log(barrel.ALPHA, barrel.deep, barrel.missing, "BETA" in barrel, "default" in barrel);
console.log(describe(barrel));
console.log(Object.keys(barrel).join());
console.log(barrel.ALPHA, barrel.BETA, barrel.gamma(2), barrel.counter, barrel.deep, barrel.default);
barrel.bump();
console.log(barrel.counter, require("./names.js").counter);
require("./names.js").ALPHA = "changed";
console.log(barrel.ALPHA);
const inner = require("./inner/index.js");
console.log(Object.getOwnPropertyDescriptor(barrel, "deep").get === Object.getOwnPropertyDescriptor(inner, "deep").get);
console.log(JSON.stringify(barrel), JSON.stringify({ ...barrel }));
console.log(require("./cycle-a.js").seen, Object.keys(require("./cycle-a.js")).join(), Object.keys(require("./cycle-b.js")).join());
console.log(require("./cycle-b.js").early, require("./cycle-b.js").seen, require("./cycle-b.js").late, require("./cycle-a.js").sawOfA);
require("./inner/deep.js").deep = "deeper";
console.log(barrel.deep, inner.deep, inner.ALPHA);
attempt("store", () => { barrel.BETA = "mine"; return barrel.BETA; });
attempt("delete", () => delete barrel.BETA);
attempt("redefine", () => Object.defineProperty(barrel, "BETA", { value: "mine" }));
attempt("define the same", () => Object.defineProperty(barrel, "BETA", { enumerable: true }) === barrel);
const names = require("./names.js");
delete names.BETA;
console.log(barrel.BETA, "BETA" in barrel, Object.keys(names).join());
names.BETA = "back";
console.log(barrel.BETA, Object.keys(names).join());
barrel.added = "added";
console.log(Object.keys(barrel).join(), Object.isExtensible(barrel), Object.isFrozen(barrel));
