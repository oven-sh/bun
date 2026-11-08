const words = JSON.parse('{"head":"keys-","tail":"seventeen","seed":"entry-"}');
function fill(count, salt) {
  const made = new Set();
  for (let i = 0; i < count; i++) made.add(words.seed + salt + "-" + i);
  return made;
}
function join(left, right) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const held = [left + right];
  return held[work - 1];
}
function countMisses(sets, key, turns) {
  let misses = 0;
  for (let i = 0; i < turns; i++) if (!sets[i & 7].has(key)) misses++;
  return misses;
}
const sets = [];
for (let salt = 0; salt < 8; salt++) sets.push(fill(40, salt));
const key = join(words.head, words.tail);
console.log(countMisses(sets, key, 4000000));
console.log(key.length, key.charCodeAt(0), key.endsWith("teen"));
