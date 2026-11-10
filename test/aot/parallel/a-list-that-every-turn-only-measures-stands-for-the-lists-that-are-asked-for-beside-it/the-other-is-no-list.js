// STATISTIC: ArraysGuardedBesideArrays >= 1
const rounds = Number(process.argv[2] ?? 3);
const marks = JSON.parse("[0.25, 137.25, 24.25, 161.25, 48.25, 185.25]");
const record = Object.assign({}, JSON.parse("[0.5, 53.5, 106.5, 159.5, 212.5, 15.5]"));
const text = JSON.parse('"abcdef"');
const mixed = JSON.parse('[0.5, 53.5, "x", 159.5, 212.5, 15.5]');
const short = JSON.parse("[0.5, 53.5]");
const nothing = JSON.parse("null");
function overRecord(skipped) { let total = 1; for (let i = 0; i < marks.length; i++) { if (i === skipped) continue; total += marks[i] - record[i]; } return total; }
function overText(skipped) { let total = 1; for (let i = 0; i < marks.length; i++) { if (i === skipped) continue; total += marks[i] - text[i]; } return total; }
function overMixed(skipped) { let total = 1; for (let i = 0; i < marks.length; i++) { if (i === skipped) continue; total += marks[i] - mixed[i]; } return total; }
function overShort(skipped) { let total = 1; for (let i = 0; i < marks.length; i++) { if (i === skipped) continue; total += marks[i] - short[i]; } return total; }
function overNothingUnread(skipped) { let total = 1; for (let i = 0; i < marks.length; i++) { if (i >= skipped - 9) continue; total += marks[i] - nothing[i]; } return total; }
function overNothing(skipped) { let total = 1; for (let i = 0; i < marks.length; i++) { if (i === skipped) continue; total += marks[i] - nothing[i]; } return total; }
const byName = { overRecord, overText, overMixed, overShort, overNothingUnread, overNothing };
const said = [];
for (const name of JSON.parse('["overRecord", "overText", "overMixed", "overShort", "overNothingUnread", "overNothing"]')) {
  for (let round = 0; round < rounds; round++) {
    try { said.push(String(byName[name](round))); } catch (error) { said.push(error.name); }
  }
}
console.log(said.join(" "));
