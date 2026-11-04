namespace N { export let level = 5; export function raise(): number { return ++level; } export function read(): number { return level; } }
function often(): number { let s = 0; for (let i = 0; i < 3; i++) s += N.level + N.raise(); return s; }
console.log(N.raise(), N.level, N.read(), often());
N.level = 9;
console.log(N.raise(), N.level, N.read(), often());
