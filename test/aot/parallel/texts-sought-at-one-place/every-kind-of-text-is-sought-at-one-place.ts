// A text is asked whether another one stands at its start, at its end or at a given place, by startsWith, endsWith, lastIndexOf(x, 0) and indexOf(x, place):
// flat, joined and cut texts, narrow and wide, sought texts from the empty one to one longer than the text, and positions of every kind.
const shift = process.argv.length - 2;
const letters = (count: number, from: number, wide: boolean): string => {
  const units: number[] = [];
  for (let i = 0; i < count; i++) units.push((wide && i % 3 === 1 ? 0x416 : 97) + ((from + i + shift) % 26));
  return String.fromCharCode(...units);
};
const flat = (text: string): string => JSON.parse(JSON.stringify(text));
type Maker = (text: string) => string;
const makers: [string, Maker][] = [
  ["flat", text => flat(text)],
  ["two parts", text => flat(text.slice(0, text.length >> 1)) + flat(text.slice(text.length >> 1))],
  ["a short part first", text => flat(text.slice(0, 1)) + flat(text.slice(1))],
  ["three parts", text => `${flat(text.slice(0, text.length / 3 | 0))}${flat(text.slice(text.length / 3 | 0, text.length - 1))}${flat(text.slice(text.length - 1))}`],
  ["parts of parts", text => (flat(text.slice(0, 1)) + flat(text.slice(1, 2))) + flat(text.slice(2))],
  ["cut", text => flat("<<" + text + ">>").substring(2, 2 + text.length)],
  ["cut out of a wide text", text => flat("\u0416<" + text + ">\u0416").substring(2, 2 + text.length)],
  ["cut out of parts", text => (flat("<<" + text.slice(0, 2)) + flat(text.slice(2) + ">>")).slice(2, 2 + text.length)],
];
const sizes = [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 34, 41, 70];

function startsByLastIndexOf(text: string, sought: string): boolean { return text.lastIndexOf(sought, 0) === 0; }
function endsByIndexOf(text: string, sought: string): boolean { const place = text.length - sought.length; return place >= 0 && text.indexOf(sought, place) === place; }
function starts(text: string, sought: string): boolean { return text.startsWith(sought); }
function ends(text: string, sought: string): boolean { return text.endsWith(sought); }
function startsAt(text: string, sought: string, place: number): boolean { return text.startsWith(sought, place); }
function foundFrom(text: string, sought: string, place: number): number { return text.indexOf(sought, place); }
function foundUpTo(text: string, sought: string, place: number): number { return text.lastIndexOf(sought, place); }
function endsAt(text: string, sought: string, place: number): boolean { return text.endsWith(sought, place); }
const ofAnything: ((text: any, sought: any, place: any) => unknown)[] = [
  (text, sought, place) => text.startsWith(sought, place),
  (text, sought, place) => text.indexOf(sought, place),
  (text, sought, place) => text.lastIndexOf(sought, place),
  (text, sought, place) => text.endsWith(sought, place),
  (text, sought) => text.startsWith(sought),
  (text, sought) => text.endsWith(sought),
  (text, sought) => text.lastIndexOf(sought, 0),
  (text, sought) => text.indexOf(sought, 0),
];

function changed(text: string, at: number): string { return text.slice(0, at) + String.fromCharCode(text.charCodeAt(at) ^ 1) + text.slice(at + 1); }
function soughtIn(text: string): string[] {
  const size = text.length;
  const all = ["", text, text + "a", "a" + text, text + text];
  for (const part of [1, 2, 3, 4, 7, 8, 9, 16, 31, 32, 33]) {
    if (part > size) break;
    const head = text.slice(0, part), tail = text.slice(size - part), middle = text.slice((size - part) >> 1, ((size - part) >> 1) + part);
    all.push(head, tail, middle, changed(head, 0), changed(head, part - 1), changed(head, part >> 1), changed(tail, 0), changed(tail, part - 1), changed(tail, part >> 1));
  }
  return all;
}

let digest = 0;
const mix = (value: unknown): void => { digest = (Math.imul(digest, 31) + (typeof value === "number" ? value + 7 : value === true ? 3 : value === false ? 5 : 11)) | 0; };
for (const wideText of [false, true]) {
  for (const [nameOfText, makeText] of makers) {
    for (const [nameOfSought, makeSought] of makers) {
      digest = 0;
      for (const size of sizes) {
        const text = letters(size, size, wideText);
        for (const sought of soughtIn(text)) {
          mix(startsByLastIndexOf(makeText(text), makeSought(sought)));
          mix(endsByIndexOf(makeText(text), makeSought(sought)));
          mix(starts(makeText(text), makeSought(sought)));
          mix(ends(makeText(text), makeSought(sought)));
          for (const place of [0, 1, size - sought.length, size - sought.length - 1, size - sought.length + 1, size, size + 1, -1]) {
            mix(startsAt(makeText(text), makeSought(sought), place));
            mix(foundFrom(makeText(text), makeSought(sought), place));
            mix(foundUpTo(makeText(text), makeSought(sought), place));
            mix(endsAt(makeText(text), makeSought(sought), place));
          }
        }
      }
      console.log(wideText ? "wide" : "narrow", "|", nameOfText, "|", nameOfSought, "|", digest);
    }
  }
}

const places: unknown[] = [undefined, null, 0, -0, 1, -1, 2, 3, 4, 5, NaN, 0.5, 1.5, -0.5, 2.999, Infinity, -Infinity, 2 ** 31, 2 ** 31 - 1, -(2 ** 31), 2 ** 32, 2 ** 32 + 1, -(2 ** 32) + 1, 2 ** 53, "1", "", "x", true, false, [], [2], { valueOf() { return 2; } }];
const pairs: [string, string][] = [["", ""], ["", "a"], ["a", ""], ["a", "a"], ["a", "b"], ["abc", ""], ["abc", "c"], ["abc", "bc"], ["abc", "abc"], ["abc", "abcd"], ["abcabc", "abc"], ["\u0416bc", "bc"], ["\u0416bc", "\u0416"], ["abc", "\u0416"], ["ab\u0416", "\u0416"], ["ab\u0416", ""],
  ["abc", "\u0461"], ["cba", "\u0461"], ["a\u0004c", "\u0461"], ["ca\u0004", "\u0461"], ["\u0461bc", "a"], ["bc\u0461", "a"], ["\u0461bc", "a\u0004"], ["bc\u0461", "a\u0004"], ["\u0461", "a"], ["a", "\u0461"]];
for (const [text, sought] of pairs) {
  const line: unknown[] = [];
  for (const ask of ofAnything) {
    digest = 0;
    for (const place of places) for (const [, makeText] of makers) mix(ask(makeText(text), flat(sought), place));
    line.push(digest);
  }
  console.log(JSON.stringify(text), JSON.stringify(sought), line.join(" "));
}

const others: unknown[] = [undefined, null, 0, 1, -1, NaN, true, false, [], ["a"], {}, { toString() { return "a"; } }, 1.5, 10n];
for (const ask of ofAnything) {
  const line: unknown[] = [];
  for (const other of others) for (const text of ["", "a", "undefined", "null1", "0a", "true", "[object Object]", "1.5", "10", "NaN", "a-1"]) line.push(Number(ask(flat(text), other, 0)));
  console.log(line.join(""));
}
const said = (ask: () => unknown): string => { try { return String(ask()); } catch (error) { return (error as Error).constructor.name; } };
const mine = { startsWith: () => "mine", endsWith: () => "mine", indexOf: () => "mine", lastIndexOf: () => "mine" };
for (const ask of ofAnything) {
  const line: string[] = [];
  for (const sought of [/a/, Symbol("a")]) line.push(said(() => ask(flat("/a/"), sought, 0)));
  for (const receiver of [undefined, null, ["a", "b"], mine, new String("abc"), 5]) line.push(said(() => ask(receiver, "a", 0)));
  console.log(line.join(" "));
}
