// A helper called twice copies a list of numbers and nulls by a spread and filters the nulls out: the types say so.
const list: (number | null)[] = [1, null, 2, null, 3];
function keep(l: (number | null)[]) { return [...l].filter(v => v !== null); }
console.log(JSON.stringify(keep(list)), keep(list).length);
export {};
