namespace N { export function f(): number { return 1; } export let level = 5; }
console.log(Object.keys(N).join(), JSON.stringify(N), "level" in N, N.hasOwnProperty("f"));
namespace N { export function g(): number { return f() + 1; } export const more = 2; }
console.log(Object.keys(N).join(), JSON.stringify(N), "more" in N, N.hasOwnProperty("g"), Object.entries(N).length);
for (const k in N) console.log(k);
