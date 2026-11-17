const n = (value: number) => Number(process.argv[8] ?? value);
function outer(early: number) { const run = (limit: number) => { let turns = 0; while (turns < limit && pos < 5) { pos++; turns++; } return turns; }; let result = "";
  try { result += run(early); } catch (error) { result += (error as Error).constructor.name; }
  let pos = 2; return result + ":" + run(9) + ":" + pos; }
console.log(outer(n(0)), outer(n(1)));
