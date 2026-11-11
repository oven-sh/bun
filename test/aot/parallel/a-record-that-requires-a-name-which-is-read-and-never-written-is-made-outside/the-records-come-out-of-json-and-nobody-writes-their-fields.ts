// The author says what the record holds; the records themselves come out of JSON: nobody in the program writes `left` or `right`. Another literal of the file has a `kind` too.
interface Pair { kind: string; left: number[]; right: number[] }
const said: (string | number)[] = [];
function merged(pair: Pair, from: number): number {
  const left = pair.left, right = pair.right, out: number[] = [];
  let a = 0, b = from % 3;
  while (a < left.length && b < right.length) out.push(left[a]! <= right[b]! ? left[a++]! : right[b++]!);
  while (a < left.length) out.push(left[a++]!);
  while (b < right.length) out.push(right[b++]!);
  return out.length * 1000 + out[from % out.length]!;
}
const listeners: any[] = [];
function on(kind: any, run: any) { listeners.push({ kind, run }); }
function emit(kind: any, value: any, i: number) { let r = 0; for (const l of listeners) if (l.kind === kind) r = l.run(value, i); return r; }
const pair: any = JSON.parse('{"kind":"pair","left":[0,5,10,15,20,25],"right":[0,7,14,21,28]}');
on("idle", (value: any, i: number) => i); on(pair.kind, merged);
for (let i = 0; i < 12; i++) said.push(emit(pair.kind, pair, i));
console.log(said.join(" "));
export {};
