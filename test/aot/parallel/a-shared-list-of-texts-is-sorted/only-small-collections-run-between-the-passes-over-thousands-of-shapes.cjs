"use strict";
const churn = () => { let kept = []; for (let i = 0; i < 300000; i++) kept = [i, kept.length]; return kept.length; };
const record = names => JSON.parse("{" + names.map((name, i) => JSON.stringify(name) + ":" + i).join(",") + "}");
const slow = list => { const copy = []; for (const each of list) copy.push(each); return copy.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); };
const shapes = Number(process.argv[2] ?? 4000);
let wrong = 0, sum = 0;
const pass = salt => {
  for (let n = 0; n < shapes; n++) {
    const one = record(["d", "b", "a", "c"].map(letter => letter + salt + "_" + n));
    Object.keys(one);
    const sorted = Object.keys(one).sort(), again = Object.keys(one).sort(), want = slow(Object.keys(one)).join();
    if (sorted.join() !== want || again.join() !== want) wrong++;
    sum += sorted[0].length;
  }
};
for (const salt of ["x", "y", "z", "w"]) { pass(salt); churn(); }
console.log("SAID", wrong, sum);
