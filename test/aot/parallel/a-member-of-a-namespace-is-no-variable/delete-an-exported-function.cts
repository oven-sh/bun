namespace N {
  export function f() { return 1; }
  // @ts-ignore
  export const gone = delete f;
}
console.log(N.gone, "f" in N);
