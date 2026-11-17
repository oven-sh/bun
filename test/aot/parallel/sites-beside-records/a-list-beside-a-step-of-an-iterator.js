// A list and the record that a step of an iterator gives meet in one field. The list is a list wherever it stands alone.
// Under: --aot-testing=CheckProofsAtRunTime: the class that LinkedFunction::result, LinkedCell::proven and LinkedParameter::proven name of a site whose family holds a record that a row makes
const box = {};
function make(n) { return [n, n + 1, n + 2]; }
function step(n) { return [n].values().next(); }
function total(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return sum; }
box.k = make(1);
box.k = step(7);
box.a = make(2);
console.log(total(box.a), total(make(5)), box.k.done, box.k.value, Array.isArray(box.a), Array.isArray(box.k), Object.keys(box.k).join());
