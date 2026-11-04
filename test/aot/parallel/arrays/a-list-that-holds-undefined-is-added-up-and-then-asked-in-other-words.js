// One loop adds the elements of a list of numbers and an undefined up. Then the undefined is asked for in other words: by typeof, by == null, from the end, and by for-of.
let out = "";
function note(value) {
  out += String(value) + ";";
}
function nothing() {}
function walk(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  note(sum);
  note(list.findIndex(each => typeof each === "undefined"));
  note(list.findIndex(each => each == null));
  note(list.findLastIndex(each => each === undefined));
  let count = 0;
  for (const each of list) if (each === undefined) count++;
  note(count);
}
walk([-1, 7, [][0]]);
walk(Array.from({ length: 3 }, (each, at) => (at === 1 ? nothing() : 1)));
console.log(out);
