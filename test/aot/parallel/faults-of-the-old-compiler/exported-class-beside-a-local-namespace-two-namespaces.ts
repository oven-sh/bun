// @ts-nocheck
export namespace Box { export const a = 1; }
namespace Box { export const b = 2; }
console.log(Object.keys(Box).join(), Box.a, Box.b);
