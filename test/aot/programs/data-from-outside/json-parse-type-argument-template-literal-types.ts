// Template literal types are validated as TypeScript itself matches a string literal against them.
// For every pair of a type and a string, what JSON.parse<T>() says at run time is compared with what the type checker says of `"text" extends T`:
// the checker's answers are the literal types 1 and 0 of a tuple, read back from the `expected` of the issues that a tuple of 2s gets.
let pairs = 0, accepted = 0, disagreements = 0;
function accepts(parse: () => unknown): boolean {
  try {
    parse();
    return true;
  } catch {
    return false;
  }
}
function issuesOf(parse: () => unknown): { expected: string }[] {
  try {
    parse();
    return [];
  } catch (error) {
    return (error as Bun.Schema.Error).issues;
  }
}
function compare(name: string, texts: string[], fits: (text: string) => boolean, answers: { expected: string }[]): void {
  let line = "";
  texts.forEach((text, index) => {
    const expected = answers[index].expected === "1";
    const found = fits(text);
    pairs++;
    if (found) accepted++;
    if (found !== expected) {
      disagreements++;
      console.log("DISAGREES", name, JSON.stringify(text), "the checker says", expected, "the validator says", found);
    }
    line += found ? "1" : "0";
  });
  console.log(name, line);
}

type T0 = `rgb:${string}`;
compare("`rgb:${string}`", ["rgb:", "rgb:x", "rgb", "Rgb:x", " rgb:x", "rgb:rgb:", ""], text => accepts(() => JSON.parse<T0>(JSON.stringify(text))), issuesOf(() => JSON.parse<["rgb:" extends T0 ? 1 : 0, "rgb:x" extends T0 ? 1 : 0, "rgb" extends T0 ? 1 : 0, "Rgb:x" extends T0 ? 1 : 0, " rgb:x" extends T0 ? 1 : 0, "rgb:rgb:" extends T0 ? 1 : 0, "" extends T0 ? 1 : 0]>("[2,2,2,2,2,2,2]")));
type T1 = `${string}-${string}-${string}-${string}-${string}`;
compare("`${string}-${string}-${string}-${string}-${string}`", ["123e4567-e89b-12d3-a456-426614174000", "----", "---", "a-b-c-d", "a-b-c-d-e", "a-b-c-d-e-f", "", "-----"], text => accepts(() => JSON.parse<T1>(JSON.stringify(text))), issuesOf(() => JSON.parse<["123e4567-e89b-12d3-a456-426614174000" extends T1 ? 1 : 0, "----" extends T1 ? 1 : 0, "---" extends T1 ? 1 : 0, "a-b-c-d" extends T1 ? 1 : 0, "a-b-c-d-e" extends T1 ? 1 : 0, "a-b-c-d-e-f" extends T1 ? 1 : 0, "" extends T1 ? 1 : 0, "-----" extends T1 ? 1 : 0]>("[2,2,2,2,2,2,2,2]")));
type T2 = `/api/${string}`;
compare("`/api/${string}`", ["/api/", "/api/a/b", "/api", "/web/a", "api/"], text => accepts(() => JSON.parse<T2>(JSON.stringify(text))), issuesOf(() => JSON.parse<["/api/" extends T2 ? 1 : 0, "/api/a/b" extends T2 ? 1 : 0, "/api" extends T2 ? 1 : 0, "/web/a" extends T2 ? 1 : 0, "api/" extends T2 ? 1 : 0]>("[2,2,2,2,2]")));
type T3 = `${string}.json`;
compare("`${string}.json`", [".json", "a.json", "a.json ", "json", "a.jsonx", ".json.json"], text => accepts(() => JSON.parse<T3>(JSON.stringify(text))), issuesOf(() => JSON.parse<[".json" extends T3 ? 1 : 0, "a.json" extends T3 ? 1 : 0, "a.json " extends T3 ? 1 : 0, "json" extends T3 ? 1 : 0, "a.jsonx" extends T3 ? 1 : 0, ".json.json" extends T3 ? 1 : 0]>("[2,2,2,2,2,2]")));
type T4 = `a${string}b`;
compare("`a${string}b`", ["ab", "a", "b", "", "aab", "abb", "aXb", "ba", "aba"], text => accepts(() => JSON.parse<T4>(JSON.stringify(text))), issuesOf(() => JSON.parse<["ab" extends T4 ? 1 : 0, "a" extends T4 ? 1 : 0, "b" extends T4 ? 1 : 0, "" extends T4 ? 1 : 0, "aab" extends T4 ? 1 : 0, "abb" extends T4 ? 1 : 0, "aXb" extends T4 ? 1 : 0, "ba" extends T4 ? 1 : 0, "aba" extends T4 ? 1 : 0]>("[2,2,2,2,2,2,2,2,2]")));
type T5 = `ab${string}ba`;
compare("`ab${string}ba`", ["aba", "abba", "ab", "ba", "abXba", "ababa"], text => accepts(() => JSON.parse<T5>(JSON.stringify(text))), issuesOf(() => JSON.parse<["aba" extends T5 ? 1 : 0, "abba" extends T5 ? 1 : 0, "ab" extends T5 ? 1 : 0, "ba" extends T5 ? 1 : 0, "abXba" extends T5 ? 1 : 0, "ababa" extends T5 ? 1 : 0]>("[2,2,2,2,2,2]")));
type T6 = `${string}ab${string}ab`;
compare("`${string}ab${string}ab`", ["abab", "ab", "aab", "abXab", "XabYab", "abab ", "ababab"], text => accepts(() => JSON.parse<T6>(JSON.stringify(text))), issuesOf(() => JSON.parse<["abab" extends T6 ? 1 : 0, "ab" extends T6 ? 1 : 0, "aab" extends T6 ? 1 : 0, "abXab" extends T6 ? 1 : 0, "XabYab" extends T6 ? 1 : 0, "abab " extends T6 ? 1 : 0, "ababab" extends T6 ? 1 : 0]>("[2,2,2,2,2,2,2]")));
type T7 = `${number}`;
compare("`${number}`", ["1", "-1", "+1", "1.5", ".5", "5.", "1e3", "1e999", "-1e999", "0x10", "0X1f", "-0x10", "0b11", "0o7", "0b2", " 1", "1 ", " ", "", "\t1\n", "Infinity", "-Infinity", "NaN", "1_000", "1n", "00", "012", "1,5", "1.2.3", "e3", "."], text => accepts(() => JSON.parse<T7>(JSON.stringify(text))), issuesOf(() => JSON.parse<["1" extends T7 ? 1 : 0, "-1" extends T7 ? 1 : 0, "+1" extends T7 ? 1 : 0, "1.5" extends T7 ? 1 : 0, ".5" extends T7 ? 1 : 0, "5." extends T7 ? 1 : 0, "1e3" extends T7 ? 1 : 0, "1e999" extends T7 ? 1 : 0, "-1e999" extends T7 ? 1 : 0, "0x10" extends T7 ? 1 : 0, "0X1f" extends T7 ? 1 : 0, "-0x10" extends T7 ? 1 : 0, "0b11" extends T7 ? 1 : 0, "0o7" extends T7 ? 1 : 0, "0b2" extends T7 ? 1 : 0, " 1" extends T7 ? 1 : 0, "1 " extends T7 ? 1 : 0, " " extends T7 ? 1 : 0, "" extends T7 ? 1 : 0, "\t1\n" extends T7 ? 1 : 0, "Infinity" extends T7 ? 1 : 0, "-Infinity" extends T7 ? 1 : 0, "NaN" extends T7 ? 1 : 0, "1_000" extends T7 ? 1 : 0, "1n" extends T7 ? 1 : 0, "00" extends T7 ? 1 : 0, "012" extends T7 ? 1 : 0, "1,5" extends T7 ? 1 : 0, "1.2.3" extends T7 ? 1 : 0, "e3" extends T7 ? 1 : 0, "." extends T7 ? 1 : 0]>("[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]")));
type T8 = `${number}px`;
compare("`${number}px`", ["1px", "-1px", "+1px", "1.5px", ".5px", "5.px", "1e3px", "1e999px", "-1e999px", "0x10px", "0X1fpx", "-0x10px", "0b11px", "0o7px", "px", "1", "1 px", "1pxpx"], text => accepts(() => JSON.parse<T8>(JSON.stringify(text))), issuesOf(() => JSON.parse<["1px" extends T8 ? 1 : 0, "-1px" extends T8 ? 1 : 0, "+1px" extends T8 ? 1 : 0, "1.5px" extends T8 ? 1 : 0, ".5px" extends T8 ? 1 : 0, "5.px" extends T8 ? 1 : 0, "1e3px" extends T8 ? 1 : 0, "1e999px" extends T8 ? 1 : 0, "-1e999px" extends T8 ? 1 : 0, "0x10px" extends T8 ? 1 : 0, "0X1fpx" extends T8 ? 1 : 0, "-0x10px" extends T8 ? 1 : 0, "0b11px" extends T8 ? 1 : 0, "0o7px" extends T8 ? 1 : 0, "px" extends T8 ? 1 : 0, "1" extends T8 ? 1 : 0, "1 px" extends T8 ? 1 : 0, "1pxpx" extends T8 ? 1 : 0]>("[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]")));
type T9 = `${number}-${number}`;
compare("`${number}-${number}`", ["1-2", "-1-2", "1--2", "1-", "-2", "-", "1-2-3", "1e-2-3", "1.5-2.5"], text => accepts(() => JSON.parse<T9>(JSON.stringify(text))), issuesOf(() => JSON.parse<["1-2" extends T9 ? 1 : 0, "-1-2" extends T9 ? 1 : 0, "1--2" extends T9 ? 1 : 0, "1-" extends T9 ? 1 : 0, "-2" extends T9 ? 1 : 0, "-" extends T9 ? 1 : 0, "1-2-3" extends T9 ? 1 : 0, "1e-2-3" extends T9 ? 1 : 0, "1.5-2.5" extends T9 ? 1 : 0]>("[2,2,2,2,2,2,2,2,2]")));
type T10 = `${string}-${number}`;
compare("`${string}-${number}`", ["a-1", "-1", "1-2-3", "a-", "a-b", "--1", "a-1e3"], text => accepts(() => JSON.parse<T10>(JSON.stringify(text))), issuesOf(() => JSON.parse<["a-1" extends T10 ? 1 : 0, "-1" extends T10 ? 1 : 0, "1-2-3" extends T10 ? 1 : 0, "a-" extends T10 ? 1 : 0, "a-b" extends T10 ? 1 : 0, "--1" extends T10 ? 1 : 0, "a-1e3" extends T10 ? 1 : 0]>("[2,2,2,2,2,2,2]")));
type T11 = `${number}-${string}`;
compare("`${number}-${string}`", ["1-a", "1-", "-1-a", "a-1", "1-2-3"], text => accepts(() => JSON.parse<T11>(JSON.stringify(text))), issuesOf(() => JSON.parse<["1-a" extends T11 ? 1 : 0, "1-" extends T11 ? 1 : 0, "-1-a" extends T11 ? 1 : 0, "a-1" extends T11 ? 1 : 0, "1-2-3" extends T11 ? 1 : 0]>("[2,2,2,2,2]")));
type T12 = `${bigint}`;
compare("`${bigint}`", ["0", "-0", "00", "01", "123", "-123", "+1", "--1", "-", "0x1F", "0X1f", "-0x1", "0x", "0b101", "0b2", "0o17", "0o8", "1.0", "1e3", " 1", "1 ", "", "1n", "1_0", "12345678901234567890123"], text => accepts(() => JSON.parse<T12>(JSON.stringify(text))), issuesOf(() => JSON.parse<["0" extends T12 ? 1 : 0, "-0" extends T12 ? 1 : 0, "00" extends T12 ? 1 : 0, "01" extends T12 ? 1 : 0, "123" extends T12 ? 1 : 0, "-123" extends T12 ? 1 : 0, "+1" extends T12 ? 1 : 0, "--1" extends T12 ? 1 : 0, "-" extends T12 ? 1 : 0, "0x1F" extends T12 ? 1 : 0, "0X1f" extends T12 ? 1 : 0, "-0x1" extends T12 ? 1 : 0, "0x" extends T12 ? 1 : 0, "0b101" extends T12 ? 1 : 0, "0b2" extends T12 ? 1 : 0, "0o17" extends T12 ? 1 : 0, "0o8" extends T12 ? 1 : 0, "1.0" extends T12 ? 1 : 0, "1e3" extends T12 ? 1 : 0, " 1" extends T12 ? 1 : 0, "1 " extends T12 ? 1 : 0, "" extends T12 ? 1 : 0, "1n" extends T12 ? 1 : 0, "1_0" extends T12 ? 1 : 0, "12345678901234567890123" extends T12 ? 1 : 0]>("[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]")));
type T13 = `${bigint}n`;
compare("`${bigint}n`", ["0n", "-0n", "00n", "01n", "123n", "-123n", "+1n", "--1n", "-n", "0x1Fn", "0X1fn", "-0x1n", "n", "1"], text => accepts(() => JSON.parse<T13>(JSON.stringify(text))), issuesOf(() => JSON.parse<["0n" extends T13 ? 1 : 0, "-0n" extends T13 ? 1 : 0, "00n" extends T13 ? 1 : 0, "01n" extends T13 ? 1 : 0, "123n" extends T13 ? 1 : 0, "-123n" extends T13 ? 1 : 0, "+1n" extends T13 ? 1 : 0, "--1n" extends T13 ? 1 : 0, "-n" extends T13 ? 1 : 0, "0x1Fn" extends T13 ? 1 : 0, "0X1fn" extends T13 ? 1 : 0, "-0x1n" extends T13 ? 1 : 0, "n" extends T13 ? 1 : 0, "1" extends T13 ? 1 : 0]>("[2,2,2,2,2,2,2,2,2,2,2,2,2,2]")));
type T14 = `${string}${string}`;
compare("`${string}${string}`", ["", "a", "ab", "abc"], text => accepts(() => JSON.parse<T14>(JSON.stringify(text))), issuesOf(() => JSON.parse<["" extends T14 ? 1 : 0, "a" extends T14 ? 1 : 0, "ab" extends T14 ? 1 : 0, "abc" extends T14 ? 1 : 0]>("[2,2,2,2]")));
type T15 = `${string}${number}`;
compare("`${string}${number}`", ["", "1", "12", "a1", "a", "ab1", "a 1"], text => accepts(() => JSON.parse<T15>(JSON.stringify(text))), issuesOf(() => JSON.parse<["" extends T15 ? 1 : 0, "1" extends T15 ? 1 : 0, "12" extends T15 ? 1 : 0, "a1" extends T15 ? 1 : 0, "a" extends T15 ? 1 : 0, "ab1" extends T15 ? 1 : 0, "a 1" extends T15 ? 1 : 0]>("[2,2,2,2,2,2,2]")));
type T16 = `${number}${string}`;
compare("`${number}${string}`", ["", "1", "1a", "12a", "a1", "-1", " a"], text => accepts(() => JSON.parse<T16>(JSON.stringify(text))), issuesOf(() => JSON.parse<["" extends T16 ? 1 : 0, "1" extends T16 ? 1 : 0, "1a" extends T16 ? 1 : 0, "12a" extends T16 ? 1 : 0, "a1" extends T16 ? 1 : 0, "-1" extends T16 ? 1 : 0, " a" extends T16 ? 1 : 0]>("[2,2,2,2,2,2,2]")));
type T17 = `${string}${string}${string}x`;
compare("`${string}${string}${string}x`", ["x", "ax", "abx", "abcx", "ab"], text => accepts(() => JSON.parse<T17>(JSON.stringify(text))), issuesOf(() => JSON.parse<["x" extends T17 ? 1 : 0, "ax" extends T17 ? 1 : 0, "abx" extends T17 ? 1 : 0, "abcx" extends T17 ? 1 : 0, "ab" extends T17 ? 1 : 0]>("[2,2,2,2,2]")));
type T18 = `${boolean}!`;
compare("`${boolean}!`", ["true!", "false!", "True!", "!", "true"], text => accepts(() => JSON.parse<T18>(JSON.stringify(text))), issuesOf(() => JSON.parse<["true!" extends T18 ? 1 : 0, "false!" extends T18 ? 1 : 0, "True!" extends T18 ? 1 : 0, "!" extends T18 ? 1 : 0, "true" extends T18 ? 1 : 0]>("[2,2,2,2,2]")));
type T19 = `${"a" | "b"}-${string}`;
compare("`${\"a\" | \"b\"}-${string}`", ["a-", "b-x", "c-x", "a", "ab-x"], text => accepts(() => JSON.parse<T19>(JSON.stringify(text))), issuesOf(() => JSON.parse<["a-" extends T19 ? 1 : 0, "b-x" extends T19 ? 1 : 0, "c-x" extends T19 ? 1 : 0, "a" extends T19 ? 1 : 0, "ab-x" extends T19 ? 1 : 0]>("[2,2,2,2,2]")));
type T20 = `${"x" | "y"}${1 | 2}`;
compare("`${\"x\" | \"y\"}${1 | 2}`", ["x1", "y2", "x3", "z1", "x", "x12"], text => accepts(() => JSON.parse<T20>(JSON.stringify(text))), issuesOf(() => JSON.parse<["x1" extends T20 ? 1 : 0, "y2" extends T20 ? 1 : 0, "x3" extends T20 ? 1 : 0, "z1" extends T20 ? 1 : 0, "x" extends T20 ? 1 : 0, "x12" extends T20 ? 1 : 0]>("[2,2,2,2,2,2]")));
type T21 = `<${`a${string}`}>`;
compare("`<${`a${string}`}>`", ["<a>", "<ab>", "<b>", "<a", "a>"], text => accepts(() => JSON.parse<T21>(JSON.stringify(text))), issuesOf(() => JSON.parse<["<a>" extends T21 ? 1 : 0, "<ab>" extends T21 ? 1 : 0, "<b>" extends T21 ? 1 : 0, "<a" extends T21 ? 1 : 0, "a>" extends T21 ? 1 : 0]>("[2,2,2,2,2]")));
type T22 = `${null}-${undefined}`;
compare("`${null}-${undefined}`", ["null-undefined", "null-", "-undefined"], text => accepts(() => JSON.parse<T22>(JSON.stringify(text))), issuesOf(() => JSON.parse<["null-undefined" extends T22 ? 1 : 0, "null-" extends T22 ? 1 : 0, "-undefined" extends T22 ? 1 : 0]>("[2,2,2]")));
type T23 = `\u00e9${string}\u00fc`;
compare("`\\u00e9${string}\\u00fc`", ["\u00e9\u00fc", "\u00e9x\u00fc", "\u00e9", "e\u0301\u00fc", "\u00e9\u5c71\u00fc"], text => accepts(() => JSON.parse<T23>(JSON.stringify(text))), issuesOf(() => JSON.parse<["\u00e9\u00fc" extends T23 ? 1 : 0, "\u00e9x\u00fc" extends T23 ? 1 : 0, "\u00e9" extends T23 ? 1 : 0, "e\u0301\u00fc" extends T23 ? 1 : 0, "\u00e9\u5c71\u00fc" extends T23 ? 1 : 0]>("[2,2,2,2,2]")));
type T24 = `${string}\u2192${string}`;
compare("`${string}\\u2192${string}`", ["\u2192", "a\u2192b", "ab", "\u2190"], text => accepts(() => JSON.parse<T24>(JSON.stringify(text))), issuesOf(() => JSON.parse<["\u2192" extends T24 ? 1 : 0, "a\u2192b" extends T24 ? 1 : 0, "ab" extends T24 ? 1 : 0, "\u2190" extends T24 ? 1 : 0]>("[2,2,2,2]")));
type T25 = `\ud83c\udf89${string}`;
compare("`\\ud83c\\udf89${string}`", ["\ud83c\udf89", "\ud83c\udf89x", "\ud83c", "\udf89", "x\ud83c\udf89"], text => accepts(() => JSON.parse<T25>(JSON.stringify(text))), issuesOf(() => JSON.parse<["\ud83c\udf89" extends T25 ? 1 : 0, "\ud83c\udf89x" extends T25 ? 1 : 0, "\ud83c" extends T25 ? 1 : 0, "\udf89" extends T25 ? 1 : 0, "x\ud83c\udf89" extends T25 ? 1 : 0]>("[2,2,2,2,2]")));
type T26 = `a.b*${string}(c)`;
compare("`a.b*${string}(c)`", ["a.b*(c)", "a.b*x(c)", "aXb*(c)", "a.bbb(c)"], text => accepts(() => JSON.parse<T26>(JSON.stringify(text))), issuesOf(() => JSON.parse<["a.b*(c)" extends T26 ? 1 : 0, "a.b*x(c)" extends T26 ? 1 : 0, "aXb*(c)" extends T26 ? 1 : 0, "a.bbb(c)" extends T26 ? 1 : 0]>("[2,2,2,2]")));
type T27 = `${string}\n${string}`;
compare("`${string}\\n${string}`", ["\n", "a\nb", "ab", "a\r\nb", "\n\n"], text => accepts(() => JSON.parse<T27>(JSON.stringify(text))), issuesOf(() => JSON.parse<["\n" extends T27 ? 1 : 0, "a\nb" extends T27 ? 1 : 0, "ab" extends T27 ? 1 : 0, "a\r\nb" extends T27 ? 1 : 0, "\n\n" extends T27 ? 1 : 0]>("[2,2,2,2,2]")));
type T28 = `${any}x`;
compare("`${any}x`", ["x", "ax", "a"], text => accepts(() => JSON.parse<T28>(JSON.stringify(text))), issuesOf(() => JSON.parse<["x" extends T28 ? 1 : 0, "ax" extends T28 ? 1 : 0, "a" extends T28 ? 1 : 0]>("[2,2,2]")));
type T29 = `id:${number}` | `name:${string}` | "none";
compare("`id:${number}` | `name:${string}` | \"none\"", ["id:1", "id:x", "name:", "name:x", "none", "None", "id:"], text => accepts(() => JSON.parse<T29>(JSON.stringify(text))), issuesOf(() => JSON.parse<["id:1" extends T29 ? 1 : 0, "id:x" extends T29 ? 1 : 0, "name:" extends T29 ? 1 : 0, "name:x" extends T29 ? 1 : 0, "none" extends T29 ? 1 : 0, "None" extends T29 ? 1 : 0, "id:" extends T29 ? 1 : 0]>("[2,2,2,2,2,2,2]")));
console.log("pairs", pairs, "accepted", accepted, "disagreements", disagreements);

type Id = `${string}-${string}-${string}-${string}-${string}`;
interface Row {
  id: Id;
  parent: Id | null;
  color: "red" | "green" | `rgb:${string}`;
  path?: `/api/${string}`;
  sizes: `${number}px`[];
}
function describe(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error) {
    const issues = (error as { issues?: { path: (string | number)[]; code: string; expected: string; received: string }[] }).issues;
    return (error as Error).constructor.name + ": " + (issues ? issues.map(issue => issue.path.join(".") + " " + issue.code + " " + issue.expected + " " + issue.received).join("; ") : (error as Error).message);
  }
}
for (const text of [
  '{"id":"1-2-3-4-5","parent":null,"color":"rgb:102030","path":"/api/x","sizes":["1px","2.5px"]}',
  '{"id":"1-2-3-4-5","parent":"a-b-c-d-e","color":"red","sizes":[]}',
  '{"sizes":["1px"],"color":"green","parent":null,"id":"\\u0031-2-3-4-5"}',
  '{"id":"1-2-3-4","parent":"x","color":"rgb","path":"/web/x","sizes":["px",1]}',
  '{"id":5,"parent":null,"color":"red","sizes":["1px"]}',
]) {
  console.log(describe(() => JSON.parse<Row>(text)));
}
const summaryOf = (row: Row): string => row.id.toUpperCase() + row.color.length;
console.log(summaryOf(JSON.parse<Row>('{"id":"a-b-c-d-e","parent":null,"color":"rgb:x","sizes":[]}')));
