// Literals of the module that functions store into, read and stored, frozen, cleared, aliased, kept as they are.
const zeros = [0, 0, 0, 0], numbers = [1, 2, 3, 4], doubles = [1.5, 2.5, 3.5, 4.5], texts = ["a", "b", "c", "d"], mixed: any[] = [1, "b", null, 4.5], nested = [[1, 2], [3, 4]], read = [5, 6, 7, 8], frozen: number[] = [1, 2, 3, 4], empty: number[] = [], holes = [1, , 3] as number[];
const alias = numbers; let later = [9, 8, 7]; Object.freeze(frozen);
function count(n: number) { for (let i = 0; i < n; i++) zeros[i & 3]!++; return zeros.join(); }
function add(n: number) { for (let i = 0; i < n; i++) doubles[i & 3]! += i; return doubles.join(); }
function turn(n: number) { for (let i = 0; i < n; i++) texts[i & 3] = texts[(i + 1) & 3]!; return texts.join(); }
function through(n: number) { for (let i = 0; i < n; i++) alias[i & 3] = numbers[(i + 1) & 3]! + 1; return numbers.join() + (alias === numbers); }
function widen(n: number) { for (let i = 0; i < n; i++) numbers[i & 3] = i === n - 1 ? 0.5 : i; return numbers.join(); }
function store(n: number) { for (let i = 0; i < n; i++) mixed[i & 3] = i & 1 ? "t" + i : i; return mixed.join(); }
function deep(n: number) { for (let i = 0; i < n; i++) nested[i & 1]![0]! += i; return JSON.stringify(nested); }
function grow(n: number) { for (let i = 0; i < n; i++) empty[i] = i; const said = empty.join(); empty.length = 0; return said; }
function fill(n: number) { for (let i = 0; i < n; i++) holes[i & 3] = i; return JSON.stringify(holes); }
function refuse(n: number) { try { for (let i = 0; i < n; i++) frozen[i & 3] = i; } catch (e: any) { return e.name + frozen.join(); } return "stored"; }
function sum(n: number) { let s = 0; for (let i = 0; i < n; i++) s += read[i & 3]!; return s; }
function change(n: number) { for (let i = 0; i < n; i++) { later[i % 3] = i; if (i === 5) later = [1, 2, 3]; } return later.join(); }
for (let round = 0; round < 3; round++) for (const f of [count, add, turn, through, widen, store, deep, grow, fill, refuse, sum, change]) console.log(f.name, f(11), Object.isFrozen(frozen), read.join());
numbers.push(5); zeros.length = 2; console.log(numbers.join(), zeros.join(), JSON.stringify([doubles, texts, mixed]), structuredClone(numbers).join());
