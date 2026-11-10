// STATISTIC: ElementsAskedInTurnsOfTypedCopies >= 1
const D: any = [[[0, 0], , [9, 0], [5, 4]]][JSON.parse("0")];
function run(d: number[][], t: number): number { const centers: number[][] = [d[t]!, d[t + 1]!, d[t + 2]!]; let out = 0; for (let i = 0; i < d.length; i++) { const p = d[i]!; let best = 0, least = Infinity; for (let c = 0; c < centers.length; c++) { const dx = p[0]! - centers[c]![0]!, dy = p[1]! - centers[c]![1]!, v = dx * dx + dy * dy; if (v < least) { least = v; best = c; }  } out += best; } return out; }
type Op = (d: number[][], t: number) => number;
const ops: Record<string, Op> = { run, idle(d, t) { return t; } }, steps: string[] = JSON.parse('["run"]');
for (let t = 0; t < 3; t++) { try { console.log(ops[steps[0]!]!(D, 0)); } catch (e) { console.log((e as Error).name); } }
