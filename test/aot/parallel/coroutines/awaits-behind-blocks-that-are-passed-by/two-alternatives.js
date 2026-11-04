async function load(k) { return k > 100; }
async function isOneOrTwo(k, slow) {
  const yes = await (slow ? load(k) : (k === 1 || k === 2));
  console.log("answer " + yes);
}
isOneOrTwo(2, false);
console.log("behind the call");
