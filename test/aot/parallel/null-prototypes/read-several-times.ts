// The field is read twice in a row, in a short loop and in a long one.
export {};
class Mark { weight: boolean = true; }
function makeRecord(weight: number) { return { weight }; }
function readTwice(holder: any): string { return String(holder.weight) + String(holder.weight); }
function readInShortLoop(holder: any): string {
  let text = "";
  for (let turn = 0; turn < 2; turn++) text += holder.weight;
  return text;
}
function readInLongLoop(holder: any): string {
  let text = "";
  for (let turn = 0; turn < 40; turn++) text += holder.weight;
  return text;
}
const bare: any = makeRecord(-3);
Object.setPrototypeOf(bare, null);
const holders: any[] = [{ ...makeRecord(0) }, new Mark()];
for (const holder of holders) console.log(readTwice(holder), readInShortLoop(holder), readInLongLoop(holder).length);
