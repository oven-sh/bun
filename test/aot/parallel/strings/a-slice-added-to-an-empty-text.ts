// `var word = ""; .. return word + text.slice(from, to)`: the text is built piece by piece only where an escape is met, so nearly always it is the one slice.
// The texts: 8-bit, 16-bit, joined and not yet flat, a slice of a slice, and one longer than a builder holds in its frame.
const made = (text: string) => text + String(Date.now()).slice(99);

function word(text: string, from: number): string {
  let out = "";
  let start = from;
  let at = from;
  while (at < text.length) {
    const unit = text.charCodeAt(at);
    if (unit === 92) {
      out += text.slice(start, at);
      out += String.fromCharCode(text.charCodeAt(at + 1) - 32);
      at += 2;
      start = at;
    } else if (unit === 32) break;
    else at++;
  }
  return out + text.slice(start, at);
}

function words(text: string): string[] {
  const found: string[] = [];
  for (let at = 0; at < text.length; ) {
    const next = word(text, at);
    found.push(next);
    let raw = at;
    while (raw < text.length && text.charCodeAt(raw) !== 32) raw++;
    at = raw + 1;
  }
  return found;
}

function followed(text: string, from: number, to: number, count: number, tail: string): string {
  let out = "";
  out += text.slice(from, to);
  for (let i = 0; i < count; i++) {
    out += i;
    out += ",";
    out += tail;
    out += text.slice(from + i, to);
  }
  return out;
}

function lengths(text: string, from: number, to: number, more: boolean): number[] {
  let out = "";
  const seen = [out.length];
  out += text.slice(from, to);
  seen.push(out.length);
  if (more) {
    out += "!";
    seen.push(out.length);
    out += text.slice(from, to);
    seen.push(out.length);
  }
  seen.push(out.length, out.charCodeAt(out.length - 1));
  return seen;
}

function given(text: string, from: number, to: number, fails: boolean): string {
  let out = "";
  try {
    out += text.slice(from, to);
    if (fails) throw new Error("after " + (to - from));
    out += ".";
  } catch (error) {
    return (error as Error).message;
  }
  return out;
}

const counts: Record<string, number> = { alpha: 1, "βeta": 2, "gamma": 3 };
function counted(text: string, from: number, to: number): number {
  let name = "";
  if (from < 0) name += "never";
  return counts[name + text.slice(from, to)] ?? -1;
}

const narrow = made("alpha be\\ta g \\x\\y gamma  de");
const wide = made("alpha βeta g\\a\\b λ xy \\q gamma δδ");
const joined = made("alpha ") + made("βeta ") + made("gam") + made("ma x");
const inner = made("__" + wide + "__").slice(2, -2);
const long = made("0123456789abcdeφ").repeat(40) + " " + made("0123456789abcdef").repeat(40);

for (const text of [narrow, wide, joined, inner, long]) {
  const found = words(text);
  console.log(found.length, found.map(one => (one.length > 20 ? one.length + ":" + one.slice(0, 4) + one.slice(-4) : one)).join("|"));
}
for (const text of [narrow, wide, joined, long]) {
  for (const [from, to] of [[0, 0], [0, 1], [0, 2], [0, 3], [6, 10], [3, 3], [1, 200]] as const) {
    const end = Math.min(to, text.length);
    const all = [followed(text, from, end, 0, "-"), followed(text, from, end, 1, "-"), followed(text, from, end, 3, "λ")];
    console.log(from, end, all.map(one => (one.length > 40 ? one.length + ":" + one.slice(0, 6) + one.slice(-6) : one)).join("|"));
    console.log(lengths(text, from, end, false).join(), lengths(text, from, end, true).join(), given(text, from, end, false).length, given(text, from, end, true));
  }
}
console.log(counted(narrow, 0, 5), counted(wide, 0, 5), counted(wide, 6, 10), counted(joined, 6, 10), counted(joined, 11, 16), counted(wide, 0, 4), counted(wide, 0, 0));
let kept: string[] = [];
for (let i = 0; i < 20000; i++) {
  const one = word(wide, (i % 3) * 6);
  if (i % 4000 === 0) kept.push(one);
  if (i % 5000 === 0) Bun.gc(true);
}
console.log(kept.join());
