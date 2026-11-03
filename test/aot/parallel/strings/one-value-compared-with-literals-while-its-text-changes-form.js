// One value is compared with several literals, one after the other. It may be no text at all, and the literals differ in length.
// Between two comparisons the text may change its form: a read of a character flattens a rope, and a text that is used as a key takes the characters of the key.
function kindOf(value) {
  if (value === "get") return 1;
  if (value === "put") return 2;
  if (value === "post") return 3;
  if (value === "patch") return 4;
  if (value === "delete") return 5;
  if (value === "p") return 6;
  return 0;
}

function bits(value) {
  let found = 0;
  if (value === "get") found |= 1;
  if (value === "put") found |= 2;
  if (value === "post") found |= 4;
  if (value === "pot") found |= 8;
  if (value === "get") found |= 16;
  return found;
}

const table = { get: 1, put: 2, post: 3 };
const lengthOf = [value => value.length, value => String(value).length][process.argv.length > 99 ? 0 : 1];
let reads = 0;

function bitsAroundReads(text, how) {
  let found = 0;
  if (text === "get") found |= 1;
  if (how === 1) reads += text.charCodeAt(0) | 0;
  if (text === "put") found |= 2;
  if (how === 2) reads += table[text] | 0;
  if (text === "post") found |= 4;
  if (how === 3) reads += lengthOf(text);
  if (text === "get") found |= 8;
  if (text === "put") found |= 16;
  if (text === "post") found |= 32;
  return found;
}

const none = process.argv.length > 99 ? "no" : "";
const words = ["get", "put", "post", "pot", "patch", "delete", "p", "", "gets", "ge", "GET"];
const kinds = {
  flat: word => JSON.parse(JSON.stringify(none + word)),
  rope: word => word.slice(0, 1) + none + word.slice(1),
  ropeOfThree: word => word.slice(0, 1) + word.slice(1, 2) + word.slice(2),
  slice: word => ("<<" + JSON.parse(JSON.stringify(none + word)) + ">>").slice(2, 2 + word.length),
  wide: word => JSON.parse(JSON.stringify("Δ" + word)).slice(1),
  wideRope: word => ("Δ" + word.slice(0, 1)).slice(1) + word.slice(1),
  wideOther: word => word.replace("t", "т"),
};

for (const [kind, make] of Object.entries(kinds)) {
  const answers = [];
  for (const word of words) {
    let sum = 0;
    for (let i = 0; i < 300; ++i) sum += kindOf(make(word)) * 100 + bits(make(word));
    answers.push(sum);
  }
  console.log(kind, answers.join(" "));
}

for (const [kind, make] of Object.entries(kinds)) {
  const answers = [];
  for (let how = 0; how < 4; ++how) {
    let sum = 0;
    for (let i = 0; i < 330; ++i) sum += bitsAroundReads(make(words[i % words.length]), how);
    answers.push(sum);
  }
  console.log(kind, answers.join(" "), reads);
}

const others = [undefined, null, 0, 1.5, NaN, true, false, 10n, Symbol.iterator, {}, [], ["get"], new String("get"), () => "get", { toString: () => "get" }];
console.log(others.map(value => kindOf(value) * 100 + bits(value)).join(" "));

let mixed = 0;
for (let i = 0; i < 3000; ++i) {
  const value = i % 3 === 0 ? others[i % others.length] : kinds[Object.keys(kinds)[i % 7]](words[i % words.length]);
  mixed = (mixed * 31 + kindOf(value) * 100 + bits(value)) | 0;
}
console.log(mixed);
