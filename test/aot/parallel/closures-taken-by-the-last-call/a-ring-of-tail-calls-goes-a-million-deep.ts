"use strict";
function down(n: number, f: () => number): number { if (n <= 0) return f(); return down(n - 1, () => n); }
console.log(down(1_000_000, () => -1));
