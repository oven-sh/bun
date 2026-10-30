// A pattern made at run time that is one set, or a run of one set, finds all its matches in one pass. "|(?!)" sends the same pattern through the search that goes match by match.
const nothing: string = String(Date.now()).slice(99);
const sources = ["\\d+", "\\d", "[aeiou]", "[aeiou]+", "\\s+", "\\w+", "\\W", "[^a]", "[^a]+", ".", ".+", "[\\u0100-\\u0200]+", "\\S+", "x+", "[x]", "[xX]", "[Aa]+", "(?:){3}x", "(?:){3}[xX]", "(?:){2}x+"];
const texts = ["", "a", "1", "ab12 cd", "   ", "\n\n", "aeiou", "xxXX", "ĀāaȀ", "é", "abc😀def", "12345678901234567890123456789012345678", "a".repeat(40) + "1", " ".repeat(33) + "x"];
const replacements = ["", "#", "<>", "$&", "$`"];
function statics(): string {
  return [RegExp.lastMatch, RegExp.leftContext, RegExp.rightContext].join("|");
}
let checked = 0;
function same(actual: unknown, expected: unknown, what: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`);
  ++checked;
}
for (const source of sources) {
  for (const flags of ["g", "gi", "gm", "gs"]) {
    for (const text of texts) {
      const made = (): RegExp => new RegExp(source + nothing, flags);
      const walked = (): RegExp => new RegExp(source + "|(?!)" + nothing, flags);
      for (const replacement of replacements) {
        "untouched".match(/untouched/);
        const first = made();
        const actual = text.replace(first, replacement);
        const afterActual = statics();
        "untouched".match(/untouched/);
        same(actual, text.replace(walked(), replacement), `replace ${source} ${flags}`);
        same(afterActual, statics(), `statics behind replace ${source} ${flags}`);
        same(first.lastIndex, 0, "lastIndex");
        same(text.replaceAll(made(), replacement), text.replaceAll(walked(), replacement), `replaceAll ${source} ${flags}`);
      }
      "untouched".match(/untouched/);
      const matches = text.match(made());
      const afterMatch = statics();
      "untouched".match(/untouched/);
      same(matches, text.match(walked()), `match ${source} ${flags}`);
      same(afterMatch, statics(), `statics behind match ${source} ${flags}`);
      const [firstMatch, secondMatch] = text.match(made()) ?? [];
      const [firstWalked, secondWalked] = text.match(walked()) ?? [];
      same([firstMatch, secondMatch], [firstWalked, secondWalked], `the first of match ${source} ${flags}`);
      same(Array.from(text.matchAll(made()), m => [m.index, m[0]]), Array.from(text.matchAll(walked()), m => [m.index, m[0]]), `matchAll ${source} ${flags}`);
    }
  }
}
console.log(checked > 10000);
