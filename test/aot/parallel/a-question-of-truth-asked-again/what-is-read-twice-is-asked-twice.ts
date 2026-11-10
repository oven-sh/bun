let reads = 0;
const flips = { get now(): any { return ++reads & 1 ? { n: reads } : undefined; } };
function read(holder: any, go: boolean): string { let said = ""; if (holder.now && go) said += "1"; if (holder.now && go) said += "2"; return said + "|"; }
let all = "";
for (let i = 0; i < 5; i++) all += Reflect.apply(read, undefined, [flips, true]) + Reflect.apply(read, undefined, [flips, false]);
console.log(all, reads);
