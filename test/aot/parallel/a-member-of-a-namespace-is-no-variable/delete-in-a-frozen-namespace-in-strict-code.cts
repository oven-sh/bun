"use strict";
namespace N {
  export let x = 1;
  // @ts-ignore
  export function drop() { try { return delete x; } catch (e) { return (e as Error).name; } }
}
Object.freeze(N);
console.log(N.drop(), "x" in N);
