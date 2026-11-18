// The same with unseen code in between: the list and the record go through a function that nobody has seen, so a call that has called unseen code hands them on to the program's own functions.
// Under: --aot-testing=CheckProofsAtRunTime: the class that LinkedFunction::result, LinkedCell::proven and LinkedParameter::proven name of a site whose family holds a record that a row makes
const hidden = JSON.parse('{"call":"call"}');
function make(n) { return [n, n * 2]; }
function step(n) { return [n].values().next(); }
function keep(x) { kept.push(x); return x; }
const kept = [];
function through(f, x) { return f[hidden.call](null, x); }
through(keep, make(1));
through(keep, step(2));
const alone = make(3);
let sum = 0;
for (let i = 0; i < alone.length; i++) sum += alone[i];
console.log(sum, kept.length, Array.isArray(kept[0]), Array.isArray(kept[1]), kept[1].value, kept[0].length);
