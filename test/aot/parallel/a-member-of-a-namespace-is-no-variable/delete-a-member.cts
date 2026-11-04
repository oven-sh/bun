namespace N {
  export let x = 1;
  // @ts-ignore
  export const gone = delete x;
}
console.log(N.gone, "x" in N);
