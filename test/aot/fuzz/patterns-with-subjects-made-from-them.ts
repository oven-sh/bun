// Regular expressions, most of them out of text that arrives at run time, each with subjects that are made FROM it, so that most of them fit or fail by one unit. A subject drawn without looking at the pattern almost never
// brings a pair of surrogates to the one place of a pattern that can take it; here every place that takes any character gets one of 16 bits, a pair, or half a pair, with literals on both sides.
//
//   patterns  literals of 7, 8 and 16 bits and beyond, written as they are and by every escape; places for any character: the dot, negated classes, \S \W \D, properties of both signs, ranges beyond 16 bits, ranges
//             of halves, sets of the flag v; groups, named groups, alternatives; quantifiers greedy and lazy; references backward by number and name; lookahead in front of what it names, lookbehind behind it,
//             both signs, also at the start of the subject; anchors and word borders
//   made      out of text that arrives at run time; one in four stands in the program as a literal
//   flags     u or v in seven of eight, with i, s, m, g, y, d beside them; the rest without, where a pair is two characters
//   subjects  what fits; the same between other characters; behind beginnings that come to nothing; behind 0 to 70 and around 256, 1,024 and 4,096 units of 8 or 16 bits, so that a pair lies across every border
//             of a block; with one unit taken out, doubled, or put in the other case; with a pair cut in half or its halves exchanged; two that fit side by side
//   used by   everything that patterns-made-at-run-time.ts uses, and exec from every lastIndex of the first units and, sticky, of the last ones, from inside a pair, on a subject kept in 16 bits whatever it holds
//
// Each use prints its answer, or the name of its error, and lastIndex behind it.
import { prelude, uses as usesOfAnyPattern } from "./patterns-made-at-run-time";
import type { Random } from "./random";

const seven = ["a", "b", "c", "x", "l", "e", "f", "A", "B", "0", "1", " ", "_", "-"];
const eight = ["é", "É", "ß", "ÿ", "µ"];
// Letters with and without another case, what folds to 7 or 8 bits, and the last and first characters on both sides of the halves.
const sixteen = ["α", "β", "Α", "σ", "ς", "Σ", "中", "☃", "İ", "ſ", "K", "ẞ", "ﬀ", "퟿", "", "￿", "٣"];
const pairs = ["\u{1f600}", "\u{1f60d}", "\u{1f64f}", "\u{10000}", "\u{10ffff}", "\u{1c345}", "\u{10400}", "\u{10428}", "\u{1d7d8}", "\u{20000}", "\u{1f1fa}"];
const halves = ["\ud83d", "\ude00", "\ud800", "\udbff", "\udc00", "\udfff"];

type Piece = { text: string; sample: () => string };

class Fitting {
  groups: string[] = [];
  names: [string, number][] = [];
  constructor(
    readonly random: Random,
    readonly unicode: boolean,
    readonly sets: boolean,
  ) {}
  get isByCharacter(): boolean {
    return this.unicode || this.sets;
  }
  anything(): string {
    const r = this.random;
    return r.pick(r.weighted([[5, pairs], [3, sixteen], [1, halves], [1, eight], [2, seven]] as const));
  }
  written(character: string): string {
    const r = this.random;
    const hex = (unit: number, width: number) => unit.toString(16).padStart(width, "0");
    const units = () => Array.from({ length: character.length }, (_, at) => "\\u" + hex(character.charCodeAt(at), 4)).join("");
    const point = character.codePointAt(0)!;
    return r.weighted([
      [6, () => character],
      [2, units],
      [this.isByCharacter ? 2 : 0, () => `\\u{${point.toString(16)}}`],
      [point < 256 ? 1 : 0, () => "\\x" + hex(point, 2)],
      [1, () => `[${character === "-" ? "\\-" : character}]`],
    ] as const)();
  }
  literal(): Piece {
    const r = this.random;
    const character = r.pick(r.weighted([[8, seven], [1, eight], [3, sixteen], [2, pairs], [1, halves]] as const));
    return { text: this.written(character), sample: () => character };
  }
  place(): Piece {
    const r = this.random;
    const any = () => this.anything();
    const from = (list: string[]) => () => (r.chance(0.9) ? r.pick(list) : this.anything());
    const letters = ["a", "α", "中", "\u{10400}", "\u{10428}", "\u{20000}", "é"];
    const others = ["\u{1f600}", "\u{1f60d}", "1", " ", "☃", "\u{1d7d8}", "\ud83d", "\ude00"];
    const choices: [number, [string, () => string]][] = [
      [8, [".", any]],
      [2, ["[^a]", any]],
      [2, ["[^x]", any]],
      [1, ["[^a-c]", any]],
      [1, ["[^\\n]", any]],
      [1, ["[^\\s]", any]],
      [1, ["[^\\ud83d]", any]],
      [1, ["[^α]", any]],
      [2, ["\\S", any]],
      [2, ["\\W", from(others)]],
      [1, ["\\D", any]],
      [2, ["[\\s\\S]", any]],
      [1, ["[^]", any]],
      [1, ["[\\ud800-\\udbff]", from(["\ud83d", "\ud800", "\udbff", "\u{1f600}"])]],
      [1, ["[\\udc00-\\udfff]", from(["\ude00", "\udc00", "\udfff", "\u{1f600}"])]],
      [1, ["[α-ω]", from(["α", "σ", "ς", "Α"])]],
      [1, ["[\\u0100-\\uffff]", from([...sixteen, ...pairs])]],
    ];
    if (this.isByCharacter)
      choices.push(
        [2, ["\\p{L}", from(letters)]],
        [2, ["\\P{L}", from(others)]],
        [1, ["\\p{Lu}", from(["A", "Α", "\u{10400}", "É"])]],
        [1, ["\\p{Ll}", from(["a", "α", "\u{10428}", "é", "ß"])]],
        [1, ["\\p{N}", from(["1", "\u{1d7d8}", "٣"])]],
        [1, ["\\p{Any}", any]],
        [1, ["\\P{ASCII}", any]],
        [1, ["\\p{Emoji_Presentation}", from(["\u{1f600}", "\u{1f60d}", "\u{1f64f}"])]],
        [1, ["\\p{Script=Greek}", from(["α", "σ", "Α"])]],
        [1, ["\\p{sc=Han}", from(["中", "\u{20000}"])]],
        [2, ["[\\u{1f600}-\\u{1f64f}]", from(["\u{1f600}", "\u{1f60d}", "\u{1f64f}"])]],
        [2, ["[\\u{10000}-\\u{10ffff}]", from(pairs)]],
        [1, ["[\\u0000-\\u{10ffff}]", any]],
        [1, ["[^\\u{1f600}]", any]],
        [1, ["[^\\p{L}]", from(others)]],
        [1, ["[\\p{L}\\p{N}_\\-]", from([...letters, "1", "_", "-"])]],
        [1, ["[a\u{1f600}α]", from(["a", "\u{1f600}", "α"])]],
      );
    if (this.sets)
      choices.push(
        [2, ["[\\p{L}--[a-z]]", from(letters)]],
        [2, ["[\\p{Any}--\\p{ASCII}]", any]],
        [1, ["[\\p{L}&&\\p{Script=Greek}]", from(["α", "σ", "Α"])]],
        [2, ["[\\q{\u{1f600}|ab|α\u{1f60d}}x]", from(["\u{1f600}", "ab", "α\u{1f60d}", "x"])]],
        [1, ["\\p{RGI_Emoji}", from(["\u{1f600}", "\u{1f1fa}\u{1f1f8}", "\u{1f60d}"])]],
        [1, ["[[\\u{10000}-\\u{10ffff}]--[\\u{1f600}]]", from(pairs)]],
      );
    const [text, sample] = r.weighted(choices);
    return { text, sample };
  }
  repeated(one: Piece): Piece {
    const r = this.random;
    // A repetition without an end around another one walks every way to cut the subject, so the outer one has a small end.
    const open = /[*+]|\{\d+,\}/.test(one.text) ? 0 : 1;
    const [mark, low, high] = r.weighted([
      [3 * open, ["*", 0, 3]],
      [3 * open, ["+", 1, 3]],
      [3, ["?", 0, 1]],
      [1, ["{2}", 2, 2]],
      [1, ["{1,3}", 1, 3]],
      [1, ["{0,2}", 0, 2]],
      [open, ["{2,}", 2, 4]],
    ] as const);
    return { text: one.text + mark + (r.chance(0.3) ? "?" : ""), sample: () => Array.from({ length: r.between(low, high) }, one.sample).join("") };
  }
  grouped(depth: number): Piece {
    const r = this.random;
    const arms = Array.from({ length: r.weighted([[5, 1], [3, 2], [1, 3]] as const) }, () => this.sequence(depth - 1, r.between(1, 3)));
    const text = arms.map(each => each.text).join("|");
    const kind = r.weighted([[4, "kept"], [3, "not-kept"], [2, "named"]] as const);
    if (kind === "not-kept") return { text: `(?:${text})`, sample: () => r.pick(arms).sample() };
    // The number of a group is the place of its opening bracket, and the groups inside have taken theirs already, so a group that holds groups is not kept.
    if (/\((?!\?[:=!]|\?<[=!])/.test(text)) return { text: `(?:${text})`, sample: () => r.pick(arms).sample() };
    const at = this.groups.push("");
    const keep = () => (this.groups[at - 1] = r.pick(arms).sample());
    if (kind === "kept") return { text: `(${text})`, sample: keep };
    const name = "n" + at;
    this.names.push([name, at]);
    return { text: `(?<${name}>${text})`, sample: keep };
  }
  looking(depth: number): Piece {
    const r = this.random;
    const one = r.chance(0.6) ? this.place() : this.sequence(depth - 1, r.between(1, 2));
    const seen = one.text;
    return r.weighted([
      [3, () => ({ text: `(?=${seen})${seen}`, sample: one.sample })],
      [3, () => ({ text: `${seen}(?<=${seen})`, sample: one.sample })],
      [1, () => ({ text: `(?!${this.literal().text})${seen}`, sample: one.sample })],
      [1, () => ({ text: `${seen}(?<!${this.literal().text})`, sample: one.sample })],
      [1, () => ({ text: `${seen}(?<=^${seen})`, sample: one.sample })],
      [1, () => ({ text: `${seen}(?<!^${seen})`, sample: one.sample })],
      [1, () => ({ text: `${seen}(?<=${this.place().text})`, sample: one.sample })],
      [1, () => ({ text: `(?=${this.place().text})${seen}`, sample: one.sample })],
    ] as const)();
  }
  atom(depth: number): Piece {
    const r = this.random;
    const choices: [number, () => Piece][] = [
      [8, () => this.literal()],
      [7, () => this.place()],
      [3, () => this.repeated(this.place())],
      [1, () => this.repeated(this.literal())],
      [1, () => ({ text: r.pick(["\\b", "\\B"]), sample: () => "" })],
    ];
    if (this.groups.length) choices.push([2, () => ((at: number) => ({ text: "\\" + at, sample: () => this.groups[at - 1] }))(r.between(1, this.groups.length))]);
    if (this.names.length) choices.push([1, () => (([name, at]: [string, number]) => ({ text: `\\k<${name}>`, sample: () => this.groups[at - 1] }))(r.pick(this.names))]);
    if (depth > 0)
      choices.push(
        [3, () => this.grouped(depth)],
        [1, () => this.repeated(this.grouped(depth))],
      );
    return r.weighted(choices)();
  }
  sequence(depth: number, length: number): Piece {
    const r = this.random;
    // A look repeats the text of what it names, so nothing inside it opens a group.
    const parts = Array.from({ length }, () => (depth >= 0 && r.chance(0.12) ? this.looking(0) : this.atom(depth)));
    return { text: parts.map(each => each.text).join(""), sample: () => parts.map(each => each.sample()).join("") };
  }
  // The shape that a search for a start looks at: known characters with one place for any character among them.
  aPlaceAmongLiterals(): Piece {
    const r = this.random;
    const parts = Array.from({ length: r.between(2, 6) }, () => this.literal());
    for (let places = r.between(1, 2); places > 0; places--) parts.splice(r.between(0, parts.length), 0, r.chance(0.8) ? this.place() : this.repeated(this.place()));
    return { text: parts.map(each => each.text).join(""), sample: () => parts.map(each => each.sample()).join("") };
  }
  whole(): Piece {
    const r = this.random;
    const body = r.chance(0.35) ? this.aPlaceAmongLiterals() : this.sequence(r.between(0, 2), r.between(1, 5));
    return { text: (r.chance(0.2) ? "^" : "") + body.text + (r.chance(0.25) ? "$" : ""), sample: body.sample };
  }
}

const uses: Record<string, string> = {
  ...usesOfAnyPattern,
  "from-every-last-index": 'attempt(() => {\n      let all = "";\n      for (let from = 0; from <= Math.min(s.length, 9); from++) {\n        re.lastIndex = from;\n        all += show(re.exec(s)) + re.lastIndex + " ";\n      }\n      return all;\n    })',
  "sticky-from-every-last-index": 'attempt(() => {\n      const own = new RegExp(re.source, re.flags.includes("y") ? re.flags : re.flags + "y");\n      let all = "";\n      for (let from = Math.max(0, s.length - 9); from <= s.length; from++) {\n        own.lastIndex = from;\n        all += show(own.exec(s)) + own.lastIndex + " ";\n      }\n      return all;\n    })',
  "last-index-inside-the-first-pair": "attempt(() => {\n      re.lastIndex = s.search(/[\\ud800-\\udbff][\\udc00-\\udfff]/) + 1;\n      return show(re.exec(s)) + re.lastIndex;\n    })",
  "in-16-bits-whatever-it-holds": 'attempt(() => re.exec(("\\u4e2d" + s).slice(1)))',
  "the-other-mode": 'attempt(() => new RegExp(re.source, re.flags.replace(/[uv]/, "")).exec(s))',
};

const flagSets = ["u", "u", "u", "v", "v", "iu", "iv", "su", "sv", "mu", "gu", "gu", "gv", "yu", "yv", "du", "giu", "gsu", "imsu", "dgimsuy", "dgimsvy", "", "i", "g", "s"];

export function generate(random: Random): string {
  const cases: unknown[] = [];
  const kinds: string[] = [];
  const literals: string[] = [];
  const cut = (text: string) => {
    if (text.length < 2 || random.chance(0.4)) return [text];
    const at = random.between(1, text.length - 1);
    return [text.slice(0, at), text.slice(at)];
  };
  const otherCase = (text: string) => (text.toUpperCase() !== text ? text.toUpperCase() : text.toLowerCase());
  for (let count = random.between(12, 24); count > 0; count--) {
    const flags = random.pick(flagSets);
    const fitting = new Fitting(random, flags.includes("u"), flags.includes("v"));
    const pattern = fitting.whole();
    const some = (most: number) => Array.from({ length: random.between(0, most) }, () => fitting.anything()).join("");
    const fit = pattern.sample();
    const kind = random.weighted([[4, "fits"], [4, "between"], [3, "false-starts"], [4, "behind-many"], [4, "damaged"], [2, "two"]] as const);
    kinds.push(kind);
    let unit = "";
    let many = 0;
    let tail = fit;
    if (kind === "between") tail = some(3) + fit + some(3);
    else if (kind === "false-starts") tail = Array.from({ length: random.between(1, 4) }, () => fit.slice(0, random.between(1, Math.max(1, fit.length - 1)))).join(random.pick(["", "", " ", "\u{1f600}"])) + fit + some(1);
    else if (kind === "two") tail = fit + random.pick(["", " ", "\u{1f600}", "α", "\ud83d"]) + pattern.sample();
    else if (kind === "behind-many") {
      unit = random.pick(["z", "z", "ü", "ω", "ω", "一", "\u{1f4a9}", "zω", fit.slice(0, 1)]);
      // Each repetition without an end multiplies the time of a search that fails by the length.
      const loops = (pattern.text.match(/[*+]|\{\d+,\}/g) ?? []).length;
      many = loops >= 2 ? random.between(0, loops >= 4 ? 20 : 70) : random.weighted([[6, () => random.between(0, 70)], [1, () => random.between(250, 262)], [1, () => random.between(1018, 1030)], [1, () => random.between(4090, 4102)]] as const)();
      tail = fit + some(2);
    } else if (kind === "damaged" && fit.length) {
      const at = random.below(fit.length);
      tail = random.weighted([
        [3, () => fit.slice(0, at) + fit.slice(at + 1)],
        [1, () => fit.slice(0, at + 1) + fit.slice(at)],
        [2, () => fit.slice(0, at) + otherCase(fit.slice(at, at + 2)) + fit.slice(at + 2)],
        [2, () => otherCase(fit)],
        [2, () => fit.replace(/([\ud800-\udbff])([\udc00-\udfff])/, "$2$1")],
        [2, () => fit.replace(/([\ud800-\udbff])([\udc00-\udfff])/, random.pick(["$1", "$2", "$1a$2", "$1$1$2", "$1$2$2"]))],
        [1, () => fit.slice(0, at) + fitting.anything() + fit.slice(at + 1)],
      ] as const)();
      if (random.chance(0.4)) tail = some(2) + tail + some(2);
    }
    cases.push({ pieces: cut(pattern.text), flags, head: random.chance(0.15) ? some(2) : "", unit, count: many, tail });
    // One in four is also written into the program, where the compiler sees it. Nothing prints the source of such a one: plain Bun writes the characters beyond ASCII of a literal as escapes before it runs the program.
    let written = "undefined";
    if (random.chance(0.25))
      try {
        written = `() => /${new RegExp(pattern.text, flags).source}/${flags}`;
      } catch {}
    literals.push(written);
  }
  const chosen = random.sample(Object.keys(uses), random.between(4, 8));
  return `// ${chosen.join(" ")} | ${kinds.join(" ")}
${prelude}
const cases: Case[] = JSON.parse(${JSON.stringify(JSON.stringify(cases))});
const written: ((() => RegExp) | undefined)[] = [
${literals.map(each => "  " + each + ",").join("\n")}
];
function made(one: Case): RegExp | string {
  try {
    const literal = written[cases.indexOf(one)];
    if (literal) return literal();
    return new RegExp(textOf(one), one.flags);
  } catch (error) {
    return (error as Error).name;
  }
}
function run(one: Case, at: number): void {
  const s = subjectOf(one);
  let line = at + ":";
${chosen
  .map(
    name => `  {
    const re = made(one);
    if (typeof re === "string") line += " " + re;
    else${name === "source" ? " if (!written[at])" : ""} line += " ${name} " + ${uses[name]} + "," + re.lastIndex;
  }`,
  )
  .join("\n")}
  console.log(line);
}
for (let at = 0; at < cases.length; at++) run(cases[at], at);`;
}
