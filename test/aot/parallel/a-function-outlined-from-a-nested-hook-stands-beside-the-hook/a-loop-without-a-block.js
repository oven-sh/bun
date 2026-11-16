// Flags: --react-compiler
// What the head of a loop declares is in scope in the one statement that is its body. An `if`, a `while`, a `do` and a label open no scope, and a label stays on its loop.
const rate = 100;
const made = [];
for (const rate of [3]) made.push(function (items) { "use memo"; return items.map(n => n * rate).join("+"); });
for (const rate in { 4: 1, 5: 1 }) made.push(function (items) { "use memo"; return items.map(n => n * rate).join("+"); });
for (let rate = 6; rate < 8; rate++) made.push(function (items) { "use memo"; return items.map(n => n * rate).join("+"); });
for (const rate of [8, 9]) if (rate === 8) made.push(function (items) { "use memo"; return items.map(n => n * rate).join("+"); }); else made.push(function (items) { "use memo"; return items.map(n => n + rate).join("-"); });
for (const rate of [10]) named: made.push(function (items) { "use memo"; return items.map(n => n * rate).join("+"); });
for (const rate of [11]) while (made.length < 9) made.push(function (items) { "use memo"; return items.map(n => n * rate).join("+"); });
for (const rate of [12]) do made.push(function (items) { "use memo"; return items.map(n => n * rate).join("+"); }); while (made.length < 10);
outer: for (const rate of [13, 14]) for (const more of [1, 2]) if (more === 2) continue outer; else made.push(function (items) { "use memo"; return items.map(n => n * rate + more).join("+"); });
console.log(made.map(bill => bill([1, 2])).join());
