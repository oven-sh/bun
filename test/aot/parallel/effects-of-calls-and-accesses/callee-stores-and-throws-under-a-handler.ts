// a direct callee stores only on the way to its throw, and the handler round the call reads what it stored
let last = 0;
function check(n: number) { if (n < 0) { last = n; throw new RangeError("negative"); } }
function deed(n: number) { const before = last; try { check(n); } catch (e) { return (e as Error).name + " " + before + " " + last; } return "passed " + before + " " + last; }
console.log(deed(1));
console.log(deed(-2));
let all = "";
for (let i = 0; i < 6; i++) all += deed(i % 2 ? -i : i) + ";";
console.log(all);
console.log(deed(-9));
