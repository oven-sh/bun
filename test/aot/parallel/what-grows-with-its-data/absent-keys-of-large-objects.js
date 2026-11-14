// Keys that are no atoms are asked of large objects in turns, under which none of them has a property: an object's names are not listed at each question.
// Sizes: 1000 4000 16000
// Passes: 12
// Grows: linear
const size = Number(process.env.SIZE ?? 500), passes = Number(process.env.PASSES ?? 1);
const asked = [];
function ask(object, first, second) {
  asked[0] = first + second;
  let value;
  for (const key of asked) value = object[key];
  return value;
}
let found = 0;
for (let pass = 0; pass < passes; ++pass) {
  const members = [];
  for (let i = 0; i < size; ++i) members.push('"n' + i + '":1');
  const all = [];
  for (let j = 0; j < 12; ++j) all.push(JSON.parse("{" + members.join() + ',"z' + j + '":1}'));
  for (let i = 0; i < size; ++i) {
    const object = all[i % 12];
    found += object.n1 + object.n2;
    if (ask(object, "k-" + pass, i)) ++found;
    if (ask(object, "a-name-of-another-length-" + pass, i)) ++found;
  }
}
console.log(found === passes * size * 2, all_names());
function all_names() { return Object.keys(JSON.parse('{"a":1}')).length; }
