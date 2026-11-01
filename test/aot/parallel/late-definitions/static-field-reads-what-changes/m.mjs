export let level = 1;
export const raise = () => { level++; };
class A { static x = level; }
export const read = () => A;
