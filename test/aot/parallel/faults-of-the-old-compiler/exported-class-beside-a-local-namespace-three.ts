// @ts-nocheck
export class Box { static s = 1; }
namespace Box { export const t = 2; }
export namespace Box { export const u = 3; }
console.log(Box.s, Box.t, Box.u, typeof Box);
