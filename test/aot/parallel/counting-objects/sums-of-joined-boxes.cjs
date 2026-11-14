// STATISTIC: JoinsCarriedBoxed >= 3
// A number that lies boxed, or a small integer in its place, goes through a join to a sum that is boxed again.
const values = [1, 2147483647, -2147483648, 0.5, -0, 9007199254740991, 1e300, NaN, -Infinity, 41];
const words = JSON.parse('["a","b","c","d","e","f","g","h","i","j"]');
const show = x => (Object.is(x, -0) ? "-0" : String(x));
function add(map, list) {
  for (const word of list) map.set(word, (map.get(word) ?? 0) + 1);
}
function subtract(map, list) {
  for (const word of list) map.set(word, (map.get(word) ?? 2147483647) - 2);
}
function step(map, list) {
  for (const word of list) {
    let now = map.get(word) ?? -2147483648;
    now--;
    map.set(word, now);
  }
}
function turned(map, list) {
  for (const word of list) map.set(word, 5 - (map.get(word) ?? -0));
}
function run(change) {
  const map = new Map();
  for (let k = 0; k < values.length; k++) if (k % 3) map.set(words[k], values[k]);
  for (let k = 0; k < 4; k++) change(map, words);
  return [...map].map(([word, number]) => word + show(number)).join(" ");
}
function count(list) {
  const r = {};
  for (const word of list) r[word] = (r[word] ?? 0) + 1;
  return r;
}
for (let k = 0; k < 3; k++) console.log(run(add), run(subtract), run(step), run(turned), JSON.stringify(count(words.concat(words, "a"))));
