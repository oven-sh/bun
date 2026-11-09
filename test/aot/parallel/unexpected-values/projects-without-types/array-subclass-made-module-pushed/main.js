import { makers } from "./make.js";
import { attempt, show } from "./show.js";
import { append, appendAll, ends, kept, sorted, total, walked } from "./use.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

const uses = {
  append: list => append(list, 4),
  appendAll: list => appendAll(list, [5, 6]),
  total,
  ends,
  sorted,
  kept,
  walked,
};

function everything(round) {
  for (const maker of Object.keys(makers)) {
    for (const use of Object.keys(uses)) {
      const list = makers[maker]();
      attempt(round + " " + use + "(" + maker + ")", () => show(uses[use](list)) + " leaves " + show(list));
    }
  }
}

attempt("seen append(counting)", () => append(makers.counting(), 4));
attempt("seen append(honest)", () => append(makers.honest(), 4));
everything("early");
let checksum = 0;
for (let i = 0; i < 2000; i++) {
  const list = [i, 1, 2];
  checksum += append(list, i) + appendAll(list, [1, 2]) + total(list) + ends(list)[1] + sorted(list).length + kept(list).length + walked(list).length;
}
console.log("checksum", checksum);
everything("late");
