'use strict';
const beads = JSON.parse('[' + Array.from({ length: 100 }, (_, i) => (i * 7) % 31 + 1).join() + ']');
let knots = 0;
const slack = c => { if (c & 1) { knots++; return taut; } return slack; };
const taut = c => (c & 2 ? taut : c & 4 ? frayed : slack);
const frayed = c => (c & 1 ? taut : frayed);
function pull(list, t) {
  let state = slack;
  knots = 0;
  for (let i = 0; i < list.length; i++) state = state(list[i] + (t & 1));
  return knots + (state === taut ? 1 : 0);
}
const holed = [1, , 3, 5];
const texts = [1, "2", 3];
const seen = [];
const watched = [1, 2, 4];
Object.defineProperty(watched, 1, { get() { seen.push("read"); watched.length = 2; return 7; } });
let sum = 0;
for (let t = 0; t < 400; t++) sum = (sum + pull(beads, t)) % 1000003;
console.log(sum, pull(holed, 0), pull(holed, 1), pull(texts, 0), pull(texts, 1), pull(watched, 0), seen.join(), pull([], 0));
