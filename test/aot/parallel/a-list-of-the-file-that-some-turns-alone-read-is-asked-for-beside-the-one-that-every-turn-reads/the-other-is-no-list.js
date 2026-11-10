// STATISTIC: ListsAskedForBesideListsInFrontOfLoops >= 1
const rounds = Number(process.argv[2] ?? 3);
const marks = JSON.parse("[0.25, 137.25, 24.25, 161.25, 48.25, 185.25, 72.25, 209.25]");
const record = Object.assign({}, JSON.parse("[0.5, 53.5, 106.5, 159.5, 212.5, 15.5, 68.5, 121.5]"));
const text = JSON.parse('"abcdefgh"');
const mixed = JSON.parse('[0.5, 53.5, 106.5, "x", 212.5, 15.5, 68.5, 121.5]');
const short = JSON.parse("[0.5, 53.5]");
const nothing = JSON.parse("null");
function overRecord(start) { let total = start & 3; for (let i = 0; i < marks.length; i++) { if (marks[i] < 100) continue; total += record[i]; } return total; }
function overText(start) { let total = start & 3; for (let i = 0; i < marks.length; i++) { if (marks[i] < 100) continue; total += text[i]; } return total; }
function overMixed(start) { let total = start & 3; for (let i = 0; i < marks.length; i++) { if (marks[i] < 100) continue; total += mixed[i]; } return total; }
function overShort(start) { let total = start & 3; for (let i = 0; i < marks.length; i++) { if (marks[i] < 100) continue; total += short[i]; } return total; }
function overNothingUnread(start) { let total = start & 3; for (let i = 0; i < marks.length; i++) { if (marks[i] < 1000) continue; total += nothing[i]; } return total; }
function overNothing(start) { let total = start & 3; for (let i = 0; i < marks.length; i++) { if (marks[i] < 100) continue; total += nothing[i]; } return total; }
const byName = { overRecord, overText, overMixed, overShort, overNothingUnread, overNothing };
const said = [];
for (const name of JSON.parse('["overRecord", "overText", "overMixed", "overShort", "overNothingUnread", "overNothing"]')) {
  for (let round = 0; round < rounds; round++) {
    try { said.push(String(byName[name](round))); } catch (error) { said.push(error.name); }
  }
}
console.log(said.join(" "));
