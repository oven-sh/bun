async function load(k) { return k.length > 100; }
async function isVowel(k, slow) {
  const yes = await (slow ? load(k) : (k === "a" || k === "e" || k === "i"));
  console.log("answer " + yes);
}
isVowel("e", false);
console.log("behind the call");
