// Calls: a fresh function has its prototype.
const fs: any[] = [() => 1, () => 2, () => 3, () => 4, () => 5, () => 6, () => 7, () => 8, function () { return 9 }, function () { return 10 }]
console.log(fs.map(f => typeof f.prototype).join(" "))
const gs: any[] = [() => 1, () => 2, () => 3, () => 4, () => 5, () => 6, () => 7, () => 8, function () { return 9 }]
for (const g of gs) if (g.prototype) g.prototype.m = 1
console.log(String(new gs[8]().m))
export {}
