// A module is asked for again after every load has settled.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pause = () => new Promise(resolve => setTimeout(resolve, 1));

// Says in which job each of the promises settles.
async function beside(label, start) {
  const seen = [];
  let chain = Promise.resolve();
  for (let turn = 0; turn < 24; turn++) chain = chain.then(() => void seen.push(turn));
  const started = start().map((promise, index) => promise.then(value => (seen.push(label + index), value)));
  const values = await Promise.all(started);
  await chain;
  console.log(label, seen.join(" "));
  return values;
}

const [feature] = await beside("first", () => [import("./feature.mjs")]);
await pause();
const [again, twice] = await beside("again", () => [import("./feature.mjs"), import("./feature.mjs")]);
console.log(again === feature, twice === feature, require("./feature.mjs") === feature, feature.run());
await pause();

// A graph over what has run, and over what ran below it.
const [over] = await beside("over", () => [import("./over.mjs")]);
console.log(over.total);
await pause();
const [below] = await beside("below", () => [import("./below.mjs")]);
console.log(below.value, Object.keys(below).join());
await pause();

// A module above one that awaited runs to its end at once when that one is done.
await beside("waits", () => [import("./waits.mjs")]);
await pause();
const [above] = await beside("above", () => [import("./above.mjs")]);
await pause();
const [aboveAgain] = await beside("above again", () => [import("./above.mjs")]);
console.log(aboveAgain === above, above.total);
await pause();

// A cycle, entered at either end.
const [left] = await beside("cycle", () => [import("./cycle-left.mjs")]);
await pause();
const [right, leftAgain] = await beside("cycle again", () => [import("./cycle-right.mjs"), import("./cycle-left.mjs")]);
console.log(leftAgain === left, left.name(), right.name());
await pause();

// Required first, imported later, and the reverse.
const required = require("./required.mjs");
await pause();
const [imported] = await beside("required", () => [import("./required.mjs")]);
console.log(imported === required, imported.meta);
await pause();

// One that throws is remembered.
for (const label of ["throws", "throws again"]) {
  await beside(label, () => [import("./throws.mjs").catch(error => error.message)]).then(([message]) => console.log(message));
  await pause();
}

// Two graphs at once that share what has run and what has not.
const both = await beside("both", () => [import("./both-one.mjs"), import("./both-two.mjs")]);
console.log(both.map(each => each.total).join());
await pause();
const bothAgain = await beside("both again", () => [import("./both-two.mjs"), import("./shared-by-both.mjs"), import("./both-one.mjs")]);
console.log(bothAgain[0] === both[1], bothAgain[2] === both[0], bothAgain[1].shared);
