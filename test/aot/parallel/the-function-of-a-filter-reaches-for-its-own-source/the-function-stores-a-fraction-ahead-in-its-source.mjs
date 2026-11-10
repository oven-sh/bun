// STATISTIC: StoragesTakenFromInFrontOfTurnsThatFillWhatIsMadeHere >= 4
const turns = Number(process.argv[2] ?? 3);
function made(kind) {
  if (kind === 0) return [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }, { v: 6 }, { v: 7 }, { v: 8 }];
  if (kind === 1) return [1, 2, 3, 4, 5, 6, 7, 8];
  if (kind === 2) return ["a", "bb", "ccc", "dddd", "e", "ff", "ggg", "hhhh"];
  return [1, "bb", { v: 3 }, null, undefined, 6, true, 8.5];
}
function show(list) { return list.length + ":" + list.map(x => (x && typeof x === "object" ? "o" + x.v : String(x))).join(","); }
function run(kind, n) { let said = ""; for (let turn = 0; turn < n; turn++) { const list = made(kind); const got = list.filter((x, i) => { if (i === 1) list[4] = 0.5; return true; }); said = (typeof got === "string" ? got : show(got)) + "|" + show(list).slice(0, 200); } return said; }
for (let kind = 0; kind < 4; kind++) console.log(kind, run(kind, turns));
