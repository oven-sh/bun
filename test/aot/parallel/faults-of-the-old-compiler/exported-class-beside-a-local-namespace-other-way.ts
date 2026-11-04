// @ts-nocheck
class Box { static s = 1; }
export namespace Box { export const t = Box.s + 1; }
console.log(Box.t, Box.s, typeof Box);
