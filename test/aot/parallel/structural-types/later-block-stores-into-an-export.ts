// A later block of a namespace stores into variables that an earlier block exports: the stores mean `N.f = 1` and `N.g = 2`, as in what tsc emits. Plain Bun prints another output.
// Its transpiler leaves the names as they are, and the first store throws a ReferenceError.
namespace N {
  export let f: any;
  export let g: any = 0;
}
namespace N {
  f = 1;
  g = 2;
}
console.log(JSON.stringify(N));
export {};
/* Output:
{"g":2,"f":1}
*/
