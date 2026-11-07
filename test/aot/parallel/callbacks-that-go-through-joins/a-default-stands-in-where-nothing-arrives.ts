function plain(x: number): number { return x; }
function each(list: number[], visit: (x: number) => number = plain): number { let t = 0; for (const x of list) t += visit(x); return t; }
function work(list: number[], k: number): number { return each(list, x => x * k) * 1000 + each(list); }
console.log(work([1, 2, 3], 2), work([4], 5));
