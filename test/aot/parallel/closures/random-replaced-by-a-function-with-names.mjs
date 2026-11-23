// Math.random is written over by one closure that has properties of its own, and is called in loops, as a value and behind another name; the program puts the old value back at the end.
const before = Math.random, sameBefore = Object.getOwnPropertyDescriptor(Math, "random");
const makeRandom = start => {
  let state = start;
  const next = () => { next.calls++; state = (state * 40503 + 12345) % 65536; return state / 65536; };
  next.calls = 0; next.label = "seeded " + start;
  return next;
};
Math.random = makeRandom(7);
const draws = count => { let sum = 0; for (let k = 0; k < count; k++) sum += Math.random(); return sum; };
const picks = (list, count) => { let text = ""; for (let k = 0; k < count; k++) text += list[Math.floor(Math.random() * list.length)]; return text; };
const behind = (random, count) => { let low = 0; for (let k = 0; k < count; k++) if (random() < 0.5) low++; return low; };
const shuffled = list => { for (let k = list.length - 1; k > 0; k--) { const other = Math.floor(Math.random() * (k + 1)); [list[k], list[other]] = [list[other], list[k]]; } return list; };
const lines = [];
for (let round = 0; round < 4; round++) {
  lines.push(draws(10 * round + 3).toFixed(9), picks("abcdefgh", 12), picks([1, 2, 3], 9), behind(Math.random, 20), shuffled([1, 2, 3, 4, 5, 6, 7, 8]).join(""), Math.random.calls, Math.random.label, Math.random.length, typeof Math.random.name);
  const { random } = Math; lines.push(behind(random, 5), random === Math.random, random.calls);
  lines.push([3, 1, 2].map(Math.random).map(value => value.toFixed(6)).join(), Array.from({ length: 3 }, Math.random).length, Math["random"]().toFixed(6), Reflect.apply(Math.random, null, []).toFixed(6));
  Math.random.calls = round * 100;
}
const kept = Math.random;
Math.random = () => 0.25;
lines.push(draws(4), picks("xyz", 3), kept.calls, kept().toFixed(6));
Math.random = kept;
lines.push(draws(2).toFixed(9), Math.random.calls);
delete Math.random.label;
lines.push(Math.random.label, Object.keys(Math.random).join());
Math.random = before;
lines.push(Math.random === before, Math.random() < 1, Object.getOwnPropertyDescriptor(Math, "random").enumerable === sameBefore.enumerable, Math.random.calls);
console.log(lines.join("\n"));
