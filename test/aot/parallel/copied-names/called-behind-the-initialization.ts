function outer(t: number): number { if (t < 0) return t; const stack: number[] = []; return walk(t); function walk(n: number): number { stack.push(n); return n ? walk(n - 1) : stack.length; } }
console.log(outer(-1), outer(0), outer(3), outer(5));
