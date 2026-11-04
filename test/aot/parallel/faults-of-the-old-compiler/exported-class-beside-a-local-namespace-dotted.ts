// @ts-nocheck
export namespace A.B { export const a = 1; }
namespace A.B { export const b = 2; }
console.log(Object.keys(A).join(), Object.keys(A.B).join());
