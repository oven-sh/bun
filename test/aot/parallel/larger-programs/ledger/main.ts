// Accounts in several currencies, entries that balance, holds, interest, reports by period, events that are replayed, undo and redo by compensating entries, in two modules
import { Money, LedgerError, Savings, Entry, Ledger } from "./lib";
const ledger = new Ledger("books");
ledger.open("cash", "asset", "EUR");
ledger.open("bank", "asset", "EUR");
ledger.open("card", "credit", "EUR", "500.00");
ledger.open("savings", "savings", "EUR", "25");
ledger.open("sales", "income", "EUR");
ledger.open("rent", "expense", "EUR");
ledger.open("equity", "equity", "EUR");
ledger.open("yen", "asset", "JPY");
ledger.open("yen-equity", "equity", "JPY");
ledger.post("start", ["equity", "-10000.00"], ["cash", "4000.00"], ["bank", "6000.00"]);
ledger.post("yen start", ["yen-equity", "-500000"], ["yen", "500000"]);
const attempt = (what: () => unknown) => {
  try {
    const r = what();
    return r instanceof Object && "id" in r ? "entry " + (r as Entry).id : String(r);
} catch (e) {
    return `${(e as Error).name} ${e instanceof LedgerError ? e.code : ""} ${(e as Error).message}`;
  }
};
for (const f of [() => ledger.post("off", ["cash", "1.00"], ["bank", "-2.00"]),
  () => ledger.post("over", ["cash", "-9999.00"], ["rent", "9999.00"]),
  () => ledger.post("card", ["card", "-450.50"], ["rent", "450.50"]),
  () => ledger.post("card again", ["card", "-100.00"], ["rent", "100.00"]),
  () => ledger.post("mixed", ["cash", "-1.00"], ["yen", "1"]), () => ledger.post("digits",
  ["cash", "0.001"], ["bank", "-0.001"]), () => ledger.hold("h1", "cash", "3900.00"),
  () => ledger.post("held", ["cash", "-200.00"], ["rent", "200.00"]),
  () => ledger.release("h1", "cash", "rent"), () => ledger.release("h1", "cash"),
  () => ledger.close("cash"), () => ledger.undo(), () => ledger.redo(), () => ledger.redo(),
  () => ledger.account("none"), () => Money.of("12.34", "EUR").split(1, 1, 1).join(" "),
  () => Money.of("100", "JPY").convert("EUR", 62n, 10000n), () => Money.of("10.00",
  "EUR").convert("JPY", 1613n, 10n), () => Money.of("1.00", "USD").plus(Money.of("1", "JPY")),
  () => Money.of("-0.05", "USD").times(1n, 2n)]) console.log(attempt(f));
let seed = 5;
const random = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
const counts: Record<string, number> = {
};
for (let day = 0; day < 365; day++) {
  ledger.clock = day;
  for (let k = 0; k < 6; k++) {
    const n = (random(20000) / 100).toFixed(2);
    const result = attempt(() => {
      switch (random(8)) {
        case 0: return ledger.post("sale", ["sales", "-" + n], ["cash", n]);
        case 1: return ledger.post("rent", ["bank", "-" + n], ["rent", n]);
        case 2: return ledger.post("save", ["cash", "-" + n], ["savings", n]);
        case 3: return ledger.post("deposit", ["cash", "-" + n], ["bank", n]);
        case 4: return ledger.undo();
        case 5: return ledger.redo();
        case 6: return ledger.post("split", ...Money.of(n, "EUR").split(3, 2, 1).map((m,
          i): [string, Money] => [["cash", "bank", "rent"][i], m]), ["sales", Money.of(n,
          "EUR").negate()]);
        default: return ledger.post("card", ["bank", "-" + n], ["card", n]);
      }
  });
    const key = result.startsWith("entry") ? "fine" : result.split(" ").slice(0, 2).join(" ");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  if (day % 30 === 29) ledger.accrue("equity");
}
console.log(JSON.stringify(counts), ledger.entries.length, ledger.events.length,
  ledger.trial());
for (const a of ledger.accounts.values()) console.log(a.name, String(a.balance), a.entries,
  a instanceof Savings ? a.accrued : "", a.sign);
for (const [a, b] of [[0, 90], [90, 180], [0,
  Infinity]]) console.log(JSON.stringify(ledger.report(a, b)));
const copy = Ledger.replay("copy",
  JSON.parse(JSON.stringify(ledger.events)) as typeof ledger.events);
console.log(copy.trial() === ledger.trial(),
  JSON.stringify(copy.report()) === JSON.stringify(ledger.report()), copy.entries.length,
  [...copy.accounts.values()].every(a => a.balance.units === ledger.account(a.name).balance.units));
let undone = 0;
while (attempt(() => ledger.undo()).startsWith("entry")) undone++;
console.log(undone, ledger.trial(), String(ledger.account("cash").balance));
