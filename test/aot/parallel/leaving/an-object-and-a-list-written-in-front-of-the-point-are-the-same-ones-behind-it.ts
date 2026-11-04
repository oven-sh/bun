// neither has been handed to anybody when the read fails: behind it they are compared, changed and handed out
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Seed { kind: number; constructor(kind: number) { this.kind = kind; } }
const kept: any[] = [];
function plant(seed: Seed, depth: number): string {
    const hole = { depth, filled: false, seeds: 0 };
    const marks = [depth, depth + 1];
    const same = hole;
    const kind = seed.kind;
    hole.filled = true;
    hole.seeds += kind;
    marks.push(kind);
    kept.push(hole, marks);
    return JSON.stringify(hole) + " " + marks.join() + " " + (same === hole) + " " + (kept[kept.length - 2] === same);
}
const plantByValue = through(plant);
console.log(plantByValue(new Seed(1), 5), "|", plantByValue({ kind: 2 } as any, 6), "|", plantByValue({ kind: 3, more: 1 } as any, 7), kept.length);
