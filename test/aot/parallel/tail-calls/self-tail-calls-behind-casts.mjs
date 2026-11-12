// A call of the function itself in tail position, behind a cast in a comment, beside calls without it.
/** @param {number} n @param {number} a @returns {number} */
function cast(n, a) {
  if (n === 0) return a;
  if (n % 2 === 1) return cast(n - 1, a);
  return /** @type {number} */ (cast(n - 1, a + 1));
}
function counter(n, a) {
  if (n === 0) return a;
  if (n > 50) return counter(n - 1, a + 1);
  return /** @type {any} */ (counter(n - 1, a));
}
function swapped(n, a, b) {
  if (n === 0) return a * 1000 + b;
  if (n % 2 === 1) return swapped(n - 1, a, b);
  return /** @type {number} */ (/** @type {any} */ (n > 2 ? swapped(n - 1, b, a + 1) : (0, /** @type {number} */ (swapped(n - 1, b + 1, a)))));
}
const arrow = (n, a) => (n === 0 ? a : n % 2 === 1 ? arrow(n - 1, a) : /** @type {number} */ (arrow(n - 1, a + 1)));
function parentheses(n, a) {
  if (n === 0) return a;
  if (n % 2 === 1) return parentheses(n - 1, a);
  return ((parentheses(n - 1, a + 1)));
}
for (const n of [0, 1, 2, 6, 7, 100]) console.log(n, cast(n, 0), counter(n, 0), swapped(n, 1, 2), arrow(n, 0), parentheses(n, 0));
function omitted(n, k, a = "default") {
  if (n === 0) return a + k;
  if (n > 100) return omitted(n - 1, k, a + 1);
  return /** @type {string} */ (omitted(n - 1, k));
}
function fewer(n, a, b) {
  if (n === 0) return `${a} ${b}`;
  if (n > 100) return fewer(n - 1, a, b + 1);
  return /** @type {any} */ (fewer(n - 1));
}
function rest(n, ...all) {
  if (n === 0) return all.join();
  if (n % 2 === 1) return rest(n - 1, ...all);
  return /** @type {any} */ (rest(n - 1, n, ...all));
}
console.log(omitted(2, "!", "given"), omitted(0, "!", "given"), omitted(0, "!"), fewer(2, 1, 2), fewer(0, 1, 2), rest(6));
