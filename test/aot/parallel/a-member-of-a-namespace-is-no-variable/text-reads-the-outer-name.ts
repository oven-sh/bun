const x = "outer";
namespace N { export const x = "member"; export const seen = eval("x"); export function later(t: string) { return eval(t); } }
console.log(N.seen, N.later("x"), N.x);
