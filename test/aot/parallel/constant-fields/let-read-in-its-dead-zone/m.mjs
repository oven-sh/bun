export function peek() { try { return String(x); } catch (e) { return e.name; } }
export const early = peek();
let x = 5;
