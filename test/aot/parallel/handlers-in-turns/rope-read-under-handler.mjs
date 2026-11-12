// What a block under a handler reads of a rope is not known where the handler comes back. Under proof checks this program did not build.
/** @param {string} c @param {number} count @returns {any} */
function find2(c, count) {
  let total = 0;
  let found;
  let fuel = 0;
  let i1 = 0;
  while (i1 < c.length) {
    if (++fuel > 400) return "fuel";
    if (typeof c[i1] === "string") total += 3;
    try {
      found = c[count - 1 - i1];
      if (c[i1] != null) {
        break;
      }
    } catch {
      total += 5;
    }
    i1++;
  }
  return total;
}
globalThis.find2 = find2;
console.log(globalThis.find2([1, 2], JSON.parse("8")), globalThis.find2("a" + JSON.parse("12"), 3), globalThis.find2("", 1));
