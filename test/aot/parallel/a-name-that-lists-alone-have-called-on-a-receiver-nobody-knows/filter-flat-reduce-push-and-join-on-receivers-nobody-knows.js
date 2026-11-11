"use strict";
const kinds = [JSON.parse("[3,[1,[2]],0]"), { filter() { return 1; }, flat() { return 2; }, reduce() { return 3; }, push() { return 4; }, join() { return 5; }, flatMap() { return 6; } }];
function all(x) { return [x.filter(v => v), x.flat(), x.reduce((s, v) => s + v, ""), x.push(9), x.join("-"), x.flatMap(v => [v, v])]; }
let out = "";
for (let t = 0; t < 40; t++) out = JSON.stringify(all(kinds[t % 2])) + (t % 2 ? "" : out.slice(0, 0));
console.log(out, JSON.stringify(all(JSON.parse("[1,[2]]"))));
