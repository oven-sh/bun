// A function is written to take a record, and what arrives was put together under computed names, so the test at its entry fails and its slow body runs.
// What the slow body returns is held to the type that callers hold of the result. An object that it has just made is of its own layout: nothing is asked of the run time.
// A result that something else made, here a constructor, is asked for as before: 41 times 50 calls.
// COUNT: operation:operationAOTValueHasType <= 2050
interface Item { sku: string; quantity: number; unitCents: number }
interface Line { sku: string; lineCents: number }
const names = JSON.parse('["sku","quantity","unitCents"]') as string[];
function puzzledTogether(at: number): Item {
  const item: Record<string, unknown> = {};
  const values: unknown[] = ["s" + at, (at % 7) + 1, 100 + at];
  for (let i = 0; i < names.length; i++) item[names[i]!] = values[i];
  return item as unknown as Item;
}
const lineOf = (item: Item): Line => ({ sku: item.sku, lineCents: item.quantity * item.unitCents });
const nested = (item: Item): { line: Line; twice: Line[] } => ({ line: { sku: item.sku, lineCents: item.unitCents }, twice: [{ sku: item.sku, lineCents: 1 }, { sku: "x", lineCents: item.quantity }] });
class Priced { constructor(readonly sku: string, readonly cents: number) {} }
const made = (item: Item): Priced => new Priced(item.sku, item.quantity * item.unitCents);
const items: Item[] = [];
for (let at = 0; at < 50; at++) items.push(puzzledTogether(at));
let sum = 0;
const said: string[] = [];
for (let turn = 0; turn < 40; turn++) {
  const lines = items.map(lineOf);
  for (const line of lines) sum += line.lineCents + line.sku.length;
  for (const both of items.map(nested)) sum += both.line.lineCents + both.twice[1]!.lineCents + both.twice.length;
  for (const priced of items.map(made)) sum += priced.cents;
  if (turn === 0) said.push(JSON.stringify(lines.slice(0, 3)), JSON.stringify(items.map(nested)[4]), JSON.stringify(items.map(made)[5]), String(lines[0] === items.map(lineOf)[0]));
}
console.log(sum, said.join(" "));
