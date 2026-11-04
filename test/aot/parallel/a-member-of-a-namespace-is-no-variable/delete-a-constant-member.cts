// `delete x` where the namespace exports the constant `x`. Plain Bun prints another output.
// Its transpiler puts the value in the place of the name, and `delete 1` removes nothing. An ordinary executable has `delete N.x`, and this is what it prints.
namespace N {
  export const x = 1;
  // @ts-ignore
  export const gone = delete x;
  export const after = typeof x;
}
console.log(N.gone, "x" in N, N.after, (N as any).x);
/* Output:
true false undefined undefined
*/
