// One text is compared with several literals in a row, and what was found so far is carried from one comparison to the next.
// A flat 8-bit text is compared where it lies. A rope, a slice of a longer text and a 16-bit text are handed to the run time at every comparison.
function flags(text) {
  let found = 0;
  if (text === "lit_aa") found ^= 1;
  if (text === "lit_ab") found ^= 2;
  if (text === "lit_ac") found ^= 4;
  if (text === "lit_ad") found ^= 8;
  return found;
}

function flagsOfTwo(first, second, start) {
  let found = start;
  if (first === "lit_aa") found += 1;
  if (second === "lit_ab") found += 10;
  if (first === "lit_ac") found += 100;
  if (second === "lit_ad") found += 1000;
  return found + first.length * 10000 + second.length * 100000;
}

const head = process.argv.length > 99 ? "no" : "lit_";
const tails = ["aa", "ab", "ac", "ad", "ae", "a", "aaa", ""];
const kinds = {
  flat: tail => JSON.parse(JSON.stringify(head + tail)),
  rope: tail => head + tail,
  ropeOfThree: tail => head.slice(0, 2) + head.slice(2) + tail,
  slice: tail => ("<<" + JSON.parse(JSON.stringify(head + tail)) + ">>").slice(2, 2 + head.length + tail.length),
  wide: tail => JSON.parse(JSON.stringify("Δ" + head + tail)).slice(1),
  wideRope: tail => ("Δ" + head).slice(1) + tail,
  wideOther: tail => head + tail.replace("a", "а"),
};

for (const [kind, make] of Object.entries(kinds)) {
  const sums = [];
  for (const tail of tails) {
    let sum = 0;
    for (let i = 0; i < 3000; ++i) sum += flags(make(tail));
    sums.push(sum);
  }
  console.log(kind, sums.join(" "));
}

for (const [kind, make] of Object.entries(kinds)) {
  for (const [otherKind, makeOther] of Object.entries(kinds)) {
    let sum = 0;
    for (let i = 0; i < 400; ++i) sum += flagsOfTwo(make(tails[i & 7]), makeOther(tails[(i >> 3) & 7]), i & 1);
    console.log(kind, otherKind, sum);
  }
}
