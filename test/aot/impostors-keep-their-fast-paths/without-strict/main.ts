interface Ledger {
  credit: number;
  debit: number;
  note: string;
}

function balanceOf(ledger: Ledger): number {
  return ledger.credit - ledger.debit + ledger.note.length;
}

function everyTypeAdmitsNull(): () => number {
  const ledgers: Ledger[] = [];
  for (let i = 0; i < 100; i++) ledgers.push({ credit: i * 2, debit: i, note: "n" });
  return function turnOfEveryTypeAdmitsNull() {
    let total = 0;
    for (let i = 0; i < 100; i++) total += balanceOf(ledgers[i]);
    return total;
  };
}

const cases: Record<string, () => () => number> = {
  "15 without strict every type admits null and undefined": everyTypeAdmitsNull,
};
const [wanted = "names", ...windows] = process.argv.slice(2);

if (wanted === "names") {
  console.log(Object.keys(cases).join("\n"));
} else {
  const turn = cases[wanted]();
  let result = 0;
  for (const window of windows) {
    const rounds = Number(window);
    for (let round = 0; round < rounds; round++) result = turn();
    process.kill(process.pid, 0);
  }
  console.log(wanted + ":", result);
}
