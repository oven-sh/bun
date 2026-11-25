// Under: --aot-testing=CheckProofsAtRunTime: a proxy is no record of the layout: the held reading alone says records
function report(value) { console.log(value); }
function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function make(i) { return { balance: i, owner: "o" + i, open: (i & 1) === 0 }; }
function total(accounts) { var sum = 0; for (const account of accounts) sum += account.balance; return sum; }
function owners(accounts) { var text = ""; for (const account of accounts) { if (account.open) text += account.owner; } return text; }
function fresh(n) { var list = []; for (var i = 0; i < n; i++) list.push(make(i)); return list; }
var other = { owner: 7, balance: "text", open: 1, more: true };
function once(round) { var list = fresh(4); list[1] = new Proxy(make(5), { get: function (t, k) { return k === "balance" ? 1000 : t[k]; } }); return tell(function () { return total(list); }) + " " + tell(function () { return owners(list); }); }
for (var round = 0; round < 4; round++) report(once(round));
