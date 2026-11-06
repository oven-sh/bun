// Patterns whose text is made at run time, with the flags u and v: classes that are negated, that hold characters beyond the BMP, the dot, property escapes, letters without regard to case;
// on subjects of 8-bit characters, of 16-bit characters without surrogates, with pairs and with lone surrogates.
const lines: string[] = [];
const hide = <T,>(value: T): T => new CustomEvent("x", { detail: value }).detail as T;
const letters = "aAＡａ𝐀𝐚𝐴𝑎bBＢｂ𝐁𝐛cC<＜﹤〈⟨‹";
const sources: [string, string][] = [
  ["[^0-9<A-Z[a-z" + letters + "\\[\\uff3b\\ufe47]", "gu"], ["[^0-9<A-Z[a-z" + letters + "]+", "gu"], ["[" + letters + "]", "gu"], ["[^a-z]", "u"], ["[^a-z]", "giu"], [".", "gu"], [".", "gsu"], ["a.c", "u"],
  ["\\P{L}", "gu"], ["\\p{L}+", "gu"], ["[^\\p{L}\\p{N}]+", "gu"], ["\\p{Lu}", "giu"], ["[\\u{1d400}-\\u{1d7ff}]", "gu"], ["[^\\u{1d400}-\\u{1d7ff}]", "gu"], ["^[^x]*$", "u"], ["(?:[^<]|<(?!b))*", "u"],
  ["([^,]*),([^,]*)", "u"], ["[^\\s]+", "gu"], ["\\S\\s\\S", "u"], ["\\W", "gu"], ["\\W", "giu"], ["\\w+", "giu"], ["[^\\d]", "gu"], ["é|[^é]", "giu"], ["[^ÿ]ÿ", "iu"], ["[µ]", "giu"], ["[^µ]", "giu"], ["ß", "iu"], ["[^ß]+", "iu"],
  ["[^a-z]", "gv"], ["[[a-z]--[aeiou]]", "gv"], ["[^[a-z]&&[aeiou]]", "gv"], ["\\p{RGI_Emoji}", "gv"], [".", "gv"],
];
const subjects: string[] = hide([
  "", "a", "plain text, with <b>tags</b> [and] 0123 digits\n", "ÀÉÎõü ÿ µ ß ÷ ×   end", "x".repeat(70), "a\nc a c abc",
  "wide ＡＢ ａｂ 〈tag〉 日本語", "pairs 𝐀𝐚𝐴 and 😀😀 end", "lone \ud835 and \udc00 ends", "\ud835", "\udc00𝐀", "K K k ſ s S", "ǅ ǆ Ǆ İ ı i I",
]);
function show(value: unknown): string { return value === null ? "null" : JSON.stringify(value); }
for (const [source, flags] of sources) {
  const pattern = new RegExp(hide(source), hide(flags));
  const row: string[] = [];
  for (const subject of subjects) {
    pattern.lastIndex = 0;
    const first = pattern.exec(subject);
    pattern.lastIndex = 0;
    row.push(show(first && [first.index, ...first]) + " " + show(subject.replace(pattern, "_")) + " " + pattern.test(subject) + " " + subject.search(pattern) + " " + subject.split(pattern).length);
    pattern.lastIndex = 0;
  }
  lines.push("/" + source.length + "/" + flags + ": " + row.join(" | "));
}
const strip = new RegExp(hide(sources[0]![0]), "gu");
let total = 0;
const rounds = Number(process.argv[2] ?? 200);
const text = hide("Some ordinary text of a message, with <b>a tag</b>, [a bracket], 12 digits; and punctuation: all of it in 8-bit characters.\n");
for (let i = 0; i < rounds; i++) total += text.replace(strip, "").length;
lines.push("total " + total);
console.log(lines.join("\n"));
