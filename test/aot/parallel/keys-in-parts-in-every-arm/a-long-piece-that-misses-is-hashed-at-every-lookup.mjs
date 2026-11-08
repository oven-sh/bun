const given = JSON.parse('{"unit":"a","bits":22,"seed":"entry-"}');
function fill(count, salt) {
  const made = new Set();
  for (let i = 0; i < count; i++) made.add(given.seed + salt + "-" + i);
  return made;
}
function cut(text) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return text.substring(work);
}
function countMisses(sets, key, turns) {
  let misses = 0;
  for (let i = 0; i < turns; i++) if (!sets[i & 7].has(key)) misses++;
  return misses;
}
const sets = [];
for (let salt = 0; salt < 8; salt++) sets.push(fill(40, salt));
const piece = cut(given.unit.repeat(1 << given.bits));
console.log(countMisses(sets, piece, 4000), piece.length);
