// startsWith and endsWith where neither string is known to the compiler: sought texts of every length from none to longer than two machine words, at every position,
// that differ in their first, last or a middle character or not at all; characters of 8 and of 16 bits on either side; ropes on either side; positions that are no integers.

const lines: string[] = [];
const hide = <T,>(value: T): T => new CustomEvent("x", { detail: value }).detail as T;
const letters = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function starts(text: string, sought: string, at?: number): boolean { return at === undefined ? text.startsWith(sought) : text.startsWith(sought, at); }
function ends(text: string, sought: string, at?: number): boolean { return at === undefined ? text.endsWith(sought) : text.endsWith(sought, at); }

function changed(text: string, index: number): string { return text.slice(0, index) + "#" + text.slice(index + 1); }
function flat(text: string): string { return hide(JSON.parse(JSON.stringify(text)) as string); }

let yes = 0, no = 0, sum = 0;
function count(answer: boolean, weight: number) { if (answer) { yes++; sum = (sum * 31 + weight) % 1000003; } else no++; }

const subject = flat(letters);
for (let length = 0; length <= 24; length++) {
  for (let from = 0; from + length <= 40; from += 3) {
    const piece = flat(subject.slice(from, from + length));
    for (let at = 0; at <= 44; at++) {
      count(starts(subject, piece, at), at * 100 + length);
      count(ends(subject, piece, at), at * 100 + length + 50);
    }
    for (const index of [0, length >> 1, length - 1]) {
      if (index < 0 || index >= length) continue;
      const other = flat(changed(piece, index));
      count(starts(subject, other, from), 7);
      count(ends(subject, other, from + length), 9);
    }
  }
  lines.push("length " + length + ": " + yes + " " + no + " " + sum);
}

const wide = flat("αβγδεζηθικλμνξοπρστυφχψω" + letters);
const cases: [string, string][] = [
  [subject, ""], ["", ""], ["", "a"], [subject, subject], [subject, subject + "!"], [wide, "αβγ"], [wide, flat("ω" + letters.slice(0, 5))], [wide, letters.slice(0, 9)],
  [subject, "α"], [subject, flat("abc") + flat("def")], [flat("abc") + flat("defghijklmnopqrstuvwxyz"), flat("abcdefg")], [flat("abc") + flat("def"), flat("ab") + flat("cd")],
  [wide, flat("XY") + flat("Z")], [subject, "XYZ"], [subject, "xYZ"], [subject, flat("9ABCDEFGHIJKLMNOPQRSTUVWXYZ")], [subject, flat("8ABCDEFGHIJKLMNOPQRSTUVWXYZ")],
];
for (const [text, sought] of cases)
  lines.push([starts(text, sought), ends(text, sought), starts(text, sought, 24), ends(text, sought, 27), starts(text, sought, 3), ends(text, sought, 6)].join(" "));

const positions: number[] = [-1, -0, 0.9, 1.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 + 1, -(2 ** 31) - 1, 61.99, 62, 63];
for (const at of positions)
  lines.push(String(at) + ": " + [starts(subject, hide("a"), at), starts(subject, hide("b"), at), starts(subject, hide(""), at), ends(subject, hide("Z"), at), ends(subject, hide("a"), at), ends(subject, hide(""), at)].join(" "));

console.log(lines.join("\n"));
