export function F() {}
F.prototype.early = true;
class B extends F { m() { return 1; } }
export const read = () => B;
