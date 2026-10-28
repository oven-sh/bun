// Programs full of random regular expression literals. The code for a literal is generated when the program is built, so a program
// of some hundred literals tests that many pieces of generated code. At run time each expression meets every subject over a small
// alphabet up to a small length, as 8-bit and as 16-bit strings, and the program prints one number per expression: a hash of where
// each match began and what each group captured.
//
// The reference is plain Bun WITHOUT the regular expression JIT (BUN_JSC_useRegExpJIT=0), because the JIT and the ahead-of-time
// compiler share the code generator, and a mistake in it would show on both sides.
import { Random } from "./python-random";

export type Written = { file: string; text: string };

const smallProgram = [
  "declare const console: { log(...values: any[]): void };",
  "export { };",
  "const subjects: string[] = [\"\"];",
  "for (let from = 0, length = 1; length <= 5; ++length) { const to = subjects.length; for (let i = from; i < to; ++i) for (const c of \"abc,\") subjects.push(subjects[i] + c); from = to; }",
  "const wide: string[] = subjects.map((s: string): string => s + \"\u0100\");",
  "function one(h: number, r: RegExp, s: string): number {",
  "    r.lastIndex = 0;",
  "    const m = r.exec(s);",
  "    if (m === null) return (h * 31 + 7) | 0;",
  "    h = (h * 31 + m.index) | 0;",
  "    for (let i = 0; i < m.length; ++i) { const c = m[i]; h = (h * 31 + (c === undefined ? -1 : c.length * 131 + (c.length ? c.charCodeAt(0) : 0))) | 0; }",
  "    return h;",
  "}",
  "const all: RegExp[] = [",
  "%s",
  "];",
  "for (let k = 0; k < all.length; ++k) { let h = 0; const r = all[k]; for (const s of subjects) h = one(h, r, s); for (const s of wide) h = one(h, r, s); console.log(k, h); }",
  "",
].join("\n");

const written = (program: string, rows: string[]): Written => ({ file: "main.ts", text: program.replace("%s", () => rows.join("\n")) });

/** Loops, groups, alternatives, lookaheads, back references and assertions over "abc,". Odd seeds nest deeper and have alternatives at the top. */
export function loopsAndGroups(seed: number, count: number): Written {
  const random = new Random(seed);
  const isEven = seed % 2 === 0;
  const characters = ["a", "b", "c", ","];
  const classes = ["[ab]", "[bc]", "[^a]", "[a-c]", ".", "\\w", "[^,]", "[ac]", "[^bc]", "\\W", "[b,]", "[^]", "\\s", "\\S"];
  const counts = ["", "", "", "", "*", "*", "+", "+", "?", "{2}", "{1,2}", "{0,2}", "{2,}", "*?", "+?", "??"];
  const countsOfGroups = ["", "", "*", "*", "*", "+", "+", "+", "?", "{2}", "{1,2}", "{2,}", "*?", "+?", "??", "{0,3}"];
  let captures = 0;

  function atom(depth: number): string {
    const r = random.random();
    if (depth < (isEven ? 2 : 3) && r < 0.3) {
      const k = random.random();
      if (k < 0.62) return "(?:" + alternatives(depth + 1) + ")" + random.choice(countsOfGroups);
      if (k < 0.86) {
        captures++;
        return "(" + alternatives(depth + 1) + ")" + random.choice(countsOfGroups);
      }
      if (k < 0.93) return "(?=" + alternatives(depth + 1) + ")";
      return "(?!" + alternatives(depth + 1) + ")";
    }
    if (r < (isEven ? 0.32 : 0.36)) return random.choice(["^", "$", "\\b", "\\B"]);
    if (r < 0.38 && captures) return "\\" + random.randint(1, captures);
    if (r < 0.7) return random.choice(characters) + random.choice(counts);
    return random.choice(classes) + random.choice(counts);
  }
  function sequence(depth: number): string {
    let text = "";
    for (let n = depth ? random.choice(isEven ? [1, 1, 2, 2, 3] : [1, 1, 2, 2, 3, 3, 4]) : random.choice([1, 2, 3, 3, 4, 5]); n > 0; n--) text += atom(depth);
    return text;
  }
  function alternatives(depth: number): string {
    const parts: string[] = [];
    for (let n = depth || !isEven ? random.choice([1, 1, 1, 2, 2, 3]) : 1; n > 0; n--) parts.push(sequence(depth));
    return parts.join("|");
  }

  const rows: string[] = [];
  const seen = new Set<string>();
  while (rows.length < count) {
    captures = 0;
    const pattern = alternatives(0);
    const flags = random.choice(["", "", "", "", "i", "m", "s", "u", "iu", "y", "v"]);
    const row = `    /${pattern}/${flags},`;
    if (seen.has(row) || !pattern) continue;
    seen.add(row);
    rows.push(row);
  }
  return written(smallProgram, rows);
}

/** One or two groups of short fixed alternatives (prefixes of one another, of equal sizes, empty ones) with every kind of thing in front and behind. */
export function groupsOfAlternatives(seed: number, count: number): Written {
  const random = new Random(seed);
  const units = ["a", "b", "c", "a", "b", "[ab]", "[bc]", "\\w", ".", ",", "[^a]"];
  const behind = [
    "", "", "", "$", "$", "\\b", "\\b", "\\B", "a", "b", "c", ",", "[ab]", "[^a]", "[^b]", "\\w", "\\W", "(?=a)", "(?!b)", "(?=$)", "a?", "b*", "c+", "(?:c|$)", "(?:,|)", "\\1", ".", "a$", "b\\b", ",?$",
  ];
  const inFront = ["", "", "", "^", "^", "a", "c", ",", "\\b", "[ab]*", "a+", "c?", "\\w*", ".", "(?:a|b)"];

  function alternative(): string {
    let text = "";
    for (let n = random.choice([0, 1, 1, 1, 2, 2, 2, 3, 3, 4]); n > 0; n--) text += random.choice(units) + random.choice(["", "", "", "", "{2}"]);
    return text;
  }
  function group(depth = 0): string {
    const n = random.choice([2, 2, 2, 3, 3, 4, 5]);
    const parts = Array.from({ length: n }, alternative);
    if (depth < 1 && random.random() < 0.25) {
      const at = random.randrange(n);
      parts[at] += group(depth + 1) + random.choice(["", "", "a", "c"]);
    }
    const open = random.choice(["(?:", "(?:", "(?:", "(", "(", "(?=(", "(?=(?:", "(?!(?:"]);
    const close = open.split("(").length === 3 ? "))" : ")";
    const times = open.startsWith("(?=") || open.startsWith("(?!") ? "" : random.choice(["", "", "", "", "?", "*", "+", "+", "*", "{2}", "{1,2}", "*?", "??"]);
    return open + parts.join("|") + close + times;
  }

  const rows: string[] = [];
  const seen = new Set<string>();
  while (rows.length < count) {
    let pattern = random.choice(inFront) + group() + random.choice(behind);
    if (random.random() < 0.3) pattern += group() + random.choice(behind);
    if (random.random() < 0.15) pattern = pattern + "|" + random.choice(inFront) + group() + random.choice(behind);
    if (pattern.includes("\\1") && !/\((?!\?)./s.test(pattern)) continue;
    const flags = random.choice(["", "", "", "", "i", "m", "s", "u", "iu", "y", "v", "g"]);
    const row = `    /${pattern}/${flags},`;
    if (seen.has(row)) continue;
    seen.add(row);
    rows.push(row);
  }
  return written(smallProgram, rows);
}

const largeClasses = [
  "\\p{L}",
  "\\p{L}",
  "\\p{Lu}",
  "\\p{Ll}",
  "\\p{N}",
  "\\p{M}",
  "\\p{P}",
  "\\p{S}",
  "\\p{Lo}",
  "\\P{L}",
  "\\P{Lu}",
  "\\p{ID_Start}",
  "\\p{ID_Continue}",
  "\\p{Alphabetic}",
  "\\p{Emoji}",
  "\\p{Script=Han}",
  "\\p{Script=Greek}",
  "[\\p{L}\\p{N}_]",
  "[\\p{L}\\p{M}\\p{N}\\p{Pc}]",
  "[^\\p{L}]",
  "[^\\p{L}\\p{N}_]",
  "[\\p{L}\\u{1F600}-\\u{1F64F}]",
  "[^\\p{Lu}\\u{10000}-\\u{10FFFF}]",
  "[\\p{Ll}\\u{E000}-\\u{10FFFF}]",
  "[\\p{L}\\ud800-\\udbff]",
  "[^\\p{L}\\udc00-\\udfff]",
  "[\\u0100-\\u017f\\u0400-\\u04ff\\u3040-\\u30ff\\u4e00-\\u9fff\\uac00-\\ud7a3\\u0590-\\u05ff\\u0600-\\u06ff\\u0900-\\u097f\\u0e00-\\u0e7f]",
  "[a-z\\u0100-\\u017f\\u0391-\\u03a9\\u0400-\\u04ff\\u3040-\\u30ff\\u4e00-\\u9fff\\uac00-\\ud7a3\\uf900-\\ufaff\\uff00-\\uffef\\u{1D400}-\\u{1D7FF}]",
  "[^\\S\\n]",
  "[\\S\\n]",
  "[\\S]",
  "[\\W_]",
  "[^\\W\\d]",
  "[\\D]",
  "[^\\D]",
  "[\\P{L}\\p{Lu}]",
  "[^\\P{L}]",
  "[\\u0100-\\u167f\\u1681-\\u1fff\\u200b-\\u2027\\u202a-\\u202e\\u2030-\\u205e\\u2060-\\u2fff\\u3001-\\ufefe\\uff00-\\u{10ffff}]",
  "[\\u0100-\\u0110\\u0120-\\u0130\\u0140-\\u0150\\u0160-\\u0170\\u0180-\\u0190\\u01a0-\\u01b0\\u01c0-\\u01d0\\u9000-\\ud7ff]",
  "[^\\u0100-\\u0110\\u0120-\\u0130\\u0140-\\u0150\\u0160-\\u0170\\u0180-\\u0190\\u01a0-\\u01b0\\u01c0-\\u01d0\\u4000-\\uefff]",
  "[\\u0100-\\u0110\\u0120-\\u0130\\u0140-\\u0150\\u0160-\\u0170\\u0180-\\u0190\\u01a0-\\u01b0\\u01c0-\\u01d0\\ue000-\\u{1ffff}]",
  "[^a-z\\u0100-\\u017f\\u0391-\\u03a9\\u0400-\\u04ff\\u3040-\\u30ff\\u4e00-\\u9fff\\uac00-\\ud7a3\\uf900-\\ufaff\\uff00-\\uffef\\u{1D400}-\\u{1D7FF}]",
  "\\w",
  "\\W",
  ".",
  "\\s",
  "\\S",
  "\\d",
];
// Without `u` or `v` there are no property escapes and no \u{..}. The written classes with members beyond Latin-1 are left, and these.
const moreClasses = [
  "[\\u0100-\\u0110\\u0120-\\u0130\\u0140-\\u0150\\u0160-\\u0170\\u0180-\\u0190\\u01a0-\\u01b0\\u01c0-\\u01d0\\u03a9]",
  "[^\\u0100-\\u0110\\u0120-\\u0130\\u0140-\\u0150\\u0160-\\u0170\\u0180-\\u0190\\u01a0-\\u01b0\\u01c0-\\u01d0\\u03a9]",
  "[a\\u0100\\u0102\\u0104\\u0106\\u0108\\u010a\\u03a9\\u4e2d\\ud7ff\\ud835\\udc00\\uffff]",
  "[^a\\u0100\\u0102\\u0104\\u0106\\u0108\\u010a\\u03a9\\u4e2d\\ud7ff\\ud835\\udc00\\uffff]",
  "[\\u0100-\\ud7ff\\ue000\\ue002\\ue004\\ue006\\ue008\\ue00a\\ue00c\\uffff]",
  "[\\u0100-\\u0110\\u0120-\\u0130\\u0140-\\u0150\\u0160-\\u0170\\u0180-\\u0190\\u01a0-\\u01b0\\u01c0-\\u01d0\\u03a9]",
  "[^\\u0100-\\u0110\\u0120-\\u0130\\u0140-\\u0150\\u0160-\\u0170\\u0180-\\u0190\\u01a0-\\u01b0\\u01c0-\\u01d0\\u03a9]",
  "[a\\u0100\\u0102\\u0104\\u0106\\u0108\\u010a\\u03a9\\u4e2d\\ud7ff\\ud835\\udc00\\uffff]",
  "[^a\\u0100\\u0102\\u0104\\u0106\\u0108\\u010a\\u03a9\\u4e2d\\ud7ff\\ud835\\udc00\\uffff]",
  "[\\u0100-\\ud7ff\\ue000\\ue002\\ue004\\ue006\\ue008\\ue00a\\ue00c\\uffff]",
];
const literals = ["a", "a", "Z", "_", "5", " ", "\\xe9", "\\xff", "\\u0100", "\\u03a9", "\\u4e2d", "\\ud7ff", "\\ue000", "\\uffff", "\\u{1D400}", "\\u{1F600}", "\\u{10FFFF}", "\\ud835", "\\udc00", "\\ud83d", "\\ude00"];

const largeProgram = [
  "declare const console: { log(...values: any[]): void };",
  "export { };",
  "const units: string[] = [\"a\", \"Z\", \"_\", \"5\", \" \", \"\\xe9\", \"\\xff\", \"\u0100\", \"\u03a9\", \"\u4e2d\", \"\ud7ff\", \"\ue000\", \"\uffff\", \"\\ud835\", \"\\udc00\", \"\\ud83d\", \"\\ude00\", \"\\udbff\", \"\\udfff\"];",
  "const subjects: string[] = [\"\"];",
  "for (let from = 0, length = 1; length <= 3; ++length) { const to = subjects.length; for (let i = from; i < to; ++i) for (const c of units) subjects.push(subjects[i] + c); from = to; }",
  "function one(h: number, r: RegExp, s: string, at: number): number {",
  "    r.lastIndex = at;",
  "    const m = r.exec(s);",
  "    if (m === null) return (h * 31 + 7) | 0;",
  "    h = (h * 31 + m.index) | 0;",
  "    for (let i = 0; i < m.length; ++i) { const c = m[i]; h = (h * 31 + (c === undefined ? -1 : c.length * 131 + (c.length ? c.charCodeAt(c.length - 1) : 0))) | 0; }",
  "    return h;",
  "}",
  "const all: RegExp[] = [",
  "%s",
  "];",
  "for (let k = 0; k < all.length; ++k) {",
  "    let h = 0; const r = all[k]; const moves = r.sticky || r.global;",
  "    for (const s of subjects) { h = one(h, r, s, 0); h = one(h, r, \"a\" + s + \"a\", 0); if (moves) { h = one(h, r, s, 1); h = one(h, r, s, 2); } }",
  "    console.log(k, h);",
  "}",
  "",
].join("\n");

/**
 * Large classes (property escapes, written ranges beyond Latin-1, inverted ones, ranges up to U+10FFFF) and literals of every kind
 * (ASCII, Latin-1, BMP, astral, lone surrogates) in the usual groups, loops, lookarounds and the idiom for an atomic group. The subjects
 * are the strings of up to three units over nineteen units, among them surrogates that pair up or stay alone. Sticky and global
 * expressions are also matched from the middle of a pair.
 */
export function classesBeyondLatin1(seed: number, count: number, isUnicode: boolean): Written {
  const random = new Random(seed);
  const isPlain = (text: string) => !text.includes("\\p{") && !text.includes("\\P{") && !text.includes("\\u{");
  const classes = isUnicode ? largeClasses : [...largeClasses.filter(isPlain), ...moreClasses];
  const characters = isUnicode ? literals : literals.filter(text => !text.includes("\\u{"));
  const counts = ["", "", "", "", "", "+", "*", "?", "+?", "*?", "??", "{2}", "{1,2}", "{2,}", "{0,2}?"];

  function atom(depth: number): string {
    const r = random.random();
    if (r < 0.55) return random.choice(classes) + random.choice(counts);
    if (r < 0.78 || depth > 2) return random.choice(characters) + random.choice(counts);
    if (r < 0.86) return "(?:" + alternatives(depth + 1) + ")" + random.choice(counts);
    if (r < 0.92) return "(" + alternatives(depth + 1) + ")" + random.choice(counts);
    if (r < 0.95) return random.choice(["(?=", "(?!", "(?<=", "(?<!"]) + alternatives(depth + 1) + ")";
    if (r < 0.97) return random.choice(["\\b", "\\B", "^", "$"]);
    const name = random.randrange(10 ** 6);
    return `(?:(?=(?<g${name}>${sequence(depth + 1)}))\\k<g0>)`;
  }
  function sequence(depth: number): string {
    let text = "";
    for (let n = random.choice([1, 1, 2, 2, 3, 4]); n > 0; n--) text += atom(depth);
    return text;
  }
  function alternatives(depth: number): string {
    const parts: string[] = [];
    for (let n = random.choice([1, 1, 2, 2, 3]); n > 0; n--) parts.push(sequence(depth));
    return parts.join("|");
  }
  /** Gives each back reference of the atomic-group idiom the name of its own lookahead, the innermost first. */
  function named(pattern: string): string | undefined {
    for (let at; (at = pattern.indexOf("\\k<g0>")) >= 0; ) {
      let depth = 0;
      let i = at - 1;
      for (; ; i--) {
        if (pattern[i] === ")" && pattern[i - 1] !== "\\") depth++;
        else if (pattern[i] === "(" && pattern[i - 1] !== "\\" && --depth === 0) break;
      }
      const name = /^\(\?=\(\?<(g\d+)>/.exec(pattern.slice(i))?.[1];
      if (!name) return undefined;
      pattern = pattern.slice(0, at) + "\\k<" + name + ">" + pattern.slice(at + 6);
    }
    return pattern;
  }

  const rows: string[] = [];
  const seen = new Set<string>();
  while (rows.length < count) {
    const pattern = named(alternatives(0));
    if (pattern === undefined) continue;
    let flags = random.choice(["u", "u", "u", "v", "v", "iu", "iv", "su", "mu", "yu", "gu", "gv", "yv"]);
    if (!isUnicode) flags = random.choice(["", "", "", "i", "i", "s", "m", "y", "g", "gi"]);
    const row = `    /${pattern}/${flags},`;
    if (seen.has(row)) continue;
    seen.add(row);
    rows.push(row);
  }
  return written(largeProgram, rows);
}

/**
 * A repeated group with two alternatives: one ends in a run of characters, the other consumes nothing or may consume nothing. Whether the
 * next turn of the group can go on behind the run hangs on where the run has stopped, so the run has to give characters back.
 */
export function runsInFrontOfAssertions(seed: number, count: number): Written {
  const random = new Random(seed);
  const runs = ["b*", "b+", "b*?", "b+?", "b?", "b{0,2}", "b{1,}", "b{2,3}", "[ab]*", "[ab]+", "\\w*", "\\w+", ".*", "[^,]*", "(?:b)*", "(b)*", "(?:b)+", "(?:b|c)*", "(?:ab)*", "(?:b*)", "(b+)"];
  const empties = [
    "\\b", "\\b", "\\B", "^", "$", "(?=a)", "(?=b)", "(?!a)", "(?!b)", "(?<=b)", "(?<=,b)", "(?<!b)", "(?<!a)", "(?=)", "(?!)", "", "(?:\\b)", "(\\b)", "(?:^|$)", "\\b\\b", "\\B(?=a)",
    "(?=\\b)", "(?!\\b)", "c?\\b", "\\bc?", "(?:\\b|c)", "(?=a|$)", "(?:)", "()",
  ];
  const heads = [",", ",", "", "a", "c", "[,a]"];
  const times = ["{2}", "{2}", "{3}", "+", "+", "*", "{1,2}", "{2,}", "{2,3}", "+?", "*?", "{2,3}?", "?"];
  const inFront = ["", "", "^", "^", "a", ",?"];
  const behind = ["", "", "", "$", "a", "b", ",", "\\b", "(?=a)", "\\1"];

  const rows: string[] = [];
  const seen = new Set<string>();
  while (rows.length < count) {
    const withRun = random.choice(heads) + random.choice(runs);
    const parts = [withRun, random.choice(empties)];
    if (random.random() < 0.2) parts.push(random.choice(empties));
    if (random.random() < 0.35) parts.reverse();
    const open = random.choice(["(?:", "(?:", "(?:", "("]);
    let pattern = random.choice(inFront) + open + parts.join("|") + ")" + random.choice(times) + random.choice(behind);
    if (random.random() < 0.15) pattern = "(?:" + pattern + ")" + random.choice(["{2}", "+", "*"]);
    const flags = random.choice(["", "", "", "", "m", "i", "y", "g", "s", "u"]);
    if (pattern.includes("\\1") && !/\((?!\?)/.test(pattern)) continue;
    const row = `    /${pattern}/${flags},`;
    if (seen.has(row)) continue;
    seen.add(row);
    rows.push(row);
  }
  return written(smallProgram, rows);
}

/**
 * The same expressions, each as a text that is whole only when the program runs. No code is generated for such a text when the program is
 * built: the executable compiles it when the expression is made, and matches it without the JIT.
 */
export function outOfText({ file, text }: Written): Written {
  const rows = text.replace(
    /^    \/(.*)\/([a-z]*),$/gm,
    (_, pattern: string, flags: string) => `    new RegExp(${JSON.stringify(pattern)} + nothing, ${JSON.stringify(flags)}),`,
  );
  return { file, text: rows.replace("const all: RegExp[] = [", () => "const nothing: string = String(Date.now()).slice(99);\nconst all: RegExp[] = [") };
}
