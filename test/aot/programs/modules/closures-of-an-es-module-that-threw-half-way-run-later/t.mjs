globalThis.later.push(() => early, () => late, () => fn(), () => new C().x, () => typeof C);
export const early = 1;
null.x;
export const late = 2;
export function fn() { return late; }
export class C { x = late; }
