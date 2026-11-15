const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
const kept: string[] = [];
function speculate(adds: boolean): number { const saved = kept.length; if (adds) kept.push("x", "y"); kept.length = saved; return kept.length; }
let said = "";
for (let i = 0; i < 6; i++) said += speculate(i % 2 === 1) + ",";
kept.push("a"); said += speculate(false) + "," + speculate(true);
console.log(said, kept.join());
