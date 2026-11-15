function each(list: number[], visit: (x: number) => void): number { for (const x of list) visit(x); return list.length; }
const seen: number[] = [];
function count(list: number[]): number { let total = 0; const bump = (x: number) => { total += x; seen.push(total); }; return each(list, bump); }
console.log(count([1, 2, 3]), count([4]), seen.join());
