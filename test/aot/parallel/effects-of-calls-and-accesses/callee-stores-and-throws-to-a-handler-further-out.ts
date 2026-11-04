// a direct callee stores on the way to its throw, no handler stands round the call, and the handler of the caller's caller reads what it stored
let last = 0;
function check(n: number) { if (n < 0) { last = n; throw new RangeError("negative"); } }
function inner(n: number) { const before = last; check(n); return before + last; }
function deed(n: number) { const before = last; try { return "passed " + inner(n); } catch (e) { return (e as Error).name + " " + before + " " + last; } }
console.log(deed(1));
console.log(deed(-2));
let all = "";
for (let i = 0; i < 6; i++) all += deed(i % 2 ? -i : i) + ";";
console.log(all);
console.log(deed(-9));
