const ages = new Map([
  ["ann", 30],
  ["bob", 25],
  ["cy", 41],
  ["dee", 19],
]);
const members = new Set(["ann", "bob", "cy", "dee"]);
const written = ["ann", "bob", "cy", "dee", "eve", ""];
const joined = ["a" + "n".repeat(2), ["b", "o", "b"].join(""), "cyan".slice(0, 2), "DEE".toLowerCase(), "e" + "ve", ""];
const parsed: string[] = JSON.parse('["ann","bob","cy","dee","eve",""]');
const keysOfAnObject = Object.keys({ ann: 1, bob: 2, cy: 3, dee: 4, eve: 5, "": 6 });

function sumOfAges(names: string[], turns: number) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += ages.get(names[turn % names.length]!) ?? -1;
  return sum;
}
function countOfMembers(names: string[], turns: number) {
  let count = 0;
  for (let turn = 0; turn < turns; turn++) if (members.has(names[turn % names.length]!)) count++;
  return count;
}
function countOfKeys(names: string[], turns: number) {
  let count = 0;
  for (let turn = 0; turn < turns; turn++) if (ages.has(names[turn % names.length]!)) count++;
  return count;
}
const all = () => {
  for (const names of [written, joined, parsed, keysOfAnObject])
    console.log(sumOfAges(names, 600), countOfMembers(names, 600), countOfKeys(names, 600));
};
all();
all();

ages.delete("bob");
members.delete("cy");
all();
ages.set("b" + "ob", 26);
members.add("c" + "y");
all();
ages.set("eve", 7).set("", 8);
members.add("eve").add("");
all();

const mixed = new Map<unknown, number>([
  ["1", 10],
  ["two", 20],
]);
mixed.set(1, 11).set(null, 12).set(undefined, 13).set(Symbol.iterator, 14).set(mixed, 15).set(2n, 16).set(1.5, 17);
const askedOfMixed = ["1", 1, "two", "t" + "wo", null, undefined, Symbol.iterator, mixed, 2n, 1.5, "1.5", "null"];
function sumOfMixed(turns: number) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += mixed.get(askedOfMixed[turn % askedOfMixed.length]) ?? -1;
  return sum;
}
function sumOfMixedByTexts(names: string[], turns: number) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += mixed.get(names[turn % names.length]!) ?? -1;
  return sum;
}
console.log(sumOfMixed(1200), sumOfMixedByTexts(["1", "two", "1.5", "null", "undefined"], 1000));
console.log(sumOfMixedByTexts([String(1), "tw" + "o", String(1.5), String(null), String(undefined)], 1000));

const many = new Map<string, number>();
const namesOfMany: string[] = [];
const otherNamesOfMany: string[] = [];
for (let k = 0; k < 300; k++) {
  namesOfMany.push("name" + k);
  otherNamesOfMany.push("name" + k);
  if (k % 3) many.set(namesOfMany[k]!, k);
}
function sumOfMany(names: string[], turns: number) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += many.get(names[turn % names.length]!) ?? -1;
  return sum;
}
console.log(sumOfMany(namesOfMany, 3000), sumOfMany(otherNamesOfMany, 3000));
for (let k = 0; k < 300; k += 5) many.delete(otherNamesOfMany[k]!);
console.log(sumOfMany(namesOfMany, 3000), sumOfMany(otherNamesOfMany, 3000));
