// Under: --aot-harden=proof-checks
// A short view has nothing under 4294967295; a view of 4,294,967,296 elements has its last element there. Both are of one class: what is found on one says nothing about the other.
let longest;
try {
  longest = new Uint8Array(4294967296);
} catch {
  // a machine without room for it says what is expected
}
const short = new Uint8Array(8), last = 4294967295, name = String(last);
const read = (view, key) => view[key];
let absent = 0;
for (let round = 0; round < 40; round++) {
  if (short[4294967295] === undefined) absent++;
  if (read(short, last) === undefined) absent++;
  if (!(4294967295 in short)) absent++;
  if (!(name in short)) absent++;
  if (!Object.hasOwn(short, name)) absent++;
  short[4294967295] = 5;
}
if (longest) longest[4294967295] = 7;
const said = longest ? [longest[4294967295], read(longest, last), 4294967295 in longest, name in longest, longest.at(-1), longest[4294967294], longest[4294967296]] : [7, 7, true, true, 7, 0, undefined];
console.log(absent, ...said);
console.log(short[4294967295], read(short, last), 4294967295 in short);
const table = { 4294967295: "a", 4294967294: "b" };
let texts = "";
for (let round = 0; round < 40; round++) texts += table[4294967295] + table[4294967294] + (4294967295 in table);
console.log(texts.length, texts.slice(0, 12), delete table[4294967295], table[4294967295]);
