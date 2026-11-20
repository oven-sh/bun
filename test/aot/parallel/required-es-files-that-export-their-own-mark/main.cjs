// What require() returns of an ES module can be extended, also where the module exports __esModule itself.
"use strict";
const taken = {
  true: require("./with-true.mjs"),
  false: require("./with-false.mjs"),
  text: require("./with-text.mjs"),
  star: require("./with-star.mjs"),
  none: require("./without.mjs"),
};
for (const [name, space] of Object.entries(taken))
  console.log(name, Object.isExtensible(space), Object.isSealed(space), Object.isFrozen(space), Reflect.isExtensible(space), String(space.__esModule), Object.keys(space).join());
let count = 0;
for (let turn = 0; turn < 60; turn++) if (Object.isExtensible(require("./in-a-loop.mjs"))) count++;
console.log(count);
