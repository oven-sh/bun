// One loop adds the elements of a list up, a second counts those that are undefined. The list holds numbers and an undefined, so its storage holds any value.
// Behind a test for storage of doubles the second loop has nothing to count. A list in other storage must not come into that code behind the first loop.
let out = "";
function note(value) {
  out += String(value) + ";";
}
function nothing() {}
function walk(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  note(sum);
  let count = 0;
  for (let i = 0; i < list.length; i++) if (list[i] === undefined) count++;
  note(count);
}
walk([-1, 7, [][0]]);
walk(Array.from({ length: 3 }, (each, at) => (at === 1 ? nothing() : 1)));
console.log(out);
