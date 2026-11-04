namespace N {
  export let x = 1;
  // @ts-ignore
  export function drop() { return delete x; }
}
Object.freeze(N);
console.log(N.drop(), "x" in N);
