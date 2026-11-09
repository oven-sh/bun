// A list made with a length, where the position is narrowed behind the comparison: by a second comparison with a number that leaves one value, and by a test of the counter.
const out: string[] = [];
function one(turn: number): string { const n: number = 1; const list: any[] = new Array(n) as any[]; if (turn % 11 === 0) list[n + 2] = 1; for (let k = 0; k < list.length && k < n; k++) list[k] = k * 2; return JSON.stringify(list); }
function atOne(n: number): unknown[] { const list: unknown[] = new Array(n); for (let k = 0; k < n; k++) if (k === 1) list[k] = "one"; else list[k] = k; return list; }
function cutLate(turn: number): unknown[] { const n = 1; const list = new Array(n); for (let k = 0; k < list.length && k < n; k++) { list[k] = k; if (turn % 7 === 6 && k === 1) list.length = 1; } return list; }
function readsLength(n: number): number { const list: any[] = new Array(n); for (let k = 0; k < list.length && k < n; k++) list[k] = list.length; return list.length; }
function popped(turn: number): unknown[] { const n = 2; const list = new Array(n); if (turn % 2 === 0) list.pop(); for (let k = 0; n > k; k++) list[k] = k; return list; }
for (let turn = 0; turn < 14; turn++) out.push(one(turn) + JSON.stringify([atOne(turn % 3), cutLate(turn), readsLength(turn % 4), popped(turn)]));
console.log(out.join("\n"));
