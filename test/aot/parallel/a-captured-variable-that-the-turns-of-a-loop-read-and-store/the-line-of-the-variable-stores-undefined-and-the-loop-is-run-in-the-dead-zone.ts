// Under: --aot-harden=proof-checks: the read of the slot that is laid in front of the loop to be tested said that it follows its store: as users build the answer was right, and there the proof was found false
const n = (value: number) => Number(process.argv[8] ?? value);
function outer(early: number) { const add = (turns: number) => { for (let i = 0; i < turns; i++) total += i * 0.5; return turns; }; let result = "";
  try { result += add(early); } catch (error) { result += (error as Error).constructor.name; }
  let total: any = undefined; return result + ":" + add(n(5)) + ":" + total; }
console.log(outer(n(0)), outer(n(2)));
