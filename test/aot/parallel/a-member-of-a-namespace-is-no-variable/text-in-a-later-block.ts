const x = "outer";
namespace N { export const x = "member"; }
namespace N { export const seen = eval("x"); export const written = x; }
console.log(N.seen, N.written);
