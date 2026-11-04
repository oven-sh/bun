export function peek() { try { return typeof re; } catch (e) { return e.name; } }
export const early = peek();
const re = /x/;
export const read = () => re;
