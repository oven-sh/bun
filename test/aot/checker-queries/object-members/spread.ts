// A member that a spread copies stays written in the type of the literal; a member the literal adds is not. The type of a spread has no declared form, so an access on it is unwritten.
interface A { a: number }
declare const x: A;
const s = { ...x, b: 1 };
s.a;
s.b;
let t: typeof s;
export {};
