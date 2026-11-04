// A helper called twice copies a list by a spread and filters the nulls out: the list is typed as numbers and holds nulls all the same.
const list: number[] = [1, null as any, 2, null as any, 3];
function keep(l: number[]) { return [...l].filter(v => v !== null); }
console.log(JSON.stringify(keep(list)), keep(list).length);
export {};
