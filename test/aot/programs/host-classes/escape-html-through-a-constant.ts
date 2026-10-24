// `const escape = Bun.escapeHTML`: calls through the constant, through a variable that changes, through a property and of another function give what plain Bun gives for every kind of string, for null, undefined and numbers, and after `Bun.escapeHTML` is replaced.
const escape = Bun.escapeHTML;
let changing: (text: string) => string = Bun.escapeHTML;
const other = (text: string) => `(${text})`;
const another = [other, Bun.escapeHTML][0];
const holder = { escape: Bun.escapeHTML };

function title(text: string): string {
  return `<h1>${escape(text)}</h1>`;
}
function link(address: string, text: string): string {
  return `<a href="${escape(address)}">${escape(text)}</a>`;
}
function orNothing(text: string | null | undefined): string {
  return escape(text as string);
}
function ofAnything(value: unknown): string {
  return escape(value as any);
}
function ofANumber(value: number): string {
  return escape(value);
}
function throughAVariable(text: string): string {
  return changing(text);
}
function throughAnother(text: string): string {
  return another(text);
}
function asAMethod(text: string): string {
  return holder.escape(text);
}

const filler = "0123456789abcdef".repeat(5);
const texts: string[] = [
  "",
  "a",
  "plain",
  "&",
  "<>\"'&",
  "a<b",
  "tail>",
  "<head",
  filler,
  filler + "<",
  "<" + filler,
  filler + "&" + filler,
  filler.slice(0, 15) + "'",
  filler.slice(0, 16) + "\"",
  filler.slice(0, 17) + ">",
  "café & crème",
  "ÿþ<ý",
  "東京",
  "東京 <b>大阪</b> & 😀",
  "lone \ud83d & \ude00 halves",
  "\u0000<\u0001",
];
for (const text of texts) {
  console.log(JSON.stringify([title(text), link(text, text), orNothing(text), ofAnything(text), throughAVariable(text), throughAnother(text), asAMethod(text)]));
  const rope = text + "|" + text;
  console.log(JSON.stringify([title(rope), title(rope.slice(1)), title((filler + text).slice(3, -1)), rope]));
}
console.log(JSON.stringify([orNothing(null), orNothing(undefined), ofANumber(1.5), ofANumber(-0), ofANumber(NaN)]));
for (const value of [null, undefined, true, 12, 12n, { toString: () => "<object>" }, ["<", ">"]]) {
  try {
    console.log(JSON.stringify(ofAnything(value)));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
for (const value of [Symbol("s"), { toString: () => { throw new RangeError("no text"); } }]) {
  try {
    console.log(ofAnything(value));
  } catch (error) {
    console.log((error as Error).constructor.name, (error as Error).message);
  }
}
changing = other;
console.log(throughAVariable("<changed>"));
const original = Bun.escapeHTML;
(Bun as unknown as { escapeHTML: unknown }).escapeHTML = other;
console.log(title("<kept>"), Bun.escapeHTML("<replaced>"));
(Bun as unknown as { escapeHTML: unknown }).escapeHTML = original;
let length = 0;
for (let round = 0; round < 20000; round++) {
  length += title("round " + round + (round % 3 ? "" : " <&> ") + (round % 7 ? "" : "東")).length;
  if (round % 5000 === 0) Bun.gc(true);
}
console.log(length);
