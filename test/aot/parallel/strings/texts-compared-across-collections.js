// One text compared with several literals, with something between the comparisons that collects, makes the text an atom or flattens it. The texts are made at run time and nobody else holds them.
const box = JSON.parse("[0]");
function hidden(value) { box[0] = value; return box[0]; }
const words = JSON.parse('["lit_aa","lit_ab","lit_ac","lit_ad","abc_zz","xyz_yy","qrs_tt","other1","lit_a","lit_aaa",""]');
const probe = Object.create(null);
let junk = [];
function collect() { junk = []; for (let i = 0; i < 40; i++) junk.push({ i, text: "j" + i }); Bun.gc(true); }
function allocate() { junk = []; for (let i = 0; i < 200; i++) junk.push([i, "k" + i]); }

const makers = {
  flat(word) { return Buffer.from(word, "latin1").toString("latin1"); },
  rope(word) { return hidden(word.slice(0, 3)) + hidden(word.slice(3)); },
  ropeOfThree(word) { return hidden(word.slice(0, 1)) + hidden(word.slice(1, 4)) + hidden(word.slice(4)); },
  wide(word) { return (hidden(word) + hidden("Ж")).slice(0, word.length); },
  wideFlat(word) { return Buffer.from(word + "Ж", "utf16le").toString("utf16le").slice(0, word.length); },
  substring(word) { return (hidden("................................") + hidden(word) + hidden("................................")).slice(32, 32 + word.length); },
  substringOfFlat(word) { return Buffer.from("................................" + word + "........", "latin1").toString("latin1").substring(32, 32 + word.length); },
  atom(word) { const made = Buffer.from(word, "latin1").toString("latin1"); probe[made] = 1; delete probe[made]; return made; },
};

function nothingBetween(s) {
  let r = 0;
  if (s === "lit_aa") r ^= 1;
  if (s === "lit_ab") r ^= 2;
  if (s === "abc_zz") r ^= 4;
  if (s === "xyz_yy") r ^= 8;
  if (s === "qrs_tt") r ^= 16;
  return r;
}
function collectionsBetween(s) {
  let r = 0;
  if (s === "lit_aa") r ^= 1;
  collect();
  if (s === "lit_ab") r ^= 2;
  collect();
  if (s === "abc_zz") r ^= 4;
  collect();
  if (s === "xyz_yy") r ^= 8;
  if (s === "qrs_tt") r ^= 16;
  return r;
}
function allocationsBetween(s) {
  let r = 0;
  if (s === "lit_aa") r ^= 1;
  allocate();
  if (s === "lit_ab") r ^= 2;
  allocate();
  if (s === "abc_zz") r ^= 4;
  allocate();
  if (s === "xyz_yy") r ^= 8;
  if (s === "qrs_tt") r ^= 16;
  return r;
}
function becomesAnAtomBetween(s) {
  let r = 0;
  if (s === "lit_aa") r ^= 1;
  if (probe[s] !== undefined) r ^= 32;
  collect();
  if (s === "lit_ab") r ^= 2;
  if (s === "abc_zz") r ^= 4;
  collect();
  if (s === "xyz_yy") r ^= 8;
  if (s === "qrs_tt") r ^= 16;
  return r;
}
function isFlattenedBetween(s) {
  let r = 0;
  if (s === "lit_aa") r ^= 1;
  r ^= s.charCodeAt(0) & 64;
  collect();
  if (s === "lit_ab") r ^= 2;
  if (s === "abc_zz") r ^= 4;
  collect();
  if (s === "xyz_yy") r ^= 8;
  if (s === "qrs_tt") r ^= 16;
  return r;
}
let kept = null;
function objectsMadeBetween(s) {
  let r = 0;
  if (s === "lit_aa") r ^= 1;
  kept = { r, next: kept === null || r > 100 ? null : { r } };
  if (s === "lit_ab") r ^= 2;
  kept = [r, r + 1, { r }];
  if (s === "abc_zz") r ^= 4;
  kept = { a: r, b: [r], c: { d: r } };
  if (s === "xyz_yy") r ^= 8;
  kept = "" + r + kept.a;
  if (s === "qrs_tt") r ^= 16;
  return r;
}
function objectsMadeBetweenInALoop(s, turns) {
  let r = 0;
  for (let i = 0; i < turns; i++) {
    if (s === "lit_aa") r += 1;
    kept = { r, i };
    if (s === "abc_zz") r += 2;
    kept = [kept, i];
    if (s === "xyz_yy") r += 3;
    if (s === "qrs_tt") r += 4;
  }
  return r;
}
function ofAnything(list, i) {
  const c = list[i];
  let r = 0;
  if (c === "lit_aa") r ^= 1;
  if (c === "lit_ab") r ^= 2;
  list[i] = null;
  collect();
  if (c === "abc_zz") r ^= 4;
  if (c === "xyz_yy") r ^= 8;
  collect();
  if (c === "qrs_tt") r ^= 16;
  return r;
}
const rounds = JSON.parse("3");
for (const [name, make] of Object.entries(makers)) {
  const sums = [];
  for (const compare of [nothingBetween, collectionsBetween, allocationsBetween, becomesAnAtomBetween, isFlattenedBetween, objectsMadeBetween, s => objectsMadeBetweenInALoop(s, 300)]) {
    let sum = 0;
    for (let round = 0; round < rounds; round++) for (const word of words) sum = (sum * 31 + compare(make(word))) | 0;
    sums.push(sum);
  }
  let sum = 0;
  for (let round = 0; round < rounds; round++) for (const word of words) sum = (sum * 31 + ofAnything([make(word), 5, null, {}], 0) + ofAnything([5, make(word)], 0)) | 0;
  sums.push(sum);
  console.log(name, sums.join(" "));
}
