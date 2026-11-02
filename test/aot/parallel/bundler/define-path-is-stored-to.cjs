// A store, an update, a compound and a logical assignment, a pattern and the head of a loop through a defined name whose `--define` value is a dotted path store to the member of the `const` of the file, or of the parameter, that has the first name of the path.
// Flags: --define ROOT=holder.value
const holder = { value: 0 };
globalThis.holder = { value: "the global" };
globalThis.ROOT = "the global of the defined name";
const seen = [];
ROOT = 1;
ROOT++;
ROOT += 5;
seen.push(holder.value);
ROOT &&= 8;
ROOT ||= 9;
seen.push(holder.value);
[ROOT] = [10];
seen.push(holder.value);
({ a: ROOT } = { a: 11 });
seen.push(holder.value);
({ ROOT } = { ROOT: 12 });
seen.push(holder.value);
[ROOT = 13] = [];
seen.push(holder.value);
for (ROOT of [14, 15]);
seen.push(holder.value);
for (ROOT in { key: 0 });
seen.push(holder.value);
function ofTheParameter(holder) {
  ROOT = "stored to the parameter";
  return holder.value;
}
seen.push(ofTheParameter({}));
console.log(seen.join(" "), "|", holder.value, globalThis.holder.value, globalThis.ROOT);
