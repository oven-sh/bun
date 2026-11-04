namespace N {
  var q = "namespace";
  export enum E { A = (eval("var q = 'enum'"), 1) }
  export const seen = q;
}
console.log(N.seen, N.E.A);
