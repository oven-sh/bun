const unseen = (0, eval)("(x) => x");
async function load(k) { return k > 100; }
async function isSmallSquare(k, slow) {
  const yes = await (slow ? load(k) : (k === 1 || k === 4 || k === 9));
  console.log("answer " + yes);
}
unseen(isSmallSquare)(4, false);
console.log("behind the call");
