const hidden = new Function("v", "return v") as <V>(v: V) => V;

function atCommas(text: string): string[] { return text.split(","); }
function atSlashes(text: string): string[] { return text.split("/"); }
function atArrows(text: string): string[] { return text.split("->"); }
function atWide(text: string): string[] { return text.split("・"); }
function atLatin(text: string): string[] { return text.split("é"); }
function everyUnit(text: string): string[] { return text.split(""); }
function atMostTwo(text: string): string[] { return text.split(",", 2); }
function atMostNone(text: string): string[] { return text.split(",", 0); }
function byText(text: string, separator: string): string[] { return text.split(separator); }
function byTextAndLimit(text: string, separator: string, limit: number): string[] { return text.split(separator, limit); }

const all = [atCommas, atSlashes, atArrows, atWide, atLatin, everyUnit, atMostTwo, atMostNone];
const texts = [
  "", ",", ",,", "a", "a,b", "a,b,c,d", ",a,", "no separator at all", "/usr/local/lib/node_modules", "a->b->c", "->", "一・二・三", "café,été", "x".repeat(300) + "," + "y".repeat(300),
  "accept-encoding, user-agent, host", Array.from({ length: 200 }, (_, i) => String(i)).join(","),
];
const subjects: string[] = [];
for (const text of texts) {
  subjects.push(text);
  subjects.push(hidden(text.split("").join("")));
  subjects.push(hidden(hidden(text.slice(0, 2)) + hidden(text.slice(2))));
  subjects.push(hidden(("<<" + text + ">>").split("").join("")).slice(2, -2));
  subjects.push(hidden(("日" + text).split("").join("")).slice(1));
}

let digest = 0;
function note(pieces: string[]): void {
  digest = (digest * 31 + pieces.length) | 0;
  for (const piece of pieces) {
    digest = (digest * 31 + piece.length) | 0;
    if (piece.length) digest = (digest * 31 + piece.charCodeAt(0) + piece.charCodeAt(piece.length - 1)) | 0;
  }
}
const rounds = Number(process.argv[2] ?? 5);
for (let round = 0; round < rounds; round++) {
  for (const subject of subjects) {
    for (const cut of all) note(cut(subject));
    note(byText(subject, hidden(",")));
    note(byText(subject, hidden("-") + hidden(">")));
    note(byText(subject, subject));
    note(byTextAndLimit(subject, hidden(","), round % 4));
    note(byTextAndLimit(subject, hidden(","), -1));
    note(byTextAndLimit(subject, hidden(","), 2 ** 32 + 1));
  }
}
// What most calls are: a short text, a few pieces.
const short = subjects.filter(subject => subject.length > 2 && subject.length < 40);
let pieces = 0;
for (let round = 0; round < rounds * 20; round++) {
  for (const text of short) pieces += atCommas(text).length + atSlashes(text).length;
}
// The result is an ordinary array of its own.
const first = atCommas("a,b,c"), second = atCommas("a,b,c");
first.push("d"); first[0] = "z"; (first as unknown as { extra: number }).extra = 1;
console.log(digest, pieces, first.join("|"), second.join("|"), first === second, Array.isArray(first), Object.keys(second).join(), JSON.stringify(atCommas(hidden("x,,y"))), atCommas(hidden("p,q")).concat(["r"]).length);
