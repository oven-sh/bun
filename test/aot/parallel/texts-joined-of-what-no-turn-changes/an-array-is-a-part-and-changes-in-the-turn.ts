const places: string[] = ["[0,0]", "[0,0]", "[0,0]"];
function walk(seen: Set<string>, pos: number[], way: number, turns: number): number {
  let hits = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (seen.has(`${pos}|${way}`)) hits++;
    pos[0]!++;
  }
  return hits;
}
const seen: Set<string> = new Set(JSON.parse('["0,0|1","1,0|1","3,0|1"]'));
let all = "";
for (let i = 0; i < 3; i++) all += walk(seen, JSON.parse(places[i]!), 1, 4) + ",";
console.log("SAID", all);
