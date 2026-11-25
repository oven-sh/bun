// Records grouped by a field into objects and Maps, counted and sorted by count
function group(words) {
  const byLength = {};
  const byFirst = new Map();
  for (const word of words) {
    (byLength[word.length] ??= []).push(word);
    byFirst.set(word[0], (byFirst.get(word[0]) ?? 0) + 1);
  }
  const ranked = [...byFirst].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).map(([letter, n]) => letter + n);
  return Object.entries(byLength).map(([n, list]) => n + ":" + list.join("+")).join(" ") + " " + ranked.join();
}
console.log(group(["apple", "fig", "pear", "avocado", "plum"]));
console.log(group(["a", "b", "a"]));
console.log(group(["zz"]));
