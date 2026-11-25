const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number): number { let turns = 0; while (turns < limit && pos < 5) { pos++; turns++; } return turns; }
function add(turns: number): number { for (let i = 0; i < turns; i++) total += 0.5; return turns; }
let said = "";
for (const early of [() => run(n(0)), () => run(n(1)), () => add(n(0)), () => add(n(1))]) { try { said += early(); } catch (error) { said += (error as Error).constructor.name; } said += " "; }
let pos = 2, total = 1;
console.log(said, run(9), pos, add(n(4)), total);
