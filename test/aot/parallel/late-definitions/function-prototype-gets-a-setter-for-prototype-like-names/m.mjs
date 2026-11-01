class A { m() { return 1; } static s() { return 2; } toString() { return "an A"; } }
class B extends A { static t = 3; }
const f = function () { return 4; };
const re = /a/g;
export const read = () => [A, B, f, re];
