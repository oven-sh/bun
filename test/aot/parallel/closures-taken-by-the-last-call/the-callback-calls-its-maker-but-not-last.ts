function helper(n: number, callback: (x: number) => number): number { return callback(n); }
function depth(n: number): number { if (n === 0) return 0; return helper(n, x => 1 + depth(x - 1)); }
function twice(n: number): number { return helper(n, x => x * 2); }
console.log(depth(3000), twice(21));
