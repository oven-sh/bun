// Literals with the flags u and v whose matches begin with a character of a known set, on subjects where 0 to 69 ASCII characters stand in front of a pair, half a pair or a character of 8 or 16 bits.
const patterns: [string, RegExp][] = [
  ["invisible", /[\p{Cf}\p{Variation_Selector}]/gu],
  ["format", /\p{Cf}/gu],
  ["not ascii", /\P{ASCII}/gu],
  ["negated ascii", /[^\x00-\x7F]/gu],
  ["runs of negated ascii", /[^\x00-\x7F]+/gu],
  ["faces", /[\u{1F600}-\u{1F64F}]/gu],
  ["one face", /\u{1F600}/gu],
  ["emoji", /\p{Emoji_Presentation}/gu],
  ["tags and an optional letter", /[\u200B-\u200F\u{E0000}-\u{E0FFF}]x?/gu],
  ["lone leads", /[\uD800-\uDBFF]/gu],
  ["lone trails", /[\uDC00-\uDFFF]/gu],
  ["any surrogate", /[\uD800-\uDFFF]/gu],
  ["one lone lead", /\uDB40/gu],
  ["one lone trail", /\uDC01/gu],
  ["ascii alone", /[xyz]/gu],
  ["ascii, then a letter", /[xyz]\p{L}/gu],
  ["ascii, then anything", /[xyz]./gu],
  ["ascii, then anything, with newlines", /[xyz]./gsu],
  ["kelvin", /k/giu],
  ["long s", /[k]s/giu],
  ["upper case without regard to case", /\p{Lu}/giu],
  ["either of two", /(?:\u00E9|\u{1F600})+/gu],
  ["a space of no width or a letter", /\u200B|x/gu],
  ["a face or a letter", /\u{1F600}|x/gu],
  ["behind a lookahead", /(?=\u200B)./gu],
  ["behind a negative lookahead", /(?!x)[^\x00-\x60]/gu],
  ["behind a lookbehind", /(?<=a)[^\x00-\x7F]/gu],
  ["a captured face", /([\u{1F600}-\u{1F64F}])(.?)/gu],
  ["a letter at a word's start", /\b\p{L}/gu],
  ["not at a word's border", /\B[^\x00-\x7F]/gu],
  ["two of a class", /[\u00AD\u{E0001}]{2}/gu],
  ["a class, then the end", /[\u00AD\u{E0001}]$/gu],
  ["a class at a line's end", /[\u00AD\u{E0001}]$/gmu],
  ["a class behind a line's start", /^[\u00AD\u{E0001}]/gmu],
  ["a lazy run", /[^\x00-\x7F]+?b/gu],
  ["a reference back", /([^\x00-\x7F])\1/gu],
  ["not global", /[\p{Cf}\p{Variation_Selector}]/u],
  ["sets", /[\p{Cf}--\u00AD]/gv],
  ["emoji of several characters", /\p{RGI_Emoji}/gv],
  ["negated in sets", /[^\p{ASCII}]/gv],
  ["no flag: wide ranges", /[\u00AD\u0300-\u036F\u2000-\u2FFF]/g],
  ["no flag: negated ascii", /[^\x00-\x7F]/g],
  ["no flag: surrogates", /[\uD800-\uDFFF]/g],
  ["no flag: wide ranges, then a letter", /[\u00AD\u0300-\u036F\u2000-\uFFFF]b/g],
];
const pieces = ["", "\u00AD", "\u200B", "\u{E0001}", "\u{E0001}\u{E0001}", "\u00AD\u{E0001}", "\uD800", "\uDC00", "\uDC00\uD800", "\uDB40", "\uDB40x", "\uDB40\uDC01x", "\uDC01", "\u{1F600}", "\u{1F600}\u{1F600}", "x\u{1F600}",
  "\u{1F600}x", "\u00E9", "\u65E5\u672C", "x", "x\u00E9", "x\u{1D400}", "x\n", "K", "\u212A", "\u212As", "k\u017F", "\u{1F468}\u200D\u{1F469}", "\u00AD\n", "\n\u00AD", "\u{10FFFF}", "\uFFFF", "\u0080", "\u007F", "\u00E9\u00E9"];
function mix(hash: number, text: string): number {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return (Math.imul(hash, 31) + 7) | 0;
}
const lines: string[] = [];
for (const [name, pattern] of patterns) {
  const row: string[] = [];
  for (const piece of pieces) {
    let hash = 0;
    for (let before = 0; before < 70; before += before < 36 ? 1 : 11) {
      for (const wide of [false, true]) {
        const subject = (wide ? "\u0100" : "") + "a".repeat(before) + piece + "b".repeat(19) + piece + "c".repeat(before >> 1);
        pattern.lastIndex = 0;
        hash = mix(hash, subject.replace(pattern, "_"));
        hash = mix(hash, String(subject.search(pattern)));
        hash = mix(hash, String(subject.split(pattern).length));
        pattern.lastIndex = 0;
        for (let from = Math.max(0, before - 2); from <= before + piece.length + 2 && from <= subject.length; from++) {
          pattern.lastIndex = from;
          const found = pattern.exec(subject);
          hash = mix(hash, found ? found.index + ":" + found.join(",") + ":" + pattern.lastIndex : "none");
        }
        pattern.lastIndex = 0;
        hash = mix(hash, String(pattern.test(subject)));
        pattern.lastIndex = 0;
      }
    }
    row.push((hash >>> 0).toString(36));
  }
  lines.push(name + ": " + row.join(" "));
}
console.log(lines.join("\n"));
