function count(among: string[], seed: string, rounds: number): number {
  let hits = 0, grown = seed;
  for (let round = 0; round < rounds; round++) {
    for (let k = 0; k < among.length; k++) {
      if (among[k] === grown + "-") hits += k + 1;
    }
    grown += "x";
  }
  return hits * 100 + grown.length;
}
const among: string[] = JSON.parse('["a-","ax-","b","axxx-"]');
let all = "";
for (let i = 0; i < 3; i++) all += count(among, JSON.parse('"a"'), Number("5")) + ",";
console.log(all);
