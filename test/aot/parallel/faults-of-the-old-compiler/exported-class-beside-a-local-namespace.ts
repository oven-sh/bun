// @ts-nocheck
export class Box { static s = 1; }
namespace Box { export const t = Box.s + 1; }
console.log(Box.t, Box.s);
