// Bun.inspect and Response.json are called in hot loops while the program replaces them, collects garbage and restores them. Another object stands in for Buffer as an argument and as the global.
const lines: string[] = [];
const texts = ["abc", "héllo", "日本語", "", "😀"];
const rounds = 2000;

function bufferFromHot(): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += Buffer.from(texts[i % texts.length]).length;
  return sum;
}
function byteLengthHot(): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += Buffer.byteLength(texts[i % texts.length]);
  return sum;
}
function inspectEarly(): number {
  let sum = 1;
  for (let i = 0; i < rounds; i++) sum += Bun.inspect(texts[i % texts.length]).length;
  return sum;
}
function inspectHot(): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += Bun.inspect(texts[i % texts.length]).length;
  return sum;
}
function responseJSONEarly(): number {
  let sum = 1;
  for (let i = 0; i < rounds; i++) sum += Response.json({ round: i }, { status: 200 + (i % 3) }).status;
  return sum;
}
function responseJSONHot(): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += Response.json({ round: i }, { status: 200 + (i % 3) }).status;
  return sum;
}

let replacementCalls = 0;
let callsOnHolder = 0;
function countCall(receiver: unknown, holder: unknown) {
  replacementCalls++;
  if (receiver === holder) callsOnHolder++;
}
function takeCounts(): string {
  const counts = replacementCalls + " replacement calls, " + callsOnHolder + " on the holder";
  replacementCalls = 0;
  callsOnHolder = 0;
  return counts;
}

interface Case {
  label: string;
  holder: any;
  name: string;
  replacement: (this: unknown, ...values: any[]) => unknown;
  early: () => number;
  hot: () => number;
}
const cases: Case[] = [
  {
    label: "Bun.inspect",
    holder: Bun,
    name: "inspect",
    replacement: function (this: unknown, value: any) {
      countCall(this, Bun);
      return "replaced: " + value;
    },
    early: inspectEarly,
    hot: inspectHot,
  },
  {
    label: "Response.json",
    holder: Response,
    name: "json",
    replacement: function (this: unknown, value: any, init: any) {
      countCall(this, Response);
      return { status: init.status + value.round + 3000 };
    },
    early: responseJSONEarly,
    hot: responseJSONHot,
  },
];

for (const { label, holder, name, replacement, early } of cases) {
  const original = holder[name];
  holder[name] = replacement;
  lines.push(label + " replaced before the first call: " + early() + ", " + takeCounts());
  holder[name] = original;
  lines.push(label + " restored after the first call: " + early() + ", " + takeCounts());
}

for (const { label, holder, name, replacement, hot } of cases) {
  const original = holder[name];
  lines.push(label + " original: " + hot() + ", " + takeCounts());
  holder[name] = replacement;
  Bun.gc(true);
  lines.push(label + " replaced: " + hot() + ", " + takeCounts());
  holder[name] = original;
  Bun.gc(true);
  lines.push(label + " restored: " + hot() + ", " + takeCounts() + ", same function: " + (holder[name] === original));
}

const bufferLike = {
  from(text: string) {
    return { length: text.length + 5000 };
  },
  byteLength(text: string) {
    return text.length + 7000;
  },
};
function lengthsThrough(holder: typeof Buffer): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    const text = texts[i % texts.length];
    sum += holder.from(text).length + holder.byteLength(text);
  }
  return sum;
}
lines.push("Buffer as an argument: " + lengthsThrough(Buffer));
lines.push("a Buffer-like object as an argument: " + lengthsThrough(bufferLike as unknown as typeof Buffer));
lines.push("Buffer as an argument again: " + lengthsThrough(Buffer));

const realBuffer = Buffer;
(globalThis as any).Buffer = bufferLike;
lines.push("a Buffer-like object as the global: " + bufferFromHot() + " " + byteLengthHot());
(globalThis as any).Buffer = realBuffer;
lines.push("Buffer as the global again: " + bufferFromHot() + " " + byteLengthHot());

function oneInspection(text: string): unknown {
  return Bun.inspect(text);
}
let warmSum = 0;
for (let i = 0; i < rounds; i++) warmSum += String(oneInspection(texts[i % texts.length])).length;
lines.push("one call at a time: " + warmSum);

(Bun as any).inspect = undefined;
Bun.gc(true);
const laterFunctions: Function[] = [];
for (let i = 0; i < 5000; i++) laterFunctions.push(new Function("text", "return 7"));
let wrongAnswers = 0;
for (const laterFunction of laterFunctions) {
  (Bun as any).inspect = laterFunction;
  if (oneInspection("abc") !== 7) wrongAnswers++;
}
lines.push("functions created after the original was dropped and collected: " + wrongAnswers + " wrong answers");

console.log(lines.join("\n"));
