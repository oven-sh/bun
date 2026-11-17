// A loop of texts whose only check is that of a callee which is one function or undefined.
const table: any = new Map([["k", () => 7]]);
const filled: any = { part: table.get("k") };
const empty: any = { part: table.get("l") };

let first = "";
try {
  for (let i = 0; i < 40; i++) first += String(filled.part()) + "|";
} catch (error) {
  first += "threw " + (error as Error).name;
}
console.log(first);

let second = "";
try {
  for (let i = 0; i < 40; i++) second += String(empty.part()) + "|";
} catch (error) {
  second += "threw " + (error as Error).name;
}
console.log(second);

function joined(times: number): string {
  let text = "";
  for (let i = 0; i < times; i++) text += filled.part();
  return text;
}
console.log(joined(0) + "." + joined(1) + "." + joined(12));
export {};
