// RUN: link
// CHECK: evalscope [[names]] bindings=[{name="x" kind=Constant variable={{*}}}, {name="N"
// CHECK: evalscope {{*}}outer=[[names]]

const x = "outer";
namespace N {
  export const x = "member";
  export const seen = eval("typeof x");
}
console.log(N.seen, typeof x);
