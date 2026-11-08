let last: unknown;
function run(f: () => number): string { const same = f === last; last = f; return same + ":" + f(); }
const out: string[] = [];
for (let i = 0; i < 4; i++) out.push(run(() => i * 2));
console.log(out.join(" "));
