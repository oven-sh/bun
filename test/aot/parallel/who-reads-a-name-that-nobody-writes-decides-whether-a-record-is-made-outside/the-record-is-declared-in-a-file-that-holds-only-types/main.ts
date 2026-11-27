// As most projects write it: the record stands in a file that holds only types and is reached by `import type`: that file leaves no module in the program. The pairs come out of JSON; nobody writes `left` or `right`; another literal has a `kind`.
import type { Named, Pair } from "./types";
const said: (string | number)[] = [];
function merged(pair: Pair, from: number): number {
  const left = pair.left, right = pair.right, out: number[] = [];
  let a = 0, b = from % 3;
  while (a < left.length && b < right.length) out.push(left[a]! <= right[b]! ? left[a++]! : right[b++]!);
  while (a < left.length) out.push(left[a++]!);
  while (b < right.length) out.push(right[b++]!);
  return out.length * 1000 + out[from % out.length]!;
}
function named(value: Named): string { return value.kind + "/" + value.name; }
const listeners: any[] = [];
function on(kind: any, run: any) { listeners.push({ kind, run }); }
function emit(kind: any, value: any, i: number) { let r: any = 0; for (const l of listeners) if (l.kind === kind) r = l.run(value, i); return r; }
const pair: any = JSON.parse('{"kind":"pair","left":[0,5,10,15,20,25],"right":[0,7,14,21,28]}');
on("idle", (value: any, i: number) => i); on(pair.kind, merged); on("named", named);
for (let i = 0; i < 12; i++) said.push(emit(pair.kind, pair, i));
said.push(emit("named", { kind: "written", name: "here" }, 0), emit("named", JSON.parse('{"kind":"parsed","name":"there"}'), 0));
try { said.push(emit(pair.kind, { kind: "pair", run() {} }, 0)); } catch (error) { said.push((error as Error).constructor.name); }
console.log(said.join(" "));
