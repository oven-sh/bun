// A helper called twice copies a list of numbers and nulls by a spread and filters the nulls out.
const list = [1, null, 2, null, 3];
function keep(l) { return [...l].filter(v => v !== null); }
console.log(JSON.stringify(keep(list)), keep(list).length);
