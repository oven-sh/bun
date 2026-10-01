function f() {
  for (/** lazy in disallow-in @type {number} */ var i = 0; i < 1; i++) {}
}
async function* g() {
  /** eager @see f */
  const x = 1;
  /** lazy2 */
  const y = 2;
}
