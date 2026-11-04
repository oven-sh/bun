function id(x) { return x; }
const m = id({ twice(n) { return n * 2; }, base: 4 });
const g = id({ get base() { return 9; }, set base(v) { this.kept = v; } });
g.base = 3;
console.log(m.twice(m.base), g.base, g.kept, typeof g.twice, m.kept);
