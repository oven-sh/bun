let first = null;
let last = null;
export function keep(box) { if (first === null) first = box; last = box; }
export function ones(n) { if (first === null || last === null) return 0; return first.sum(n) * 3 + last.sum(n) + first.size + last.size * 2 + first.plus(1) + last.plus(2); }
export function loops(n) { if (first === null || last === null) return 0; let sum = 0; for (let i = 0; i < n; i++) sum += first.sum(i) + last.sum(i) * 2 + first.size + last.size + first.plus(i) * 3 + last.plus(i); return sum; }
export function firsts(n) { if (first === null) return 0; let sum = 0; for (let i = 0; i < n; i++) sum += first.sum(i) + first.size + first.plus(i); return sum; }
export function hooked(n, act) { if (first === null || last === null) return ""; const out = []; for (let i = 0; i < n; i++) { out.push(first.sum(i) * 1000 + last.sum(i)); act(i); out.push(first.sum(i) * 1000 + last.sum(i), first.size + last.size); } return out.join(" "); }
export function hookedSum(n, act) { if (first === null || last === null) return 0; let sum = 0; for (let i = 0; i < n; i++) { sum += first.sum(i) + last.size; act(i); sum += first.size * 3 + last.sum(i) * 5; } return sum; }
export function straight(act) { if (first === null || last === null) return 0; const a = first.sum(1) + last.size; act(2); const b = first.sum(1) * 7 + last.sum(2) * 11 + first.size + last.size; act(3); return a * 1000000 + b + last.plus(first.plus(1)); }
export function argument(act) { return first === null || last === null ? 0 : first.sum(act(2)) * 1000 + last.sum(act(4)) + first.sum(1); }
