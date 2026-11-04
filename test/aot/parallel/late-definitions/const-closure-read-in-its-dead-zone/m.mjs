export function peek() { try { return typeof f; } catch (e) { return e.name; } }
export const early = peek();
const f = function () { return 1; };
export const read = () => f;
