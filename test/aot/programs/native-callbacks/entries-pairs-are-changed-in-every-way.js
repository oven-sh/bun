// The pairs that Object.entries has made grow, get holes, shrink, take numbers alone, are reversed, shifted, frozen, mixed with other arrays, lose an element and get another prototype.
const log = [];
const source = { a: 1, b: 2, c: 3 };
const grown = Object.entries(source); for (const pair of grown) { pair.push(pair[1] * 0.5); pair[5] = "far"; } log.push(JSON.stringify(grown));
const shrunk = Object.entries(source); for (const pair of shrunk) { pair.length = 1; pair.push(1.5); } log.push(JSON.stringify(shrunk));
const numbers = Object.entries(source); for (const pair of numbers) { pair[0] = 1; pair[1] = 2; pair.reverse(); } log.push(JSON.stringify(numbers), numbers[0][0] + numbers[0][1]);
const shifted = Object.entries(source); for (const pair of shifted) { pair.shift(); pair.unshift(0.25, -0); } log.push(JSON.stringify(shifted), Object.is(shifted[1][1], -0));
const frozen = Object.entries(source).map(Object.freeze); try { "use strict"; frozen[0][0] = "no"; } catch (error) { log.push(error.constructor.name); } log.push(frozen[0][0], Object.isFrozen(frozen[2]));
const mixed = [...Object.entries(source), [1, 2], [0.5, 1.5], ["s", {}]]; let sum = ""; for (const pair of mixed) sum += typeof pair[0] + typeof pair[1] + pair.length; log.push(sum);
const deleted = Object.entries(source); delete deleted[0][0]; log.push(0 in deleted[0], deleted[0].length, String(deleted[0][0]));
const reparented = Object.entries(source); Object.setPrototypeOf(reparented[0], { get 7() { return "seven"; }, length: "not mine" }); log.push(reparented[0][7], reparented[0].length, Array.isArray(reparented[0]), typeof reparented[0].map);
console.log(log.join(" | "));
