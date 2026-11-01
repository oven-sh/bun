// Where the build knows the text and the flags of a pattern, the pattern is compiled into the image like a literal's: constants of this and of another module, templates over them, functions of the
// engine that depend on their operands alone (replace with a literal, repeat, toLowerCase), functions of the program that return such an expression, several callers, both arms of a condition,
// the rows of a table of objects (each row's text with its own flags), in a loop or in a callback, `join` over a list and over what `map` makes of a list, a long template,
// String.raw over substitutions whose types say nothing, a number of another module in a template.
// The last group is texts that only the run knows: they are made as in plain Bun, and each of them is counted.
// COUNTER: RegExpsCreatedWithoutRecord = 3
// COUNTER: RegExpsCompiledToBytecode = 2
import { INVISIBLE_CLASS, INVISIBLE_CHARACTER, INVISIBLE_RUN, MOST, escapeText, spread } from "./classes";

const KEY_TEST = new RegExp(spread(String.raw`api[_-]?key|secret|token|pass(?:word|wd)`), "i");
const GAP = `[\\s\\u0085${INVISIBLE_CLASS}]`;
const SCHEME = `(?:${spread("Bearer|Basic")})[${INVISIBLE_CLASS}]*[\\s\\u0085]+`;
const KEY = `(?:${spread(String.raw`api[_-]?key|secret|token|pass(?:word|wd)`)})`;
const VALUE = `"[^"]*"|'[^']*'|[^\\s,;&]+`;
const ASSIGN = `${KEY}(?:${INVISIBLE_RUN}["'])?${GAP}*[=:]${GAP}*(${VALUE})`;
const CLOUD = `(?:AWS|GCP)_[A-Z_]+${GAP}*[=:]${GAP}*(${VALUE})`;
const NEXT_NAME = `[^\\s,;&]{0,64}?(?:${KEY})`;
const NEXT = `(?:${SCHEME})?(?:"${NEXT_NAME}"|'${NEXT_NAME}'|${NEXT_NAME})${GAP}*[=:]`;

type Scan = { assign: RegExp; next: RegExp; quoted: RegExp };
let scans: { plain: Scan; escaped: Scan } | undefined;
function ranges(content: string): number[] {
  scans ??= {
    plain: { assign: new RegExp(`${ASSIGN}|${CLOUD}`, "gi"), next: new RegExp(NEXT, "iy"), quoted: new RegExp(`["']|${SCHEME}`, "iy") },
    escaped: { assign: new RegExp(`${ASSIGN}|${CLOUD}|\\\\+["']${ASSIGN}`, "gi"), next: new RegExp(NEXT, "iy"), quoted: new RegExp(`\\\\*["']|${SCHEME}`, "iy") },
  };
  const found: number[] = [];
  for (const scan of [scans.plain, scans.escaped]) {
    scan.assign.lastIndex = 0;
    for (let match = scan.assign.exec(content); match; match = scan.assign.exec(content)) found.push(match.index, match[0].length);
    scan.next.lastIndex = 0;
    scan.quoted.lastIndex = 0;
    found.push(scan.next.test(content) ? 1 : 0, scan.quoted.test(content) ? 1 : 0);
  }
  return found;
}

function whole(source: string, insensitive: boolean): RegExp {
  return new RegExp("^(?:" + source + ")$", insensitive ? "i" : "");
}
const wholeWord = whole("[a-z]+", true);
const wholeNumber = whole("[0-9]+(?:\\.[0-9]+)?", false);

function tagged(name: string): string {
  if (name.length > 3) return `<${name}(\\s[^>]*)?>`;
  return `<${name}>`;
}
const DIV = new RegExp(tagged("section"));
const BOLD = new RegExp(tagged("b"));

const FROM_SOURCES = new RegExp(/[a-f]+/.source + "|" + /\d{2,}/.source);
const HEX = /0x[0-9a-f]+/;
const HEX_EACH = new RegExp(HEX, "gi");
const HEX_PAIR = new RegExp(`${HEX.source},${HEX.source}`);
const REPEATED = new RegExp(`${"[A-Z0-9]+/".repeat(2)}[a-z]+`);
const LOWER = new RegExp(`${KEY.length > 9 ? "[A-F]+".toLowerCase() : "z"}x?`);
const ESCAPED = new RegExp(escapeText("a.b(c)") + "+");

const text = `api_key = "abc" token: def AWS_SECRET=ghi Bearer xyz feed 2026 <section id=x> <b> 0xAB,0xcd AB/C9/xy a.b(c)))`;
console.log(KEY_TEST.test(text), INVISIBLE_CHARACTER.test(text), ranges(text).join());
console.log(wholeWord.test("Word"), wholeWord.test("two words"), wholeNumber.test("12.5"), wholeNumber.test("12."));
console.log(DIV.exec(text)?.[1], BOLD.test(text), FROM_SOURCES.exec(text)?.[0], (text.match(HEX_EACH) ?? []).join(), HEX_PAIR.test(text.toLowerCase()));
console.log(REPEATED.exec(text)?.[0], LOWER.exec("xx abcdef")?.[0], ESCAPED.exec(text)?.[0]);

type Rule = { id: string; source: string; flags?: string; run?: string };
const RULES: Rule[] = [
  { id: "key", source: `sk-[A-Za-z0-9]{8,}` },
  { id: "hook", source: `https://hooks\\.example\\.com/${"[A-Z0-9]+/".repeat(2)}[a-z]+`, flags: "i" },
  { id: "jwt", source: `ey[A-Za-z0-9_-]{4,}\\.[A-Za-z0-9_-]{4,}`, run: "[A-Za-z0-9_-]" },
  { id: "assign", source: ASSIGN, flags: "i" },
];
function compile(global: boolean) {
  return RULES.map(rule => {
    const flags = (rule.flags ?? "").replace("g", "");
    if (rule.run === undefined) return { id: rule.id, expression: new RegExp(rule.source, global ? flags + "g" : flags) };
    return { id: rule.id, expression: new RegExp(`(?<!${rule.run})${rule.source}`, global ? flags + "g" : flags) };
  });
}
const subject = text + " sk-ABCDEFGH12 eyABCD.EFGH HTTPS://HOOKS.EXAMPLE.COM/A/B/c";
console.log([...compile(true), ...compile(false)].map(rule => rule.id + ":" + (subject.match(rule.expression) ?? []).length).join(" "));
const inALoop: string[] = [];
for (const rule of RULES) inALoop.push(String(new RegExp("^" + rule.source).test(subject)));
console.log(inALoop.join());

const WORDS = ["alpha.beta", "gamma+delta", "(epsilon)"];
const PREFIXES = ["AKIA", "ASIA", "AROA"];
const ANY_WORD = new RegExp(`\\b(?:${WORDS.map(escapeText).join("|")})`, "g");
const ANY_PREFIX = new RegExp(`(?:${PREFIXES.join("|")})[A-Z0-9]{4}`);
console.log(("alpha.beta alphaxbeta (epsilon)".match(ANY_WORD) ?? []).join(), ANY_PREFIX.test("x ASIA12AB"), ANY_PREFIX.test("x ASIB12AB"));

const SEGMENT = "(?:[0-9a-f]{1,4})";
const LONG = new RegExp(`^(?:(?:${SEGMENT}:){7}(?:${SEGMENT}|:)|(?:${SEGMENT}:){6}(?::${SEGMENT}|:)|(?:${SEGMENT}:){5}(?:(?::${SEGMENT}){1,2}|:)|(?:${SEGMENT}:){4}(?:(?::${SEGMENT}){1,3}|:)|(?:${SEGMENT}:){3}(?:(?::${SEGMENT}){1,4}|:)|(?::(?:(?::${SEGMENT}){1,7}|:)))$`);
console.log(LONG.test("::1"), LONG.test("1:2:3:4:5:6:7:8"), LONG.test("1:2"));

const PIECES: { digits: unknown; dot: unknown } = { digits: "[0-9]+", dot: String.raw`\.` };
const RAW = new RegExp(String.raw`^${PIECES.digits}${PIECES.dot}${PIECES.digits}\b`);
console.log(RAW.source, RAW.test("12.5 x"), RAW.test("12,5"));
const BOUNDED = new RegExp(String.raw`^\w{1,${MOST}}$`);
const BOUNDED_TOO = new RegExp(`^[a-z]{2,${MOST}}$`);
console.log(BOUNDED.source, BOUNDED.test("word"), BOUNDED.test("nine characters".replace(" ", "_")), BOUNDED_TOO.test("a"), BOUNDED_TOO.test("ab"));

const given = [..."y+x"].reverse().join("");
const fromTheRun = [new RegExp(given), new RegExp(`^${given}$`, "i"), new RegExp(escapeText(given))];
console.log(fromTheRun.map(expression => expression.source + " " + expression.test("xxy") + " " + expression.test("x+y")).join(" | "));
