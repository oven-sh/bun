// `list[i] += x` where the counter enters as a number that nobody knows for whole, or as anything.
declare const process: { readonly argv: readonly string[] };
export {};
const starts: any[] = JSON.parse('[0, 1, 2.5, -1, null, "2", 4294967295, 2147483646]');
starts.push(undefined, NaN, true, -0, { valueOf() { return 3; } }, process.argv.length > 99 ? 1 : 2);
function up(list: any[], from: any, to: number, by: any) { let turns = 0; for (let i = from; i < to && turns++ < 20; i++) list[i] += by; return list; }
function next(list: any[], from: any, to: number, by: any) { let turns = 0; for (let i = from + 1; i <= to && turns++ < 20; i++) list[i] -= by; return list; }
function bits(list: any[], from: any, to: number, by: any) { let turns = 0; for (let i = from + 1; i <= to && turns++ < 20; i += i & -i) list[i] += by; return list; }
function down(list: any[], from: any, by: any) { let turns = 0; for (let i = from; i >= 0 && turns++ < 20; i--) list[i]++, list[i] += by; return list; }
const lines: string[] = [];
for (const start of starts)
    for (const by of [1, 0.5, "x"])
        for (const work of [up, next, bits]) {
            const told: any = work([0, 1, 2, 3, 4, 5, 6, 7], start, 9, by);
            lines.push(Object.keys(told).map(key => `${key}:${String(told[key])}`).join(" "));
        }
for (const start of starts.slice(0, 6)) {
    const told: any = down([0, 1, 2, 3], start, 2);
    lines.push(Object.keys(told).map(key => `${key}:${String(told[key])}`).join(" "));
}
console.log(lines.join("\n"));
