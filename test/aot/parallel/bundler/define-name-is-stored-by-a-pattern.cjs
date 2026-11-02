// An array pattern, an object pattern, a default, a rest element and the head of a loop store through a defined name whose `--define` value is one name to the `let` of the file that has that name. A shorthand property reads the member of the defined name.
// Flags: --define NAME=target
let target = 0;
globalThis.NAME = "the global of the defined name";
const seen = [];
[NAME] = [1];
seen.push(target);
({ a: NAME } = { a: 2 });
seen.push(target);
({ NAME } = { NAME: 3, target: "the member of the other name" });
seen.push(target);
[NAME = 4] = [];
seen.push(target);
({ NAME = 5 } = {});
seen.push(target);
[[NAME]] = [[6]];
seen.push(target);
[, ...NAME] = [0, 7];
seen.push(target.join());
({
  a: {},
  ...NAME
} = { a: 0, b: 8 });
seen.push(JSON.stringify(target));
for (NAME of [9, 10]);
seen.push(target);
for (NAME in { key: 0 });
seen.push(target);
console.log(seen.join(" "), typeof globalThis.target, globalThis.NAME);
