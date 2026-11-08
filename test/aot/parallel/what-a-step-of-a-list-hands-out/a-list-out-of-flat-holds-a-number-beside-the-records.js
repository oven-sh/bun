// Under: --aot-testing=CheckProofsAtRunTime: what flat() gives holds what the lists inside held: the held reading alone says records
function report(value) { console.log(value); }
function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function make(i) { return { balance: i, owner: "o" + i, open: (i & 1) === 0 }; }
function total(accounts) { var sum = 0; for (const account of accounts) sum += account.balance; return sum; }
function owners(accounts) { var text = ""; for (const account of accounts) { if (account.open) text += account.owner; } return text; }
function fresh(n) { var list = []; for (var i = 0; i < n; i++) list.push(make(i)); return list; }
function given2() { return [fresh(2), [make(4), 5]].flat(); }
for (var round = 0; round < 4; round++) report(tell(function () { return total(given2()); }) + " " + tell(function () { return owners(given2()); }));
