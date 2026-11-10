const n = (value: number) => Number(process.argv[8] ?? value);
function outer(early: number) { const add = (turns: number) => { const run = () => { for (let i = 0; i < turns; i++) total += i * 0.5; }; run(); return turns; }; let result = "";
  try { result += add(early); } catch (error) { result += (error as Error).constructor.name; }
  let total = 1; return result + ":" + add(n(5)) + ":" + total; }
console.log(outer(n(0)), outer(n(2)));
