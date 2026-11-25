// Between the store into the literal and the pattern the list is written: under its own name, through the literal, and by a method.
function byName(a) { const list = [a, 1]; const holder = { list }; list[0] = 50; const { list: [first, second] } = holder; return first + second; }
function throughHolder(a) { const holder = { list: [a, 1] }; holder.list[1] = 60; const { list: [first, second] } = holder; return first + second; }
function byPush(a) { const list = [a]; const holder = { list }; list.push(70); const { list: [first, second = 3] } = holder; return first + second; }
function byLength(a) { const list = [a, 1]; const holder = { list }; list.length = 1; const { list: [first, second = 3] } = holder; return first + second; }
function byComputedIndex(a, k) { const list = [a, 1]; const holder = { list }; list[k] = 80; const { list: [first, second] } = holder; return first + second; }
function otherList(a, other) { const list = [a, 1]; const holder = { list }; other[0] = 90; const { list: [first, second] } = holder; return first + second; }
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += byName(i) + throughHolder(i) + byPush(i) + byLength(i) + byComputedIndex(i, i & 1) + otherList(i, [0]); return t; }
console.log(run(100));
