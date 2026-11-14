let first = null;
let last = null;
export function keep(box) { if (first === null) first = box; last = box; }
export function ones(n) { if (first === null || last === null) return 0; return first.sum(n) * 3 + last.sum(n) + first.size + last.size * 2 + first.plus(1) + last.plus(2); }
export function loops(n) { if (first === null || last === null) return 0; let sum = 0; for (let i = 0; i < n; i++) sum += first.sum(i) + last.sum(i) * 2 + first.size + last.size + first.plus(i) * 3 + last.plus(i); return sum; }
export function firsts(n) { if (first === null) return 0; let sum = 0; for (let i = 0; i < n; i++) sum += first.sum(i) + first.size + first.plus(i); return sum; }
