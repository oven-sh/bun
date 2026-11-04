// the list holds one literal among objects of the written class: the sum, the counter and the greatest so far go on from that turn
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Entry { score: number; name: string; constructor(score: number, name: string) { this.score = score; this.name = name; } }
const log: string[] = [];
function rank(entries: Entry[]): string {
    let sum = 0;
    let best = -Infinity;
    let names = "";
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (i % 16 === 0) log.push("turn " + i);
        sum += entry.score * (i + 1);
        if (entry.score > best) best = entry.score;
        names = names.length < 12 ? names + entry.name : names;
    }
    return sum + " " + best + " " + names;
}
const rankByValue = through(rank);
function listWith(misfitAt: number, length: number): any[] { const list: any[] = []; for (let i = 0; i < length; i++) list.push(i === misfitAt ? { score: 1000 + i, name: "L" } : new Entry(i % 7, "e")); return list; }
for (const at of [-1, 0, 1, 31, 63]) { log.length = 0; console.log(rankByValue(listWith(at, 64)), log.join()); }
