// Regular expressions whose text arrives at run time, so that nothing about them is known when the program is compiled, matched against subjects that are hard on a matcher.
//
//   patterns  drawn from a grammar: characters of 7, 8 and 16 bits, pairs and lone halves of surrogates, classes, negated and empty classes, escapes of every kind, properties, sets of the flag v with differences, intersections and strings,
//             groups, named groups, the same name in two alternatives, references backward, forward, by name and into themselves, lookahead and lookbehind of both signs and nested, modifiers, anchors and word borders,
//             quantifiers of every form, greedy and lazy, nested, over what may be empty, with counts up to 4294967295 and beyond; texts that are no pattern at all; very long and very deep patterns
//   classics  the nested and overlapping repetitions that make a backtracking matcher walk every way, on subjects short enough to end
//   made      from one text, from pieces joined at run time, from another RegExp with other flags, by compile(); with every set of flags, also sets that are refused
//   subjects  made of what the pattern names and what it does not; empty; one unit repeated up to 200,000 times with a tail that fits or fails; lone halves at the ends
//   used by   exec in a loop, test, match, matchAll, replace with a text full of $ forms and with a function, replaceAll, split with and without a limit, search; lastIndex negative, huge, a fraction, NaN, beyond the end,
//             an object that converts and meanwhile changes the RegExp; a frozen RegExp; an `exec` of the instance's own
//
// Each use prints its answer, or the name of its error, and lastIndex behind it.
import type { Random } from "./random";

export const prelude = `type Case = { pieces: string[]; flags: string; head: string; unit: string; count: number; tail: string };
function show(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 24 ? JSON.stringify(value.slice(0, 12)) + ".." + value.length + "#" + hashOf(value) : JSON.stringify(value);
  if (Array.isArray(value)) {
    const match = value as RegExpMatchArray & { indices?: unknown };
    let text = "[" + (value.length > 12 ? value.slice(0, 12).map(show).join() + ".." + value.length : value.map(show).join()) + "]";
    if (typeof match.index === "number") text += "@" + match.index;
    if (match.groups) text += "{" + Object.entries(match.groups).map(([name, group]) => name + ":" + show(group)).join() + "}";
    if (match.indices) text += "i" + JSON.stringify(match.indices).slice(0, 80);
    return text;
  }
  return String(value);
}
function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash;
}
function attempt(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).name;
  }
}
function subjectOf(one: Case): string {
  return one.head + one.unit.repeat(one.count) + one.tail;
}
function textOf(one: Case): string {
  let text = "";
  for (const piece of one.pieces) text += piece;
  return text;
}`;

const explosive: [string, string, string][] = [
  ["(a+)+$", "a", "b"],
  ["(a|aa)+$", "a", "b"],
  ["(a|a)*c", "a", "b"],
  ["(.*)*x", "a", "b"],
  ["(a*)*b", "a", "c"],
  ["^(([a-z])+.)+[A-Z]([a-z])+$", "a", "!"],
  ["(x+x+)+y", "x", "z"],
  ["(?:a?){20}a{20}", "a", ""],
  ["^(a+)+\\1$", "a", "b"],
  ["(?<=(a+)+)b$", "a", "c"],
  ["((a+)|(a+b))+c", "a", "d"],
  ["(\\w+\\s?)+$", "a ", "!"],
  ["(?=(a+))\\1+$", "a", "b"],
  ["(a{1,3}){1,9}$", "a", "b"],
  ["([ab]+)+?c", "ab", "d"],
];
const fitsAtOnce: [string, string, string][] = [
  ["a*b", "a", "b"],
  ["(a)*b", "a", "b"],
  ["(?:ab)*c", "ab", "c"],
  ["[^b]*b", "a", "b"],
  [".*b", "a", "b"],
  [".*?b", "a", "b"],
  ["a*?b", "a", "b"],
  ["\\w+\\s", "a", " "],
  ["(a|b)*c", "a", "c"],
  ["a{1,4294967295}b", "a", "b"],
  ["^(?:a|ab)*$", "a", ""],
  ["(?<x>a)+b", "a", "b"],
  ["(.)\\1*b", "a", "b"],
  ["\\ud83d", "\ud83d\ude00", ""],
  [".", "\ud83d\ude00", ""],
  ["^.*$", "\u00e9", ""],
  ["(?:\\ud83d\\ude00)+$", "\ud83d\ude00", ""],
  ["[\\s\\S]*", "a\n", ""],
  ["(?=(a*))\\1b", "a", "b"],
  ["^(a*)*$", "a", ""],
];
const notPatterns = ["(", ")", "[", "a{2,1}", "*", "+a", "a**", "(?<n>a)(?<n>b)", "\\k<x>(?<y>a)", "(?<1a>b)", "\\", "[b-a]", "(?<=a)+", "\\u{110000}", "\\p{Nope}", "[a--]", "(?i-i:a)", "(?", "(?<", "a{99999999999999999999}", "\\c", "[\\d-z]", "\\8", "(?<a>.)\\k<b>", "[[a]", "\\q{a}", "(?:a", "x{1", "\\p", "[&&]", "(?ii:a)"];
const flagSets = ["", "", "", "g", "g", "i", "m", "s", "u", "u", "v", "v", "y", "d", "gi", "gy", "gu", "gv", "iu", "iv", "gim", "dg", "dgimsuy", "dgimsvy", "su", "my", "uy", "ig", "ms", "gs", "giu", "yu", "dv", "uv", "gg", "x"];

class Grammar {
  groups = 0;
  names: string[] = [];
  constructor(
    readonly random: Random,
    readonly unicode: boolean,
    readonly sets: boolean,
  ) {}
  character(): string {
    const r = this.random;
    return r.weighted([
      [10, () => r.pick(["a", "b", "c", "A", "B", "0", "1", " ", "_", "-"])],
      [2, () => r.pick(["\u00e9", "\u00df", "\u00ff", "\u0130", "\u017f", "\u212a", "\u4e2d", "\u03c3", "\u03c2"])],
      [2, () => r.pick(["\\ud83d\\ude00", "\ud83d\ude00", "\\ud83d", "\\ude00", "\\u{1f600}", "\\u0061", "\\x61", "\\u{61}"])],
      [2, () => r.pick(["\\n", "\\t", "\\0", "\\cA", "\\/", "\\.", "\\$", "\\\\", "\\]", "\\("])],
      // What only the older grammar lets through.
      [this.unicode || this.sets ? 0 : 1, () => r.pick(["\\1", "\\2", "\\9", "\\07", "\\a", "\\e", "\\_", "\\c1", "\\u12", "\\x1", "\\-", "{", "}", "]"])],
    ] as const)();
  }
  classEscape(): string {
    const r = this.random;
    const plain = ["\\d", "\\D", "\\w", "\\W", "\\s", "\\S"];
    return this.unicode || this.sets ? r.pick([...plain, "\\p{L}", "\\P{L}", "\\p{Lu}", "\\p{Script=Greek}", "\\p{ASCII}", "\\p{Any}", "\\p{Emoji}", "\\P{Any}", "\\p{sc=Han}", "\\p{Lowercase}"]) : r.pick([...plain, "\\p{L}"]);
  }
  classBody(depth: number): string {
    const r = this.random;
    const item = () =>
      r.weighted([
        [5, () => r.pick(["a", "b", "c", "A", "0", "_", "\u00e9", "\u4e2d", "\ud83d\ude00"])],
        [4, () => r.pick(["a-c", "A-Z", "0-9", "\\x00-\\x7f", "\u00e0-\u00ff", "\\u0000-\\uffff", "a-a", "\ud83d\ude00-\ud83d\ude4f"])],
        [3, () => this.classEscape()],
        [1, () => r.pick(this.sets ? ["\\b", "\\-", "\\]", "\\^", "\\ud83d", "\\ude00", "."] : ["\\b", "\\-", "\\]", "\\^", "^", "-", "\\ud83d", "\\ude00", "."])],
      ] as const)();
    if (this.sets && depth > 0 && r.chance(0.5)) {
      const operand = () => r.weighted([[3, () => `[${this.classBody(depth - 1)}]`], [2, () => this.classEscape()], [1, () => r.pick(["\\q{abc|a|}", "\\q{\ud83d\ude00|b}", "\\p{RGI_Emoji}", "\\p{Basic_Emoji}"])], [2, () => r.pick(["a", "b", "\u00e9"])]] as const)();
      const operator = r.pick(["--", "&&", ""]);
      return Array.from({ length: r.between(2, 3) }, operand).join(operator);
    }
    return Array.from({ length: r.between(0, 4) }, item).join("");
  }
  atom(depth: number): string {
    const r = this.random;
    const choices: [number, () => string][] = [
      [10, () => this.character()],
      [3, () => "."],
      [4, () => `[${r.chance(0.25) ? "^" : ""}${this.classBody(2)}]`],
      [3, () => this.classEscape()],
      [2, () => r.pick(["^", "$", "\\b", "\\B"])],
      [2, () => (this.groups ? `\\${r.between(1, this.groups + (this.unicode || this.sets ? 0 : 1))}` : this.unicode || this.sets ? "a" : "\\1")],
      [1, () => (this.names.length ? `\\k<${r.pick(this.names)}>` : "b")],
    ];
    if (depth > 0)
      choices.push(
        [5, () => (this.groups++, `(${this.alternatives(depth - 1)})`)],
        [3, () => `(?:${this.alternatives(depth - 1)})`],
        [
          2,
          () => {
            const name = r.pick(["n", "m", "x", "\u00e9", "$", "_1"].filter(each => !this.names.includes(each) || r.chance(0.1)));
            this.groups++;
            this.names.push(name);
            return `(?<${name}>${this.alternatives(depth - 1)})`;
          },
        ],
        [2, () => `(?=${this.alternatives(depth - 1)})`],
        [2, () => `(?!${this.alternatives(depth - 1)})`],
        [2, () => `(?<=${this.alternatives(depth - 1)})`],
        [2, () => `(?<!${this.alternatives(depth - 1)})`],
        [1, () => `(?${r.pick(["i", "s", "m", "-i", "i-s", "ims", "-ims"])}:${this.alternatives(depth - 1)})`],
      );
    return r.weighted(choices)();
  }
  quantifier(isOneCharacter: boolean): string {
    const r = this.random;
    const many = isOneCharacter ? 1 : 0;
    return (
      r.weighted([
        [12, ""],
        [3, "*"],
        [3, "+"],
        [3, "?"],
        [1, "{0}"],
        [1, "{1}"],
        [1, "{2}"],
        [1, "{0,1}"],
        [1, "{1,3}"],
        [1, "{2,}"],
        [1, "{0,}"],
        [1, "{1,4294967295}"],
        [1, "{0,4294967296}"],
        [many, "{4294967295}"],
        [many, "{2147483648,}"],
        [this.unicode || this.sets ? 0 : 1, "{,3}"],
        [many, "{1000}"],
      ] as const) + (r.chance(0.2) ? "?" : "")
    ).replace(/^\?$/, () => (r.chance(0.5) ? "?" : ""));
  }
  sequence(depth: number): string {
    return Array.from({ length: this.random.between(0, 4) }, () => {
      const atom = this.atom(depth);
      // Nothing repeats an anchor or a look behind; the newer grammar lets nothing repeat a look ahead either.
      if (/^(?:\^|\$|\\[bB]|\(\?<[=!])/.test(atom) || ((this.unicode || this.sets) && /^\(\?[=!]/.test(atom))) return this.random.chance(0.03) ? atom + "*" : atom;
      return atom + this.quantifier(/^(?:[a-zA-Z0-9 _.]|\\[dDwWsS])$/.test(atom));
    }).join("");
  }
  alternatives(depth: number): string {
    return Array.from({ length: this.random.weighted([[6, 1], [3, 2], [1, 3]] as const) }, () => this.sequence(depth)).join("|");
  }
}

// `re` is the RegExp, `s` the subject.
export const uses: Record<string, string> = {
  exec: "attempt(() => re.exec(s))",
  "exec-in-a-loop": 'attempt(() => {\n      let all = "";\n      for (let i = 0; i < 8; i++) {\n        const m = re.exec(s);\n        all += show(m) + re.lastIndex + " ";\n        if (!m) break;\n        if (m[0] === "" && (re.global || re.sticky)) re.lastIndex++;\n      }\n      return all;\n    })',
  test: "attempt(() => re.test(s))",
  "test-twice": "attempt(() => String(re.test(s)) + re.lastIndex + re.test(s))",
  match: "attempt(() => s.match(re))",
  "match-all": "attempt(() => [...s.matchAll(re)].slice(0, 6).map(show).join())",
  "replace-text": "attempt(() => s.replace(re, \"<$&|$1|$2|$<n>|$`|$'|$$|$0|$10>\"))",
  "replace-function": "attempt(() => s.replace(re, (...parts: unknown[]) => \"<\" + parts.slice(0, -2).map(part => (typeof part === \"object\" ? \"groups\" : show(part))).join() + \">\"))",
  "replace-all": 'attempt(() => s.replaceAll(re, "#"))',
  split: "attempt(() => s.split(re))",
  "split-limit": "attempt(() => s.split(re, 3))",
  search: "attempt(() => s.search(re))",
  source: "attempt(() => re.source + \"/\" + re.flags + \"/\" + String(re).length)",
  again: "attempt(() => new RegExp(re).exec(s))",
  "other-flags": 'attempt(() => new RegExp(re, re.flags.includes("i") ? "g" : "gi").exec(s))',
  "from-the-source": "attempt(() => new RegExp(re.source, re.flags).exec(s))",
  compile: 'attempt(() => {\n      const other = new RegExp(re);\n      (other as any).compile("a|" + re.source, re.flags.replace("v", "u"));\n      return other.exec(s);\n    })',
  "last-index-negative": "attempt(() => {\n      re.lastIndex = -1;\n      return show(re.exec(s)) + re.lastIndex;\n    })",
  "last-index-huge": "attempt(() => {\n      re.lastIndex = 4294967296;\n      return show(re.exec(s)) + re.lastIndex;\n    })",
  "last-index-at-the-end": "attempt(() => {\n      re.lastIndex = s.length;\n      return show(re.exec(s)) + re.lastIndex;\n    })",
  "last-index-beyond": "attempt(() => {\n      re.lastIndex = s.length + 1;\n      return show(re.exec(s)) + re.lastIndex;\n    })",
  "last-index-fraction": "attempt(() => {\n      re.lastIndex = 1.9;\n      return show(re.exec(s)) + re.lastIndex;\n    })",
  "last-index-nan": "attempt(() => {\n      re.lastIndex = NaN;\n      return show(re.exec(s)) + re.lastIndex;\n    })",
  "last-index-inside-a-pair": "attempt(() => {\n      re.lastIndex = Math.max(0, s.indexOf(\"\\ude00\"));\n      return show(re.exec(s)) + re.lastIndex;\n    })",
  "last-index-converts": '(() => {\n      const own = new RegExp(re);\n      (own as any).lastIndex = {\n        valueOf() {\n          (own as any).compile("b+", "g");\n          return 1;\n        },\n      };\n      return attempt(() => show(own.exec(s)) + own.source);\n    })()',
  frozen: "(() => {\n      const own = Object.freeze(new RegExp(re));\n      return attempt(() => own.exec(s)) + attempt(() => s.replace(own, \"-\")) + attempt(() => s.match(own));\n    })()",
  "own-exec": "(() => {\n      const own = new RegExp(re);\n      let calls = 0;\n      (own as any).exec = function (this: RegExp, text: string) {\n        return ++calls > 3 ? null : RegExp.prototype.exec.call(this, text);\n      };\n      return attempt(() => s.replace(own, \"-\")) + attempt(() => s.match(own)) + attempt(() => s.split(own, 2)) + attempt(() => own.test(s)) + calls;\n    })()",
};

export function generate(random: Random): string {
  const cases: unknown[] = [];
  const kinds: string[] = [];
  const count = random.between(10, 22);
  const cut = (text: string) => {
    if (text.length < 2 || random.chance(0.4)) return [text];
    const at = random.between(1, text.length - 1);
    return [text.slice(0, at), text.slice(at)];
  };
  const letters = ["a", "b", "c", "A", "B", "0", "1", " ", "_", "-", "\n", "\u00e9", "\u00df", "\u0130", "\u212a", "\u4e2d", "\u03c3", "\ud83d\ude00", "\ud83d", "\ude00", "aa", "ab", "abc"];
  for (let i = 0; i < count; i++) {
    const kind = random.weighted([[10, "drawn"], [3, "explosive"], [2, "no-pattern"], [1, "long"], [1, "deep"], [2, "long-subject"]] as const);
    kinds.push(kind);
    const some = (most: number) => Array.from({ length: random.between(0, most) }, () => random.pick(letters)).join("");
    let flags = random.pick(flagSets);
    if (kind === "explosive") {
      const [pattern, unit, tail] = random.pick(explosive);
      cases.push({ pieces: cut(pattern), flags: random.pick(["", "", "u", "i", "s", "v"]), head: "", unit, count: random.between(1, Math.floor(17 / unit.length)), tail: random.chance(0.7) ? tail : "" });
    } else if (kind === "no-pattern") {
      cases.push({ pieces: cut(random.pick(notPatterns)), flags, head: some(4), unit: "a", count: 2, tail: "" });
    } else if (kind === "long") {
      const many = random.pick([200, 2000, 20000]);
      const form = random.pick(["alternatives", "sequence", "class", "groups"]);
      const unit = form === "alternatives" ? "ab|" : form === "sequence" ? "a?" : form === "class" ? "a-c" : "(a)";
      cases.push({ pieces: [form === "class" ? "[" : "", unit.repeat(form === "groups" ? Math.min(many, 2000) : many), form === "class" ? "]+" : form === "alternatives" ? "c" : ""], flags: random.pick(["", "g", "u", "i"]), head: some(3), unit: "a", count: random.between(0, 40), tail: some(3) });
    } else if (kind === "deep") {
      const depth = random.pick([30, 300, 1500, 100000]);
      const [open, close] = random.pick([["(", ")"], ["(?:", ")"], ["(?=", ")"], ["(?:", ")*"], ["(?<=", ")"], ["(", ")?"]] as const);
      cases.push({ pieces: [open.repeat(depth), "a", close.repeat(depth)], flags: random.pick(["", "u"]), head: "", unit: "a", count: 3, tail: "" });
    } else if (kind === "long-subject") {
      // A matcher that goes back needs the square of the length wherever the first try fails, so the longest subjects fit at their first character.
      const [pattern, unit, tail] = random.pick(fitsAtOnce);
      const isLongest = random.chance(0.5);
      cases.push({ pieces: cut(pattern), flags: random.pick(["", "g", "u", "y", "s", "gu", "i", "d"]), head: "", unit, count: isLongest ? random.pick([20000, 200000]) : /\)[*+]/.test(pattern) ? random.between(1, 12) : random.pick([30, 300]), tail: isLongest || random.chance(0.5) ? tail : random.pick(["", "!", "\ud83d"]) });
    } else {
      const grammar = new Grammar(random, flags.includes("u"), flags.includes("v"));
      cases.push({ pieces: cut(grammar.alternatives(random.between(0, 3))), flags, head: some(5), unit: random.pick(letters), count: random.between(0, 5), tail: some(5) });
    }
  }
  const chosen = random.sample(Object.keys(uses), random.between(4, 8));
  const slow = new Set(["match-all", "replace-function", "split", "replace-all", "replace-text", "own-exec", "frozen", "exec-in-a-loop"]);
  return `// ${chosen.join(" ")} | ${kinds.join(" ")}
${prelude}
const cases: Case[] = JSON.parse(${JSON.stringify(JSON.stringify(cases))});
function made(one: Case): RegExp | string {
  try {
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
    else${slow.has(name) ? " if (s.length <= 20000)" : ""} line += " ${name} " + ${uses[name]} + "," + re.lastIndex;
  }`,
  )
  .join("\n")}
  console.log(line);
}
for (let at = 0; at < cases.length; at++) run(cases[at], at);`;
}
