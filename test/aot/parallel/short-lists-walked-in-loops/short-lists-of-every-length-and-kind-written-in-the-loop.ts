// STATISTIC: TurnsOfForOfWrittenOutByNotedLength >= 1
function none(n: number): string { let c = 0; for (let i = 0; i < n; i++) for (const x of []) c++; return "" + c; }
function one(n: number): string { let c = 0, s = 0; for (let i = 0; i < n; i++) for (const x of [7]) { c++; s += x; } return c + " " + s; }
function two(n: number): string { let c = 0, s = 0; for (let i = 0; i < n; i++) for (const x of [1, 2]) { c++; s += x; } return c + " " + s; }
function five(n: number): string { let c = 0, s = 0; for (let i = 0; i < n; i++) for (const x of [1, 2, 3, 4, 5]) { c++; s = s * 3 + x & 65535; } return c + " " + s; }
function halves(n: number): string { let c = 0, s = 0; for (let i = 0; i < n; i++) for (const x of [0.5, 1.5, 2.5]) { c++; s += x; } return c + " " + s; }
function texts(n: number): string { let c = 0, s = 0; for (let i = 0; i < n; i++) for (const x of ["a", "bc", "def"]) { c++; s += x.length; } return c + " " + s; }
function mixed(n: number): string { let c = 0, s = ""; for (let i = 0; i < n; i++) for (const x of [1, "b", null, undefined, true]) { c++; if (i === n - 1) s += String(x); } return c + " " + s; }
function made(n: number): string { let c = 0, s = 0; for (let i = 0; i < n; i++) for (const x of [i, i + 1, i * 2]) { c++; s += x; } return c + " " + s; }
function nest(n: number): string { let c = 0, s = 0; for (let i = 0; i < n; i++) for (const x of [1, 2]) for (const y of [10, 20, 30]) { c++; s += x * y; } return c + " " + s; }
for (const f of [none, one, two, five, halves, texts, mixed, made, nest]) console.log(f.name, f(0), f(1), f(2), f(1000));
