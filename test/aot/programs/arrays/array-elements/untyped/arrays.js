export function mixed() { const list = [1, "s", 2.5]; list.push(null); return list; }
export function integers() { const list = [1, 2, 3]; list.push(4); list[0] = 0.5; list.push("s"); return list; }
export function fractions() { const list = [0.5, 1, -0]; list.push(2 ** 40); list.push(undefined); return list; }
export function empty() { const list = []; list.push(1); list.push(1.5); list.push({}.x); return list; }
export function grown() { const n = 3; const list = [n, n + 1, n * 2]; for (let i = 0; i < 3; i++) list.push(i / 2); return list; }
export function pushed() { const list = []; for (let i = 0; i < 3; i++) list.push(i, i + 10); list[7] = 1; return list; }
function fill(list) { list.push("s", 0.5); }
export function handedOn() { const list = []; list.push(1); fill(list); return list; }
