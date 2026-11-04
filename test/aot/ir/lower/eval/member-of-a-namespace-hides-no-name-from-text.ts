// RUN: link
// CHECK: evalscope {{*}}bindings=[{name="x" kind=Constant depth=2 variable={{*}}}, {name="N"

const x = "outer";
namespace N {
  export const x = "member";
  export const seen = eval("typeof x");
}
console.log(N.seen, typeof x);
