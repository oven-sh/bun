export function peek() { try { return typeof A; } catch (e) { return e.name; } }
export const early = peek();
class A {}
export const read = () => A;
