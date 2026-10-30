// What is remembered of a copy names the shapes of its source and its target and keeps neither alive. Shapes that are made for a few copies die young, shapes that are used all the time grow old,
// and new shapes may come to lie where dead ones lay: each copy has to come out right whichever collection ran in between.
type Message = { kind: string; size: number; note?: string };
type Anything = Record<string, unknown>;
let garbage: unknown[] = [];
function churn(round: number) {
  for (let i = 0; i < 1500; i++) garbage.push({ round, i, text: "x".repeat(i & 31), list: [i, round, i, round, i, round] });
  if (garbage.length > 6000) garbage = [];
}
function stamped<T extends object>(value: T, round: number) { return { ...value, stamp: round, last: true }; }
function merged(message: Message, extra: Anything): Anything { return { first: 0, ...message, ...extra }; }
function ofParsed(text: string, round: number): Anything { return { ...(JSON.parse(text) as Anything), round }; }
function rest(value: Anything) { const { kind, ...others } = value; return [kind, others] as const; }

let sum = 0;
const lines: string[] = [];
const old: Message = { kind: "old", size: 1 };
for (let round = 0; round < 300; round++) {
  const young: Anything = {};
  for (let i = 0; i < 1 + (round % 7); i++) young["name" + round + "_" + i] = round + i;
  const holder: Anything = { inner: { ["only" + round]: round }, list: [round] };
  for (let again = 0; again < 3; again++) {
    const a = stamped(young, round) as Anything;
    const b = merged(old, young);
    const c = merged({ kind: "k" + (round & 3), size: round, note: round & 1 ? "n" : undefined }, holder);
    const d = ofParsed('{"p' + (round % 11) + '":' + round + ',"kind":"parsed","q":[1,2]}', round);
    const [kind, others] = rest({ ...d, ...young });
    const e = stamped(old, round);
    sum += Object.keys(a).length * 3 + Object.keys(b).length * 5 + Object.keys(c).length * 7 + Object.keys(d).length * 11 + Object.keys(others).length * 13 + e.size + e.stamp;
    sum += (a["name" + round + "_0"] as number) + (b["name" + round + "_0"] as number) + ((c.inner as Anything)["only" + round] as number) + (d["p" + (round % 11)] as number) + (kind === "parsed" ? 1 : 0);
    if (round % 60 === 59 && !again) lines.push(JSON.stringify([a, b, c, d, others, e]));
    churn(round);
  }
  if (round === 149) Bun.gc(true);
}
lines.push(String(sum));
console.log(lines.join("\n"));
