const x = "outer";
namespace N { export const x = "member"; export const seen = eval("typeof x"); }
console.log(N.seen, typeof x);
