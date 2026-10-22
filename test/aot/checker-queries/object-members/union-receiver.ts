// A member of a union is written only if it is written in every constituent.
interface A { k: number }
interface B { k: string }
declare const u: A | B;
u.k;
const o = { k: 1 };
declare const v: A | typeof o;
v.k;
export {};
