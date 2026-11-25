// The same two functions over lists of fractions, with holes, of texts, frozen ones, views, and lists that change their kind on the way.
"use strict";
function water(beds, at, hour) {
  beds[at] = hour | 0;
}
function seen(beds, at) {
  return beds[at] | 0;
}
function tend(beds, count, also) {
  let any = 0;
  for (let k = 0; k < count; k++) {
    any ^= seen(beds, k & 63);
    water(beds, k & 31, any + k);
    if (also !== undefined && k === 40) also(beds);
  }
  return any;
}
const made = f => Array.from({ length: 64 }, (_, n) => f(n));
for (let round = 0; round < 60; round++) tend(made(n => n), 200);
const shown = beds => Array.from(beds.slice(28, 36)).join();
const parts = made(n => n / 2);
console.log(tend(parts, 400), shown(parts));
const gaps = [];
gaps[63] = 1;
console.log(tend(gaps, 40), 5 in gaps, 40 in gaps);
const texts = made(n => "" + n);
console.log(tend(texts, 90), shown(texts));
const large = made(n => 2 ** 31 + n);
console.log(tend(large, 90), shown(large));
for (const view of [new Float64Array(64), new Uint8Array(64).fill(250), new Int16Array(64).fill(-3)]) console.log(tend(view, 100), shown(view));
for (const also of [beds => (beds[50] = 0.5), beds => (beds[50] = "x"), beds => (beds.length = 45), beds => delete beds[60], beds => Object.defineProperty(beds, 60, { get: () => 9, configurable: true })]) {
  const beds = made(n => n * 3);
  console.log(tend(beds, 300, also), shown(beds), beds.length);
}
let words;
try {
  "use strict";
  tend(Object.freeze(made(n => n)), 3);
  words = "none";
} catch (error) {
  words = error.constructor.name;
}
console.log(words, tend({ length: 2, 0: 4 }, 12));
