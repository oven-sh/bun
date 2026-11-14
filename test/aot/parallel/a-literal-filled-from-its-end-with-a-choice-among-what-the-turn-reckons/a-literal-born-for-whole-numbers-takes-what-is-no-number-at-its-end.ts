// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: what is remembered of the literal is asked of memory
// Under: --aot-testing=FailSpeculations: every guess of the typed copy fails once and the turn begins again as it is written
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what the walk has proven of the list is asked of memory
const show = (list: unknown[]) => { let text = list.length + ":"; for (let i = 0; i < list.length; i++) text += (i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] + " " + String(list[i])) : "_") + ","; return text; };
function declared(given: number[], count: number): string {
  const most = count | 0, kept: number[] = [most & 1, most & 3];
  for (let j = 2; j <= most; j++) {
    let chosen = given[j]!;
    if (j & 1) chosen = given[j - 1]!;
    kept[j] = chosen;
  }
  return show(kept);
}
function seenWhole(given: number[], count: number): string {
  const most = count | 0, kept = [most & 1];
  for (let j = 1; j <= most; j++) {
    let chosen = kept[j - 1]! | 0;
    if (j & 1) chosen = (given[j]! & 15) as number;
    kept[j] = j === most ? given[j]! : chosen;
  }
  return show(kept);
}
function seenParts(given: number[], count: number): string {
  const most = count | 0, kept = [(most & 1) + 0.5];
  for (let j = 1; j <= most; j++) {
    let chosen = kept[j - 1]! * 0.5;
    if (j & 1) chosen = given[j]!;
    kept[j] = chosen;
  }
  return show(kept);
}
const rounds = +process.argv[2]! || 3;
const lists = JSON.parse('[[0,1,2,3,4,5,6,7,8,9,10,11,12],[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5,12.5],[0,1,2,"three",4,5,6,7,8,9,10,11,"twelve"],[0,1,null,3,4,true,6,7,8,{"a":1},10,11,[12]],[0,2147483648,-2147483649,3,4,1e300,6,7,8,9,10,11,4294967296],[0,1],[]]') as number[][];
lists.push([0, 1, 2, NaN, 4, 5, -0, 7, 8, 9, 10, 11, NaN], [0, 1, , 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as number[]);
let all = "";
for (let t = 0; t < rounds; t++) {
  all = "";
  for (const given of lists) for (const count of [0, 1, 2, 3, 11, 12]) all += declared(given, count) + " " + seenWhole(given, count) + " " + seenParts(given, count) + "\n";
}
console.log(all);
