// A helper called twice copies a list by a spread and filters the nulls out: the list is written with fractions, and a null is pushed.
const list = [1.5, 2.5];
list.push(null); list.push(3.5);
function keep(l) { return [...l].filter(v => v !== null); }
console.log(JSON.stringify(keep(list)), keep(list).length);
