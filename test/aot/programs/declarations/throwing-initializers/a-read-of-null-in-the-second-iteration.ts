type Cell = { next: Cell | null; n: number };
function walk(): { sum: number } { let at: Cell | null = { next: null, n: 1 }; let sum = 0; for (const x of [1, 2]) { sum += at!.n + x; at = at!.next; } return { sum }; }
export const made = walk();
