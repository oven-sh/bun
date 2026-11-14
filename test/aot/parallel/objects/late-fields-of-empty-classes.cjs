// STATISTIC: FieldsOutOfLine <= 4
// Objects of a class whose constructor stores nothing have room for six properties, so late fields lie in them, also where most objects get none.
"use strict";
class Mark {}
class Listed {
  first = 1;
}
function fill(mark, n) {
  mark.red = n;
  mark.green = n * 2;
  mark.blue = "b" + n;
  mark.seen = n & 1 ? undefined : n;
}
function fillListed(listed, n) {
  listed.second = n;
  listed.third = n + 0.5;
  listed.fourth = null;
}
const marks = [], lists = [];
for (let i = 0; i < 40; i++) {
  marks.push(new Mark());
  lists.push(new Listed());
  if (i % 5 === 0) fill(marks[i], i);
  if (i % 7 === 3) fillListed(lists[i], i);
}
const show = object => Object.entries(object).map(([key, value]) => key + "=" + value).join(" ");
let sum = 0;
for (let round = 0; round < 20; round++)
  for (let i = 0; i < 40; i++) sum += (marks[i].red ?? 1) + (marks[i].green ?? 2) + (lists[i].second ?? 3) + (lists[i].third ?? 4) + lists[i].first;
console.log(sum);
console.log(marks.slice(0, 11).map(show).join(" | "));
console.log(lists.slice(0, 11).map(show).join(" | "));
delete marks[5].green;
marks[5].green = "again";
Object.freeze(marks[10]);
try {
  fill(marks[10], 99);
} catch (error) {
  console.log(error.constructor.name);
}
Object.preventExtensions(marks[11]);
try {
  fill(marks[11], 99);
} catch (error) {
  console.log(error.constructor.name);
}
marks[12].blue = 1;
fill(marks[12], 12);
Object.defineProperty(marks[13], "green", { get: () => "got", set(value) { this.kept = value; }, enumerable: true, configurable: true });
fill(marks[13], 13);
console.log([5, 10, 11, 12, 13].map(i => show(marks[i])).join(" | "), "red" in marks[1], marks[1].hasOwnProperty("blue"), JSON.stringify({ ...marks[15] }));
