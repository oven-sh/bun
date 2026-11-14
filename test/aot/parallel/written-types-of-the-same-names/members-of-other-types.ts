interface Count { value: number; note?: string }
interface Label { value: string; note?: string }
interface Flags { value: boolean[]; note?: string }

function count(value: number): Count { return { value, note: "n" }; }
function label(value: string): Label { return { value }; }
function flags(value: boolean[]): Flags { return { value, note: undefined }; }
function show(item: Count | Label | Flags): string {
  return typeof item.value + String(item.value) + String(item.note);
}
let text = "";
for (let turn = 0; turn < 300; turn++) text = show(count(turn)) + show(label("t" + turn)) + show(flags([turn % 2 === 0]));
console.log(text);
