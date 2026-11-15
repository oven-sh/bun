function Counter(n) { this.n = n; }
function early(k) { let s = 0; for (let i = 0; i < k; i++) s += Counter.of(i).n; return s; }
console.log(early(JSON.parse("0")));
Counter.of = function (n) { return new Counter(n + 1); };
console.log(early(JSON.parse("3")));
