// The string methods that take positions, with positions declared optional: given, left out, passed as undefined, as NaN, as fractions, negative, past the end, infinite. Each method through a function of its own, in a loop.
const text: string = JSON.parse('"abcdefghij"');
const wide: string = JSON.parse('"ab\\u00e9\\u4e2d\\ud83d\\ude00fg"');
function slice(s: string, a?: number, b?: number) { return s.slice(a, b); }
function substring(s: string, a?: number, b?: number) { return s.substring(a as number, b); }
function substr(s: string, a?: number, b?: number) { return s.substr(a as number, b); }
function indexOf(s: string, x: string, p?: number) { return s.indexOf(x, p); }
function lastIndexOf(s: string, x: string, p?: number) { return s.lastIndexOf(x, p); }
function includes(s: string, x: string, p?: number) { return s.includes(x, p); }
function startsWith(s: string, x: string, p?: number) { return s.startsWith(x, p); }
function endsWith(s: string, x: string, p?: number) { return s.endsWith(x, p); }
function at(s: string, p?: number) { return s.at(p as number); }
function charAt(s: string, p?: number) { return s.charAt(p as number); }
function charCodeAt(s: string, p?: number) { return s.charCodeAt(p as number); }
function codePointAt(s: string, p?: number) { return s.codePointAt(p as number); }
const positions: (number | undefined)[] = [undefined, 0, 1, 3, 9, 10, 11, -1, -3, -10, -11, 1.9, -1.9, NaN, Infinity, -Infinity, -0, 2 ** 31, -(2 ** 31), 2 ** 53, 1e300];
const lines: string[] = [];
for (let round = 0; round < 40; round++) {
  lines.length = 0;
  for (const s of [text, wide, ""]) {
    for (const a of positions) {
      lines.push([at(s, a), charAt(s, a), charCodeAt(s, a), codePointAt(s, a), indexOf(s, "c", a), indexOf(s, "", a), lastIndexOf(s, "c", a), lastIndexOf(s, "", a), includes(s, "f", a), startsWith(s, "b", a), startsWith(s, "", a), endsWith(s, "c", a), endsWith(s, "", a)].join("|"));
      for (const b of positions) lines.push(JSON.stringify([slice(s, a, b), substring(s, a, b), substr(s, a, b)]));
    }
    lines.push([slice(s), slice(s, 2), substring(s), substring(s, 2), substr(s), substr(s, 2), indexOf(s, "c"), lastIndexOf(s, "c"), includes(s, "c"), startsWith(s, "a"), endsWith(s, "j"), at(s), charAt(s), charCodeAt(s), codePointAt(s)].join("|"));
  }
}
let hash = 0; for (const line of lines) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(lines.length, hash);
console.log(lines.slice(0, 30).join("\n"));
console.log(lines.filter((_, i) => i % 97 === 0).join("\n"));
