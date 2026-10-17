// Closures handed through two functions that call each other stay one object per evaluation.
const list = [];
function keep(cb, again) { pass({ a: cb }, again); list.push(cb); }
function pass(o, again) { if (again) keep(o.a, false); }
for (let i = 0; i < 2; i++) { keep(() => {}, false); pass({ a: () => {} }, true); }
console.log(list[0] === list[2], list[1] === list[3]);
