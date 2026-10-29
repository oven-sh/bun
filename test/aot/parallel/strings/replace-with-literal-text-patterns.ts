// text.replace(/&/g, "&amp;"): patterns that are one character or one literal text, with everything a program can observe around the call.
const lines: string[] = [];
function show(label: string, value: unknown): void {
  lines.push(label + ": " + (typeof value === "string" ? JSON.stringify(value) : String(value)));
}
function statics(): string {
  const legacy = RegExp as unknown as Record<string, string>;
  return JSON.stringify([legacy["lastMatch"], legacy["leftContext"], legacy["rightContext"], legacy["input"], legacy["$1"]]);
}
function rope(a: string, b: string): string {
  return a + "-0123456789012345678901234567890123456789-" + b;
}
const wide = "Ж & Ж & z";
const subjects: string[] = [
  "", "&", "&&", "a", "a&", "&a", "a&b", "a & b & c", "nothing to see here at all, truly nothing",
  "R&D fast eco R&D light eco modern R&D", "eco", "ecoeco", "ec", "eceo eco", "<b>bold</b> & \"quoted\"",
  rope("left & side", "right"), rope("left", "right & side"), rope("eco", "eco"), rope("plain", "plain"),
  "xx a&b eco yy".substring(3, 10), "0123456789 nothing here 0123456789".substring(5, 25),
  wide, "ЖЖ", wide.substring(2), "line\n&\nline",
];

/x(y)/.exec("xy");
for (const text of subjects) {
  show("subject", text);
  const one = text.replace(/&/g, "&amp;");
  show("  one character", one); show("  same", one === text); show("  statics", statics());
  const word = text.replace(/eco/g, "green");
  show("  one word", word); show("  same", word === text); show("  statics", statics());
  show("  first only", text.replace(/&/, "+")); show("  statics", statics());
  show("  first word only", text.replace(/eco/, "")); 
  show("  removed", text.replace(/&/g, ""));
  show("  dollar", text.replace(/&/g, "[$&]")); show("  two dollars", text.replace(/&/g, "$$")); show("  before", text.replace(/eco/g, "$`"));
  show("  wide replacement", text.replace(/&/g, "Ж")); show("  wide pattern", text.replace(/Ж/g, "Zh"));
  show("  longer", text.replace(/&/g, "0123456789012345678901234567890123456789"));
  show("  escaped", text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
  show("  i", text.replace(/ECO/gi, "E")); show("  m", text.replace(/&/gm, "M")); show("  s", text.replace(/&/gs, "S"));
  show("  u", text.replace(/&/gu, "U")); show("  v", text.replace(/&/gv, "V")); show("  d", text.replace(/&/dg, "D"));
  show("  y", text.replace(/&/y, "Y")); show("  gy", text.replace(/&/gy, "Y")); show("  all", text.replaceAll(/&/g, "A"));
  show("  statics", statics());
}

function digest(text: string): string {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) % 1000003;
  return text.length + " " + sum + " " + JSON.stringify(text.slice(0, 20)) + " " + JSON.stringify(text.slice(-20));
}
for (const count of [1, 2, 3, 15, 16, 17, 31, 32, 33, 34, 64, 65, 1000, 40000]) {
  const spread = "a&".repeat(count), tight = "&".repeat(count), words = "eco ".repeat(count), run = "a".repeat(count);
  show("spread " + count, digest(spread.replace(/&/g, "&amp;"))); show("  statics", digest(statics()));
  show("tight " + count, digest(tight.replace(/&/g, "<>")));
  show("same length " + count, digest(tight.replace(/&/g, "+")));
  show("shorter " + count, digest(words.replace(/eco/g, "e"))); show("  statics", digest(statics()));
  show("much longer " + count, digest(words.replace(/eco/g, "green and a good deal more")));
  show("overlapping " + count, digest(run.replace(/aa/g, "b")));
  show("ends " + count, digest(("&" + run + "&").replace(/&/g, "[]")));
  show("whole " + count, digest(run.replace(new RegExp(run, "g"), "z")));
}
show("one character out", "eco".replace(/eco/g, "e")); show("two out", "ecoeco".replace(/eco/g, "e"));
show("high Latin-1", "caf\u00e9 & cr\u00e8me".replace(/\u00e9/g, "e").replace(/&/g, "\u00a7"));

const kept = /&/g;
for (const start of [0, 1, 5, 100, -1, 1.5]) {
  kept.lastIndex = start;
  show("from " + start, "a&b&c".replace(kept, "+")); show("  lastIndex", kept.lastIndex);
  kept.lastIndex = start;
  show("miss from " + start, "abc".replace(kept, "+")); show("  lastIndex", kept.lastIndex);
}
const single = /&/;
single.lastIndex = 3;
show("not global", "a&b&c".replace(single, "+")); show("  lastIndex", single.lastIndex);
show("not global, miss", "abc".replace(single, "+")); show("  lastIndex", single.lastIndex);

const odd = /&/g;
let asked = 0;
(odd as unknown as { lastIndex: unknown }).lastIndex = { valueOf() { asked++; return 1; } };
show("lastIndex an object", "a&b".replace(odd, "+")); show("  asked", asked); show("  lastIndex", odd.lastIndex);
(odd as unknown as { lastIndex: unknown }).lastIndex = "2";
show("lastIndex a string", "abc".replace(odd, "+")); show("  lastIndex", odd.lastIndex);

for (const text of ["a&b", "abc"]) {
  const frozen = Object.freeze(/&/g);
  try { show("frozen", text.replace(frozen, "+")); } catch (error) { show("frozen throws", (error as Error).constructor.name); }
  const fixed = /&/g;
  Object.defineProperty(fixed, "lastIndex", { writable: false, value: 0 });
  try { show("fixed lastIndex", text.replace(fixed, "+")); } catch (error) { show("fixed lastIndex throws", (error as Error).constructor.name); }
  const fixedSingle = /&/;
  Object.defineProperty(fixedSingle, "lastIndex", { writable: false, value: 0 });
  try { show("fixed lastIndex, not global", text.replace(fixedSingle, "+")); } catch (error) { show("throws", (error as Error).constructor.name); }
}

class Louder extends RegExp {
  override exec(text: string): RegExpExecArray | null { lines.push("Louder.exec " + JSON.stringify(text)); return super.exec(text); }
}
show("subclass", "a&b".replace(new Louder("&", "g"), "+"));
const own = /&/g;
(own as unknown as { exec: unknown }).exec = function (this: RegExp, text: string) { lines.push("own exec"); return RegExp.prototype.exec.call(this, text); };
show("own exec", "a&b".replace(own, "+")); show("own exec, miss", "abc".replace(own, "+"));
const extra = /&/g;
(extra as unknown as { note: number }).note = 1;
show("own property", "a&b".replace(extra, "+")); show("own property, miss", "abc".replace(extra, "+"));

console.log(lines.join("\n"));
