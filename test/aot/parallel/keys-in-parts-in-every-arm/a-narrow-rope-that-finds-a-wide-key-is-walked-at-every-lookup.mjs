const words = JSON.parse('{"left":"alphabet-soup-with-noodles-and-croutons-","right":"served-in-a-bowl-of-the-finest-porcelain","text":"alphabet-soup-with-noodles-and-croutons-served-in-a-bowl-of-the-finest-porcelain \\u03b1"}');
function fill(text) {
  const made = new Map();
  for (let i = 0; i < 2; i++) made.set(text.substring(0, 80 - i), i);
  return made;
}
function join(left, right) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const held = [left + right];
  return held[work - 1];
}
function countHits(maps, key, turns) {
  let hits = 0;
  for (let i = 0; i < turns; i++) if (maps[i & 1].get(key) === 0) hits++;
  return hits;
}
const maps = [fill(words.text), fill(words.text)];
const key = join(words.left, words.right);
console.log(countHits(maps, key, 4000000));
console.log(key.length, key === words.text.substring(0, 80));
