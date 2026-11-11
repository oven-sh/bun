// The list that is filled is a constant of the file: known to be a list, not made in the function. The list that is read is a parameter, said to be number[], and nobody sees who calls: it is the same list.
const said: (string | number)[] = [];
const sink: number[] = [];
function sums(d: number[], k: number): number { let sum = 0; for (let i = 0; i < d.length && i < 300; i++) { sum += d[i]!; sink.push(sum % 7 + k); } return sum + d.length; }
function halves(d: number[], k: number): number { let sum = 0; for (let i = 0; i < d.length && i < 300; i++) { sum += d[i]!; sink.push(k + 0.5); } return sum + d.length; }
function pops(d: number[], k: number): number { let sum = 0; for (let i = 0; i < d.length; i++) { sum += d[i]!; sink.pop(); } return sum + d.length + k; }
const byName: Record<string, (d: number[], k: number) => number> = { sums, halves, pops };
for (let round = 0; round < 3; round++) {
    for (const name of JSON.parse('["sums","halves","pops"]') as string[]) {
        sink.length = 0; for (let i = 0; i < 9; i++) sink.push(i);
        said.push(byName[name]!(sink, round), sink.length);
        sink.length = 0; for (let i = 0; i < 9; i++) sink.push(i);
        said.push(byName[name]!(JSON.parse("[1,2,3,4.5]"), round), sink.length);
    }
}
console.log(said.join(" "));
export {};
