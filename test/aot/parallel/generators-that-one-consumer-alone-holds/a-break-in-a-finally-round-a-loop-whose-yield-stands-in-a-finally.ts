const out: string[] = [];
function note(v: any): any { out.push(String(v)); return v; }
const stop: number = JSON.parse("1");
function* run(a: number[], b: number[]): any { let turns = 0; for (const x of a) { try { for (const w of b) { turns++; try { yield w; } finally { note(turns); } } } finally { note("z"); if (turns === stop) break; } } note("end"); }
for (const y of run([1, 2, 3], [4, 5])) note(y);
console.log(out.join(" "));
export {};
