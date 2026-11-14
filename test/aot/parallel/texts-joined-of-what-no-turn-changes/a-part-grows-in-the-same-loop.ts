function count(among: string[], seed: string): number {
  let hits = 0, grown = seed;
  for (let k = 0; k < among.length; k++) {
    if (among[k] === grown + "-") hits += k + 1;
    grown += "x";
  }
  return hits * 100 + grown.length;
}
const among: string[] = JSON.parse('["a-","ax-","b","axxx-"]');
let all = "";
for (let i = 0; i < 3; i++) all += count(among, JSON.parse('"a"')) + ",";
console.log(all);
