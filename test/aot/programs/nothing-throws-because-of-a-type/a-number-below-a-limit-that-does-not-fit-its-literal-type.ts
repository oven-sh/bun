const box = { f: 0 };
function put(large: boolean, limit: 10) { const x = large ? 500 : 5; if (x < limit) box.f = x; }
put(true, 1e9 as any);
console.log(box.f < 10, box.f);
const list: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
function at(large: boolean, limit: 10) { const x = large ? 500 : 5; if (x < limit) return list[x]; return -1; }
console.log(at(true, 1e9 as any), at(false, 10), at(true, 10));
function count(n: number) { let s = 0; for (let i = 0; i < n; ++i) s += i & 31; return s; }
console.log(count(100), count("7" as any), count(undefined as any));
