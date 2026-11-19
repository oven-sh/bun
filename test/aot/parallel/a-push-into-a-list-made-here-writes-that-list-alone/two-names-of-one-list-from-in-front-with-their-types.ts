// The same with the types written and the lists out of JSON.
const said: (string | number)[] = [];
function handed(d: number[], out: number[]): string { let s = 0; for (let i = 0; i < d.length && i < 300; i++) { out.push(d[i]! + 1); s = (s + d[i]!) | 0; } return s + " " + d.length; }
function halves(d: number[], out: number[]): string { let s = 0; for (let i = 0; i < d.length && i < 300; i++) { out.push(d[i]! + 0.5); s += d[i]!; } return s + " " + d.length; }
function popped(d: number[], out: number[]): string { let s = 0; for (let i = 0; i < d.length; i++) { s = (s + d[i]!) | 0; out.pop(); } return s + " " + d.length; }
const table: Record<string, (d: number[], out: number[]) => string> = { handed, halves, popped };
for (let round = 0; round < 3; round++) {
    for (const name of JSON.parse('["handed","halves","popped"]') as string[]) {
        const one: number[] = JSON.parse("[1,2,3,4,5,6,7,8,9]"), two: number[] = JSON.parse("[1,2,3]");
        said.push(table[name]!(one, one), table[name]!(two, JSON.parse("[7]")));
    }
}
console.log(said.join(" "));
export {};
