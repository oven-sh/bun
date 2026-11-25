// Native code makes an empty list that holds nothing yet (JSON.parse("[]"), Object.keys({})). map, filter, slice and the others that make a list like their receiver make it in line, as for a list that holds something
// COUNT: operation:operationAOTArraySpeciesCreate <= 40
const turns = Number(process.argv[2] ?? 3) * 1000;
const parsed: { items: { n: number }[]; names: string[] }[] = [JSON.parse('{"items":[],"names":[]}'), JSON.parse('{"items":[],"names":[]}')];
let made = 0;
const kept: unknown[][] = [];
for (let turn = 0; turn < turns; turn++) {
  const from = parsed[turn & 1];
  const mapped = from.items.map(item => item.n + 1);
  const filtered = from.names.filter(name => name.length > 1);
  made += mapped.length + filtered.length + Number(Array.isArray(mapped)) + Number(Array.isArray(filtered));
  if (turn < 3) kept.push(mapped, filtered);
}
kept[0].push(1, 2.5, "three", { four: 4 });
kept[1].push("a");
kept[2][3] = 7;
kept[3].length = 2;
console.log(made, JSON.stringify(kept), kept.map(list => list.length).join(), 1 in kept[2], Object.keys(kept[2]).join());
