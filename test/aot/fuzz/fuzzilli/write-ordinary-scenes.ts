// Writes scenes of ordinary code: a few lines as people write them, drawn from tables.
// What a generator of random operations seldom writes: data that comes out of a parser and isn't all of one kind, asked what it is beside arithmetic on it;
// iterator helpers and array methods with built-in functions as callbacks; iterators, array-likes and thenables that are written by hand and only append to a text.
// A scene prints one text at its end, and nothing in it calls the host before that.
import { combinations, conversions, predicates } from "./hand-over-built-ins.ts";
import { randomFrom } from "./print-members-of-objects.ts";

class Scenes {
  readonly lines: string[] = [];
  private count = 0;
  constructor(
    private readonly random: () => number,
    private readonly isTypeScript: boolean,
  ) {}

  below = (bound: number) => Math.floor(this.random() * bound);
  chance = (percent: number) => this.random() * 100 < percent;
  pick = <T>(from: readonly T[]) => from[this.below(from.length)];
  several = <T>(least: number, most: number, make: () => T) =>
    Array.from({ length: least + this.below(most - least + 1) }, make);
  /** The plain form in `percent` cases of 100. A scene is plain in most of its places, so that what is odd in it stands alone. */
  plainly = <T>(percent: number, plain: T, other: () => T) => (this.chance(percent) ? plain : other());
  /** An annotation, in TypeScript. */
  typed = (type: string) => (this.isTypeScript ? `: ${type}` : "");

  // Values as JSON writes them.
  whole = () => String(this.pick([0, 1, 2, 3, 4, 5, 7, 10, -1, 100, 255, 65536, 2147483647, -2147483648]));
  fraction = () =>
    String(this.pick([0.5, 1.5, 2.5, -0.5, 0.25, 7.5, 1e21, 1e-7, 4294967296, 2147483648, 9007199254740992]));
  word = () => JSON.stringify(this.pick(["p", "", "a", "3", "1.5", "text", "length", "0", "NaN", "null", " ", "é"]));
  odd = () =>
    this.pick([
      () => this.word(),
      () => this.word(),
      () => "null",
      () => "true",
      () => "false",
      () => '{"a":1}',
      () => "{}",
      () => "[7]",
      () => "[]",
      () => "-0",
      () => this.fraction(),
      () => this.whole(),
    ])();
  cellOf = (kind: string) =>
    kind === "whole"
      ? this.whole()
      : kind === "fraction"
        ? this.fraction()
        : kind === "word"
          ? this.word()
          : this.odd();

  /** Texts of lists: all of one kind, but for one cell of one of them. Some are short or empty. */
  textsOfLists() {
    const kind = this.pick(["whole", "fraction", "fraction", "either", "either", "either", "word"]);
    const cell = () => this.cellOf(kind === "either" ? this.pick(["whole", "fraction"]) : kind);
    const lists = this.several(2, 5, () =>
      this.several(this.pick([0, 1, 2, 4, 4, 4, 6]), 6, cell).slice(0, this.pick([0, 1, 2, 4, 4, 5, 6])),
    );
    for (let count = this.pick([0, 1, 1, 1, 2]); count > 0; count--) {
      const list = this.pick(lists);
      list[this.below(Math.max(list.length, 2))] = this.odd();
    }
    return lists.map(list => `[${Array.from(list, each => each ?? "null").join(",")}]`);
  }

  /** Texts of records with the same keys, but for one: a value of another kind, a key that is missing, one more, or another order. */
  textsOfRecords() {
    const keys = ["a", "b", "c", "d"].slice(0, 2 + this.below(3));
    const kinds = keys.map(() => this.pick(["whole", "fraction", "word", "whole"]));
    const records = this.several(2, 5, () =>
      keys.map((key, index): [string, string] => [key, this.cellOf(kinds[index])]),
    );
    for (let count = this.pick([0, 1, 1, 1, 2]); count > 0; count--) {
      const record = this.pick(records);
      const at = this.below(record.length);
      switch (this.below(5)) {
        case 0:
        case 1:
          record[at][1] = this.odd();
          break;
        case 2:
          record.splice(at, 1);
          break;
        case 3:
          record.splice(at, 0, [this.pick(["e", "0", "length", "__proto__", "constructor", "toString"]), this.odd()]);
          break;
        default:
          record.reverse();
      }
    }
    return records.map(record => `{${record.map(([key, value]) => `"${key}":${value}`).join(",")}}`);
  }

  /** What a line of text becomes. */
  parsed(line: string, isList: boolean) {
    const parse = `JSON.parse(${line})`;
    return this.pick([
      parse,
      parse,
      parse,
      parse,
      `structuredClone(${parse})`,
      `JSON.parse(${line}, (key${this.typed("string")}, value${this.typed("any")}) => value)`,
      `JSON.parse(JSON.stringify(${parse}))`,
      ...(isList
        ? [
            `[...${parse}]`,
            `Array.from(${parse})`,
            `${parse}.slice()`,
            `${parse}.map((each${this.typed("any")}) => each)`,
            `${parse}.concat()`,
            `Object.values(${parse})`,
            `${parse}.filter(() => true)`,
          ]
        : [`{ ...${parse} }`, `Object.assign({}, ${parse})`, `Object.fromEntries(Object.entries(${parse}))`]),
    ]);
  }

  /** Questions whose answers follow once the compiler takes `e` for a number, a text or an object. Each is a text or a flag. */
  question(e: string) {
    const literal = this.pick(['"p"', '"a"', '""', "3", "0", "1.5", "null", "undefined", "true", "false"]);
    const kind = this.pick(["number", "string", "object", "boolean", "undefined", "function"]);
    return this.pick([
      `${e} === ${literal} ? "T" : "f"`,
      `${e} === ${literal} ? "T" : "f"`,
      `${e} !== ${literal} ? "t" : "F"`,
      `${e} == ${literal} ? "T" : "f"`,
      `typeof ${e} === "${kind}" ? "T" : "f"`,
      `typeof ${e} === "${kind}" ? "T" : "f"`,
      `typeof ${e} !== "${kind}" ? "t" : "F"`,
      `typeof ${e}`,
      `${e} == null ? "T" : "f"`,
      `(${e} ?? 7) === 7 ? "T" : "f"`,
      `Array.isArray(${e}) ? "T" : "f"`,
      `${e} instanceof Object ? "T" : "f"`,
      `${e} instanceof Array ? "T" : "f"`,
      `Number.isInteger(${e}) ? "T" : "f"`,
      `Number.isFinite(${e}) ? "T" : "f"`,
      `${e} !== ${e} ? "T" : "f"`,
      `Object.is(${e}, ${this.pick(["-0", "0", "NaN", '"p"', "null"])}) ? "T" : "f"`,
      `${e}?.a === 1 ? "T" : "f"`,
      `${e}?.length`,
      `${e} ? "T" : "f"`,
      `!${e}`,
      `${e} || "else"`,
      `${e} && "and"`,
      `${e} === ${literal} ? "first" : ${e} === ${this.pick(["3", "0", '"a"', "null"])} ? "D" + ${e} : "L" + ${e}`,
      `String(${e})`,
      `"" + ${e}`,
      `\`<\${${e}}>\``,
      `[${e}].join()`,
      `JSON.stringify(${e})`,
      `Boolean(${e})`,
      `${e} < 2`,
      `${e} >= ${this.pick(['"a"', "1", "0.5"])}`,
      `${e} in { 0: 1, a: 1, p: 1 } ? "T" : "f"`,
    ]);
  }

  /** Arithmetic, which says that `e` is expected to be a number. */
  arithmetic(e: string) {
    return this.pick([
      `${e} * 0.5`,
      `${e} * 0.5`,
      `${e} * 2`,
      `${e} + 1`,
      `${e} - 1`,
      `${e} | 0`,
      `${e} >>> 0`,
      `${e} % 3`,
      `-${e}`,
      `+${e}`,
      `${e} / 4`,
      `${e} ** 2`,
      `Math.floor(${e})`,
      `Math.max(${e}, 1)`,
      `Math.abs(${e})`,
      `Number(${e})`,
      `(${e} > 0 ? ${e} * 0.5 : 0)`,
      `(${e} > 1 ? ${e} : 1)`,
      `~${e}`,
      `${e} << 1`,
    ]);
  }

  /** One statement about `e`. It adds to `out` or to `sum`. */
  statementAbout(e: string, another: string) {
    const unknown = this.isTypeScript && this.chance(40) ? `(${e} as unknown as any)` : e;
    return this.pick([
      () => `out += ${this.wrap(this.question(unknown))} + ",";`,
      () => `out += ${this.wrap(this.question(unknown))} + ",";`,
      () => `out += ${this.wrap(this.question(unknown))} + ",";`,
      () => `sum += ${this.arithmetic(e)};`,
      () => `sum += ${this.arithmetic(another)};`,
      () => `if (${e} > 1) sum += ${this.arithmetic(e)};`,
      () => `if (${another} > 1) sum += ${this.arithmetic(another)};`,
      () =>
        `if (${this.question(unknown).replace(/ \? "[A-Za-z]+" : "[A-Za-z]+"$/, "")}) sum += ${this.arithmetic(e)}; else out += "-";`,
      () =>
        `switch (typeof ${unknown}) { case "number": sum += ${this.arithmetic(e)}; break; case "string": out += "S"; break; case "object": out += "O"; break; default: out += "?"; }`,
      () =>
        `switch (${unknown}) { case ${this.pick(['"p"', '"a"', "3", "null"])}: out += "1"; break; case ${this.pick(["0", "1", "true", '""'])}: out += "2"; break; default: out += "3"; }`,
      () =>
        this.chance(50)
          ? `counts[${unknown}] = (counts[${unknown}] ?? 0) + 1;`
          : `kept.push(${this.chance(50) ? e : this.arithmetic(e)});`,
    ])();
  }
  wrap = (expression: string) => `(${expression})`;

  /** Emits `lines` one level deeper, each below a comment that lets it past the checker. */
  emit(depth: number, ...lines: string[]) {
    const indent = "    ".repeat(depth);
    for (const line of lines) {
      if (this.isTypeScript && !/^[{}]|^\} /.test(line)) this.lines.push(indent + "// @ts-ignore");
      this.lines.push(indent + line);
    }
  }

  /** Data that comes out of a parser, one text after another through the same code. */
  sceneOfParsedData() {
    const number = ++this.count;
    const isList = this.chance(65);
    const texts = isList ? this.textsOfLists() : this.textsOfRecords();
    const type = this.pick(
      isList
        ? ["any", "any", "number[]", "number[]", "string[]", "(number | string)[]", "any[]", "[number, number]"]
        : ["any", "any", "{ a: number; b: number }", "Record<string, number>", "{ a: number; b?: string; c: number }"],
    );
    const places = isList
      ? ["c[0]", "c[0]", "c[1]", "c[1]", "c[2]", "c[3]", "c[8]", "c[9]", "c[c.length - 1]", "c.at(-1)", "c.at(0)"]
      : ["c.a", "c.a", "c.b", "c.b", "c.c", 'c["a"]', "c.missing", "c.d", "c?.b"];
    const body: string[] = [];
    /** A question about one place and arithmetic beside it, on the same place or on another, in either order. */
    const pair = (asked: string, beside: string) => {
      const unknown = this.isTypeScript && this.chance(40) ? `(${asked} as unknown as any)` : asked;
      const steps = [
        `out += ${this.wrap(this.question(unknown))} + ",";`,
        this.chance(50)
          ? `sum += ${this.arithmetic(beside)};`
          : `if (${beside} > 1) sum += ${this.arithmetic(beside)};`,
      ];
      return this.chance(35) ? steps.reverse() : steps;
    };
    const direct = () => {
      const asked = this.pick(places);
      body.push(
        ...pair(asked, this.chance(40) ? asked : this.pick(places)),
        ...this.several(0, 2, () => this.statementAbout(this.pick(places), this.pick(places))),
      );
    };
    const walks = isList
      ? [
          ["for (let index = 0; index < c.length; index++) {", "c[index]"],
          ["for (let index = c.length - 1; index >= 0; index--) {", "c[index]"],
          ["for (const value of c) {", "value"],
          ["for (const index in c) {", "c[index]"],
          [`c.forEach((value${this.typed("any")}) => {`, "value"],
          ["for (const [index, value] of c.entries()) {", "value"],
        ]
      : [
          ["for (const key in c) {", "c[key]"],
          ["for (const key of Object.keys(c)) {", "c[key]"],
          ["for (const value of Object.values(c)) {", "value"],
          ["for (const [key, value] of Object.entries(c)) {", "value"],
        ];
    const walk = () => {
      const [head, e] = this.pick(walks);
      body.push(
        head,
        ...pair(e, this.chance(50) ? e : this.pick(places)).map(step => "    " + step),
        ...this.several(0, 1, () => "    " + this.statementAbout(e, this.pick([...places, e]))),
        head.includes("=> {") ? "});" : "}",
      );
    };
    const pattern = () => {
      body.push(
        "{",
        isList
          ? this.pick([
              "const [first, second] = c;",
              "const [first, second = 0] = c;",
              "const [first, , second] = c;",
              "const [first, ...[second]] = c;",
            ])
          : this.pick([
              "const { a: first, b: second } = c;",
              "const { a: first, b: second = 0 } = c;",
              "const { a: first, ...others } = c, second = others.b;",
            ]),
        ...this.several(1, 3, () =>
          this.statementAbout(this.pick(["first", "second"]), this.pick(["first", "second", ...places])),
        ),
        "}",
      );
    };
    for (const step of this.several(1, 2, () => this.pick([direct, direct, direct, walk, walk, pattern]))) step();

    const asLiterals = this.chance(12);
    const list = asLiterals ? `[${texts.join(", ")}]` : `[${texts.map(text => JSON.stringify(text)).join(", ")}]`;
    const made = asLiterals ? "line" : this.parsed("line", isList);
    const turns = this.pick([1, 1, 1, 2, 40]);
    const place = this.pick(["here", "here", "here", "a function", "a function", "a callback", "a method"]);
    const [counts, keeps] = [
      body.some(line => line.includes("counts[")),
      body.some(line => line.includes("kept.push(")),
    ];
    const state = [
      `let sum${this.typed("any")} = 0;`,
      ...(counts ? [`const counts${this.typed("any")} = {};`] : []),
      ...(keeps ? [`const kept${this.typed("any[]")} = [];`] : []),
    ];
    const end = `out += " " + sum${counts ? ' + " " + Object.keys(counts).join("+")' : ""}${keeps ? ' + " " + kept.join("+")' : ""} + "; ";`;
    this.lines.push("{");
    this.emit(1, `let out = "";`);
    let call = "";
    if (place === "a function" || place === "a method") {
      const head = `look${number}(c${this.typed(type)})${this.typed("void")} {`;
      if (place === "a method") this.emit(1, `class Looks${number} {`);
      const depth = place === "a method" ? 2 : 1;
      this.emit(depth, place === "a method" ? head : `function ${head}`);
      this.emit(depth + 1, ...state, ...body, end);
      this.emit(depth, "}");
      if (place === "a method") this.emit(1, "}", `const looks${number} = new Looks${number}();`);
      call = `${place === "a method" ? `looks${number}.` : ""}look${number}(${made});`;
    }
    let depth = 1;
    if (turns > 1)
      this.emit(depth++, `for (let turn = 0; turn < ${turns}; turn++) {`, ...(turns > 2 ? ['    out = "";'] : []));
    this.emit(
      depth,
      place === "a callback" ? `${list}.forEach((line${this.typed("any")}) => {` : `for (const line of ${list}) {`,
    );
    if (call) this.emit(depth + 1, call);
    else this.emit(depth + 1, `const c${this.typed(type)} = ${made};`, ...state, ...body, end);
    this.emit(depth, place === "a callback" ? "});" : "}");
    if (turns > 1) this.emit(--depth, "}");
    this.emit(1, `printValue("parsed ${number}", out);`);
    this.lines.push("}");
  }

  // Functions that are handed over.
  predicate = (): string =>
    this.pick([
      () => this.pick(predicates),
      () => this.pick(predicates),
      () => this.pick(predicates),
      () => this.pick(conversions),
      () => `(each${this.typed("any")}) => each > 1`,
      () => `(each${this.typed("any")}) => typeof each === "${this.pick(["number", "string", "object"])}"`,
      () =>
        `(each${this.typed("any")}) => { note("p"); return each ${this.pick(["!== 2", "> 0", '=== "a"', "% 2"])}; }`,
      () => `function (each${this.typed("any")}) { return !each; }`,
    ])();
  conversion = (): string =>
    this.pick([
      () => this.pick(conversions),
      () => this.pick(conversions),
      () => this.pick(conversions),
      () => this.pick(predicates),
      () => `(each${this.typed("any")}) => each * 2`,
      () => `(each${this.typed("any")}) => each + ""`,
      () => `(each${this.typed("any")}) => [each, each]`,
      () => `(each${this.typed("any")}) => ({ a: each })`,
      () => `(each${this.typed("any")}) => { note("m"); return each; }`,
    ])();
  combination = (): string =>
    this.pick([
      () => this.pick(combinations),
      () => this.pick(combinations),
      () => `(left${this.typed("any")}, right${this.typed("any")}) => left + right`,
      () =>
        `(left${this.typed("any")}, right${this.typed("any")}) => { note("c"); return left > right ? left : right; }`,
    ])();

  listLiteral = () =>
    this.pick([
      () => `[${this.several(0, 4, () => this.whole()).join(", ")}]`,
      () => `[${this.several(1, 4, () => this.whole()).join(", ")}]`,
      () => `[${this.several(1, 4, () => this.fraction()).join(", ")}]`,
      () => `[${this.several(1, 4, () => this.word()).join(", ")}]`,
      () => `[${this.several(1, 4, () => this.odd()).join(", ")}]`,
      () => `[1]`,
      () => `[0, 1, 2]`,
      () => `[1, , 3]`,
      () => `JSON.parse(${JSON.stringify(this.pick(this.textsOfLists()))})`,
    ])();

  /** Declares something that can be walked and is written by hand. Answers an expression that makes one. */
  declareWalkable(depth: number) {
    const number = ++this.count;
    const any = this.typed("any");
    const first = this.pick([
      'note("n");',
      'note("n");',
      'out += "n";',
      'out += "n";',
      "steps++;",
      "",
      'note("n" + i);',
    ]);
    const bound = this.pick([0, 1, 2, 2, 3, 5]);
    const value = this.pick([
      "j",
      "j",
      "j * 0.5",
      '"t" + j',
      "[j, j]",
      "{ a: j }",
      'j % 2 ? j : "t"',
      "undefined",
      "j - 1",
    ]);
    const result = this.pick([
      `{ done: j >= ${bound}, value: ${value} }`,
      `{ done: j >= ${bound}, value: ${value} }`,
      `{ value: ${value}, done: j >= ${bound} }`,
      `j >= ${bound} ? { done: true, value: undefined } : { done: false, value: ${value} }`,
      `j >= ${bound} ? { done: true } : { value: ${value} }`,
      `{ get done() { ${this.pick(["", 'note("d");'])} return j >= ${bound}; }, value: ${value} }`,
    ]);
    const next = `next()${any} { ${first} const j = i++; return ${result}; }`;
    const closes = this.pick([
      "",
      "",
      `return()${any} { return {}; }`,
      `return()${any} { note("r"); return {}; }`,
      `return()${any} { out += "r"; return { done: true }; }`,
      `return(value${any})${any} { note("r"); return { done: true, value }; }`,
      `return()${any} { note("r"); }`,
      `return()${any} { note("r"); throw new RangeError("closed"); }`,
      `get return()${any} { note("g"); return undefined; }`,
    ]);
    const itself = this.pick([
      `[Symbol.iterator]()${any} { return this; }`,
      `[Symbol.iterator]()${any} { return this; }`,
      `[Symbol.iterator]()${any} { note("i"); return this; }`,
    ]);
    switch (this.below(6)) {
      case 0:
      case 1:
        this.emit(
          depth,
          `function walk${number}()${any} { let i = 0; return { ${[itself, next, closes].filter(Boolean).join(", ")} }; }`,
        );
        return `walk${number}()`;
      case 2:
        this.emit(
          depth,
          `function walk${number}()${any} { return { [Symbol.iterator]()${any} { let i = 0; return { ${[next, closes].filter(Boolean).join(", ")} }; } }; }`,
        );
        return `walk${number}()`;
      case 3:
        this.emit(
          depth,
          `class Walk${number} { i = 0; ${[itself, next.replace("i++", "this.i++").replace('"n" + i', '"n" + this.i'), closes].filter(Boolean).join(" ")} }`,
        );
        return `new Walk${number}()`;
      case 4:
        this.emit(
          depth,
          `class Walk${number} extends Iterator${this.isTypeScript ? "<any>" : ""} { i = 0; ${[next.replace("i++", "this.i++").replace('"n" + i', '"n" + this.i'), closes].filter(Boolean).join(" ")} }`,
        );
        return `new Walk${number}()`;
      default:
        this.emit(
          depth,
          `function* walk${number}()${any} { ${this.pick(["", 'note("s");', "try {"])} for (let j = 0; j < ${bound}; j++) { ${first.replace('"n" + i', '"n" + j')} yield ${value}; }`.replace(
            /^(.*try \{.*)$/,
            '$1 } finally { note("f"); }',
          ) + " }",
        );
        return `walk${number}()`;
    }
  }

  /** An iterator: of a built-in, or of what is written by hand. */
  walker(walkables: string[]) {
    const list = this.listLiteral();
    let made = this.pick([
      () => `${list}.values()`,
      () => `${list}.values()`,
      () => `${list}.values()`,
      () => `${list}.keys()`,
      () => `${list}.entries()`,
      () => `new Set(${list}).values()`,
      () => `new Map(${list}.entries()).values()`,
      () => `${this.word()}[Symbol.iterator]()`,
      () => `"a1b22".matchAll(/\\d+/g)`,
      () => `new Float64Array(${list}).values()`,
      () => `Iterator.from(${walkables.length ? this.pick(walkables) : list})`,
      () => `Iterator.from(${walkables.length ? this.pick(walkables) : list})`,
      () => `(function* () { yield* ${walkables.length && this.chance(50) ? this.pick(walkables) : list}; })()`,
    ])();
    for (let count = this.pick([0, 0, 0, 1, 1, 2]); count > 0; count--)
      made += this.pick([
        () => `.map(${this.conversion()})`,
        () => `.filter(${this.predicate()})`,
        () => `.take(${this.below(4)})`,
        () => `.drop(${this.below(3)})`,
        () =>
          `.flatMap(${this.pick(["Array.of", `(each${this.typed("any")}) => [each, each]`, "Object.keys", "Object.values", "String"])})`,
      ])();
    return made;
  }

  /** An expression that walks something to its end, or to where it stops. */
  walkedToAnEnd(walkables: string[]) {
    const source = this.chance(65) ? this.walker(walkables) : this.listLiteral();
    return (
      source +
      this.pick([
        () => `.some(${this.predicate()})`,
        () => `.some(${this.predicate()})`,
        () => `.every(${this.predicate()})`,
        () => `.every(${this.predicate()})`,
        () => `.find(${this.predicate()})`,
        () => `.find(${this.predicate()})`,
        () => `.reduce(${this.combination()})`,
        () => `.reduce(${this.combination()}, ${this.pick(["0", '""', "1.5", "[]"])})`,
        () => `.forEach(${this.pick([this.conversion(), "note"])})`,
        () => `.map(${this.conversion()})${source.endsWith("]") || source.endsWith('")') ? "" : ".toArray()"}.join()`,
        () => `.filter(${this.predicate()})${source.endsWith("]") || source.endsWith('")') ? "" : ".toArray()"}.join()`,
      ])()
    );
  }

  /** Things that walk, and functions that are handed to them. */
  sceneOfWalks() {
    const number = ++this.count;
    const any = this.typed("any");
    this.lines.push("{");
    this.emit(1, `let out = "";`, "let steps = 0;", `function note(text${any})${this.typed("void")} { out += text; }`);
    const walkables: string[] = [];
    const guard = this.pick(["nothing", "nothing", "each", "some"]);
    const say = (statement: string) => {
      if (guard === "each" || (guard === "some" && this.chance(50)))
        this.emit(
          1,
          `try { ${statement} } catch (error) { note("threw " + (error${this.isTypeScript ? " as any" : ""})?.constructor?.name); }`,
        );
      else this.emit(1, statement);
    };
    const shown = (expression: string) =>
      this.pick([
        `note(String(${expression}));`,
        `note(${expression});`,
        `out += ${expression};`,
        `printValue(${expression});`,
        `note(typeof ${expression});`,
      ]);
    const walksABuiltIn = () => say(shown(this.walkedToAnEnd(walkables)));
    const walksWhatIsWrittenByHand = () => {
      const walkable = this.pick(walkables);
      const body = this.pick([
        'note("b");',
        'note("b");',
        'out += "b";',
        "note(value);",
        "steps += value;",
        ";",
        '{ if (value) break; note("b"); }',
        '{ if (!value) continue; note("b"); }',
      ]);
      say(
        this.pick([
          `for (const value of ${walkable}) ${body}`,
          `for (const value of ${walkable}) ${body}`,
          `for (const value of ${walkable}) ${body}`,
          `{ const [first, second] = ${walkable}; note(first + "" + second); }`,
          `{ const [first] = ${walkable}; note(String(first)); }`,
          `{ const [, ...others] = ${walkable}; note(others.length); }`,
          `note([...${walkable}].length);`,
          `note(Array.from(${walkable}${this.chance(40) ? `, ${this.conversion()}` : ""}).length);`,
          `note(new Set(${walkable}).size);`,
          `note(Math.max(...${walkable}));`,
          `note(Array.of(...${walkable}).join());`,
          `note(Iterator.from(${walkable}).${this.pick(["some", "every", "find"])}(${this.predicate()}));`,
          `note(String(new Map(${walkable}).size));`,
          `note(Object.keys(Object.fromEntries(${walkable})).join());`,
          `for (const value of (function* () { yield* ${walkable}; })()) note(value);`,
        ]),
      );
    };
    // Walks of built-ins can stand above the declarations of what is written by hand, between its uses and below them.
    for (let count = this.pick([0, 1, 1, 2]); count > 0; count--) walksABuiltIn();
    for (let count = this.pick([0, 1, 1, 1, 2]); count > 0; count--) walkables.push(this.declareWalkable(1));
    for (let count = this.pick([1, 1, 2, 3]); count > 0; count--)
      if (walkables.length && this.chance(70)) walksWhatIsWrittenByHand();
      else walksABuiltIn();
    this.emit(1, `printValue("walked ${number}", out, steps);`);
    this.lines.push("}");
  }

  /** A variable that changes in the middle of the expression that reads it: between two elements of a literal, two arguments, two parts of a template. */
  sceneOfChangesInTheMiddle() {
    const number = ++this.count;
    const any = this.typed("any");
    const change = this.plainly(
      35,
      this.pick([
        "(n |= 0)",
        "(n |= 0)",
        "(n ^= 0)",
        "(n &= -1)",
        "(n <<= 0)",
        "(n >>= 0)",
        "(n >>>= 0)",
        "(n = given)",
      ]),
      () =>
        this.pick([
          "(n |= 0)",
          "(n |= 0)",
          "(n = n | 0)",
          "(n += 0.5)",
          '(n += "")',
          "n++",
          "++n",
          "n--",
          "(n = -n)",
          "(n = [n])",
          "(n = { a: n })",
          "(n = undefined)",
          "(n = null)",
          "(n *= 2)",
          "(n /= 2)",
          "(n = String(n))",
          "(n = Number(n))",
          "(n >>>= 0)",
          "(n = n + 1)",
          "(n ??= 7)",
          "(n ||= 7)",
          "(n &&= 0.5)",
          "(n = given)",
          "(n = n * 4294967296)",
        ]),
    );
    const changes = this.pick([
      change,
      change,
      `(() => ${change})()`,
      `(() => ${change})()`,
      `(function () { return ${change}; })()`,
      "changed()",
      "changed()",
      `[0].map(() => ${change})[0]`,
      `{ get now() { return ${change}; } }.now`,
      `(0, ${change})`,
      `(n === n ? ${change} : 0)`,
      `(() => { ${change}; })()`,
      `void ${change}`,
    ]);
    const read = () => this.plainly(88, "n", () => this.pick(["(() => n)()", "+n", "n + 0", "[n][0]", "typeof n"]));
    const three = () => `${read()}, ${changes}, ${read()}`;
    const list = () =>
      this.plainly(45, `[${three()}]`, () =>
        this.pick([
          `[${three()}]`,
          `[${three()}]`,
          `[${three()}]`,
          `[${three()}, ${changes}, ${read()}]`,
          `[${read()}, ...[${changes}], ${read()}]`,
          `[[${read()}], [${changes}], [${read()}]].flat()`,
          `Array.of(${three()})`,
          `all(${three()})`,
          `all(${three()})`,
          `all(...[${three()}])`,
          `all.call(${three()}, ${read()})`,
          `new Three(${three()}).all`,
          `[].concat(${three()})`,
          `[${read()} ${this.pick(["<", "===", "+", "*", "-", "==", "&&", "??"])} ${changes}, ${read()}]`,
          `[${read()}, ${read()} ${this.pick(["+", "*", "-", "%", "|"])} ${changes} ${this.pick(["+", "*", "-"])} ${read()}]`,
          `[\`\${${read()}}|\${${changes}}|\${${read()}}\`]`,
          `[tagged\`\${${read()}}|\${${changes}}|\${${read()}}\`]`,
          `(([first = ${read()}, second = ${changes}, third = ${read()}]${any}) => [first, second, third])([])`,
          `((first${any} = ${read()}, second${any} = ${changes}, third${any} = ${read()}) => [first, second, third])()`,
          `[Math.max(${three()})]`,
          `[${read()}, ${changes}, ${read()}].map(${this.conversion()})`,
        ]),
      );
    const record = () =>
      this.plainly(
        40,
        this.pick([
          `{ set p(x${any}) {}, q: ${changes}, get p() { return n; } }`,
          `{ get p() { return n; }, q: ${changes}, set p(x${any}) {} }`,
        ]),
        () =>
          this.pick([
            `{ a: ${read()}, b: ${changes}, c: ${read()} }`,
            `{ a: ${read()}, b: ${changes}, c: ${read()} }`,
            `{ set p(x${any}) {}, q: ${changes}, get p() { return n; } }`,
            `{ get p() { return n; }, q: ${changes}, set p(x${any}) {} }`,
            `{ get p() { return n; }, q: ${changes}, r: ${read()} }`,
            `{ p: ${read()}, q: ${changes}, get p() { return n; } }`,
            `{ get p() { return 0; }, q: ${changes}, p: ${read()} }`,
            `{ p: ${read()}, q: ${changes}, p: ${read()} }`,
            `{ [${read()}]: 1, [${changes}]: 2, [${read()}]: 3 }`,
            `{ a: ${read()}, ...{ b: ${changes} }, c: ${read()} }`,
            `{ a: ${read()}, m() { return n; }, b: ${changes}, c: ${read()} }`,
            `{ 0: ${read()}, 1: ${changes}, 2: ${read()} }`,
            `{ __proto__: { a: ${read()} }, b: ${changes}, c: ${read()} }`,
          ]),
      );
    const shown = `(each${any}) => (typeof each === "object" && each !== null ? JSON.stringify(each) : Object.is(each, -0) ? "-0" : String(each))`;
    // Most scenes print what they read as it is. A function that shows every value is one place where all of them meet.
    const show = this.plainly(
      65,
      (value: string) => value,
      () => (value: string) => `show(${value})`,
    );
    const use = this.pick([
      () => `for (const each of ${list()}) out += ${show("each")} + ",";`,
      () => `for (const each of ${list()}) out += ${show("each")} + ",";`,
      () => `for (const each of ${list()}) out += ${show("each")} + ",";`,
      () => `out += ${list()}.join();`,
      () =>
        `{ const [first, second, third] = ${list()}; out += ${show("first")} + "," + ${show("second")} + "," + ${show("third")}; }`,
      () =>
        `{ const made = ${list()}; for (let index = 0; index < made.length; index++) out += ${show("made[index]")} + ","; }`,
      () => `{ const made = ${list()}; out += ${show("made[0]")} + "," + ${show("made[2]")} + "," + made.length; }`,
      () => `return ${list()};`,
      () => `return ${record()}.p;`,
      () => `return ${record()}.p;`,
      () =>
        `{ const made${any} = ${record()}; out += ${show("made.p")} + "," + ${show("made.a")} + "," + ${show("made.c")} + Object.keys(made).join(); }`,
      () => `out += JSON.stringify(${record()});`,
      () => `out += Object.values(${record()}).join();`,
      () => `return ${record()};`,
    ])();
    // One caller with one kind of value, most often: what several callers hand over is a set of kinds, and the compiler expects less.
    const start = () =>
      this.plainly(
        55,
        this.pick(["1.5", "1.5", "3.75", "0.5", "-1.5", "9.5", 'JSON.parse("5")', 'JSON.parse("1.5")', "5"]),
        () =>
          this.pick([
            "3",
            '"a"',
            '"2"',
            "2147483647",
            "-0",
            "null",
            "undefined",
            "[1]",
            "{ a: 1 }",
            "true",
            "4294967296.5",
          ]),
      );
    const starts = this.plainly(60, [start()], () => this.several(2, 3, start));
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `const show = ${shown};`,
      `function all(...given${this.typed("any[]")})${any} { return given; }`,
      `function tagged(texts${any}, ...given${this.typed("any[]")})${any} { return given.map(show).join("|"); }`,
      `class Three { all${any}; constructor(...given${this.typed("any[]")}) { this.all = given; } }`,
    );
    const inner = changes === "changed()" ? `function changed()${any} { return ${change}; } ` : "";
    switch (this.below(4)) {
      case 0:
      case 1:
        this.emit(
          1,
          this.chance(50)
            ? `const scene = (n${any}, given${any}) => { ${inner}${use} };`
            : `function scene(n${any}, given${any})${any} { ${inner}${use} }`,
        );
        break;
      case 2:
        this.emit(1, `function scene(start${any}, given${any})${any} { let n = start; ${inner}${use} }`);
        break;
      default:
        this.emit(
          1,
          `function scene(start${any}, given${any})${any} { for (let n = start, turn = 0; turn < 2; turn++) { ${inner}${use.replace(/^return (.*);$/, "out += show($1);")} } }`,
        );
    }
    for (const start of starts)
      this.emit(1, `out += show(scene(${start}, ${this.pick(["0", "1.5", '"t"', "null", "[2]"])})) + "; ";`);
    this.emit(1, `printValue("changed ${number}", out);`);
    this.lines.push("}");
  }

  /** Files that stand beside the program: `[name, text]`. */
  readonly files: [string, string][] = [];
  /** Lines without indentation in front of the scenes. */
  readonly imports: string[] = [];

  /** A module whose exports have the names of globals and of members that every object has, read through a namespace: its own or that of another file. */
  sceneOfNamespaces(hash: string) {
    const number = ++this.count;
    const any = this.typed("any");
    const extension = this.isTypeScript ? "ts" : this.pick(["mjs", "js"]);
    const file = `./space${number}-${hash}.${extension}`;
    const bindable = [
      "NaN",
      "NaN",
      "NaN",
      "Infinity",
      "Array",
      "Object",
      "Number",
      "Math",
      "JSON",
      "then",
      "length",
      "name",
      "constructor",
      "toString",
      "valueOf",
      "a",
      "b",
    ];
    const others = [
      "undefined",
      "default",
      "null",
      "true",
      "this",
      "typeof",
      "function",
      "__proto__",
      "prototype",
      "arguments",
      "eval",
    ];
    const value = () =>
      this.pick([
        "{}",
        "{}",
        "[1]",
        "[1, 2]",
        "1.5",
        "0",
        '"text"',
        "() => 1",
        "class {}",
        "null",
        "undefined",
        "{ a: 1 }",
        "NaN",
        "7",
      ]);
    const names = [
      ...new Set(this.several(1, 3, () => this.plainly(75, this.pick(bindable), () => this.pick(others)))),
    ];
    const declarations = names.map((name, index) =>
      bindable.includes(name) && this.chance(70)
        ? `export ${this.pick(["const", "const", "let", "var"])} ${name}${any} = ${value()};`
        : `const local${index}${any} = ${value()};\nexport { local${index} as ${name} };`,
    );
    const name = this.pick(names);
    const taken = this.pick([
      `const { ${name}: q } = space;`,
      `const { ${name}: q } = space;`,
      `const { ${name}: q } = space;`,
      `const q = space.${name};`,
      `const q = space["${name}"];`,
      `const { ["${name}"]: q } = space;`,
      `const { ${name}: q = 5 } = space;`,
      `const q = { ...space }.${name};`,
      `const q = Reflect.get(space, "${name}");`,
      `const [q] = [space.${name}];`,
    ]);
    const look = this.pick([
      `function look(v${any})${any} { return Array.isArray(v) ? v.length : typeof v; }`,
      `function look(v${any})${any} { return Array.isArray(v) ? v.length : typeof v; }`,
      `function look(v${any})${any} { return typeof v === "number" ? v * 2 : typeof v; }`,
      `function look(v${any})${any} { return ${this.question("v")}; }`,
      `function look(v${any})${any} { return v !== v ? "not itself" : ${this.question("v")}; }`,
    ]);
    const shown = `look(q) + " " + look(${value()}) + " " + Object.keys(space).join()`;
    const ignore = this.isTypeScript ? "// @ts-ignore\n" : "";
    if (this.chance(55)) {
      // The file imports itself.
      this.files.push([
        file,
        [
          `${ignore}import * as space from "${file}";`,
          ...declarations.map(each => ignore + each),
          ignore + taken,
          // The keys of its own namespace cannot be listed yet: this export is one of them.
          `${ignore}export const shown${number}${any} = ${shown.replace(' + " " + Object.keys(space).join()', "")};`,
          look,
          "",
        ].join("\n"),
      ]);
      this.imports.push(`${ignore}import { shown${number} } from "${file}";`);
      this.lines.push("{");
      this.emit(1, `printValue("space ${number}", shown${number});`);
      this.lines.push("}");
      return;
    }
    // The value of one can name another that stands below it, or itself.
    this.files.push([file, [...declarations.map(each => ignore + each), ""].join("\n")]);
    this.imports.push(`${ignore}import * as space${number} from "${file}";`);
    this.lines.push("{");
    this.emit(
      1,
      `const space${any} = space${number};`.replace(
        /^const space(?:: any)? = /,
        this.chance(50) ? "const space = " : `const space${any} = `,
      ),
      taken,
      look,
      `printValue("space ${number}", ${shown});`,
    );
    this.lines.push("}");
  }

  /** Built-ins that are handed to built-ins, and objects that only look like what a built-in takes. */
  sceneOfIdioms() {
    const number = ++this.count;
    const any = this.typed("any");
    this.lines.push("{");
    this.emit(1, `let out = "";`, `function note(text${any})${this.typed("void")} { out += text + ","; }`);
    const list = () => this.listLiteral();
    const arrayLike = () =>
      this.pick([
        `{ length: 2, 0: "a", 1: "b" }`,
        `{ length: 3, 0: 1, 2: 3 }`,
        `{ length: "2", 0: 1.5, 1: 2 }`,
        `{ get length() { note("l"); return 2; }, 0: 1, 1: 2 }`,
        `{ length: 2, get 0() { note("0"); return 1; }, 1: 2 }`,
        `{ length: -1 }`,
        `"text"`,
        `new Uint8Array([1, 2])`,
      ]);
    const thenable = () =>
      this.pick([
        `{ then(resolve${any}) { note("t"); resolve(1); } }`,
        `{ then(resolve${any}, reject${any}) { note("t"); reject(new RangeError("no")); } }`,
        `{ then: ${this.pick(conversions)} }`,
        `{ get then() { note("g"); return undefined; } }`,
        `Promise.resolve(${this.whole()})`,
      ]);
    const primitive = () =>
      this.pick([
        `{ valueOf() { note("v"); return ${this.pick(["1", "1.5", '"2"', "null"])}; } }`,
        `{ toString() { note("s"); return ${this.pick(['"1"', '"a"', "2"])}; } }`,
        `{ [Symbol.toPrimitive](hint${any}) { note(hint); return ${this.pick(["1", '"a"', "1.5"])}; } }`,
        `{ valueOf: ${this.pick(["Boolean", "Number", "String", "Object", "Math.random.name.valueOf"])}, toString() { note("s"); return "3"; } }`,
        `{ toString: ${this.pick(["Array.prototype.join", "Object.prototype.toString", "String", "Number"])}, length: 2, 0: 1, 1: 2 }`,
      ]);
    const idioms: (() => string)[] = [
      () => `note(${list()}.map(${this.conversion()}).join());`,
      () => `note(${list()}.filter(${this.predicate()}).join());`,
      () => `note(${list()}.flatMap(${this.conversion()}).length);`,
      () => `note(${list()}.findLast(${this.predicate()}));`,
      () => `note(${list()}.findIndex(${this.predicate()}));`,
      () =>
        `note(${list()}.sort(${this.pick(["", this.combination(), `(left${any}, right${any}) => left - right`])}).join());`,
      () => `note(${list()}.toSorted(${this.pick(["", `(left${any}, right${any}) => right - left`])}).join());`,
      () => `note(Array.from(${arrayLike()}, ${this.conversion()}).join());`,
      () => `note(Array.from(${arrayLike()}).join());`,
      () =>
        `note(Array.from({ length: ${this.below(4)} }, ${this.pick([this.conversion(), `(_${any}, index${any}) => index * 2`])}).join());`,
      () =>
        `note(Array.prototype.${this.pick(["map", "filter", "some", "every", "find"])}.call(${arrayLike()}, ${this.predicate()}));`,
      () =>
        `note(Array.prototype.${this.pick(["join", "slice", "indexOf", "includes", "reverse", "concat", "at"])}.call(${arrayLike()}, ${this.pick(["1", '"a"', "0"])}));`,
      () => `note(${this.pick(combinations)}.apply(null, ${arrayLike()}));`,
      () => `note(Reflect.apply(${this.pick([...combinations, ...conversions])}, undefined, ${arrayLike()}));`,
      () => `note(${this.pick(combinations)}(...${list()}));`,
      () =>
        `note(${list()}.map(Function.prototype.call, ${this.pick(["String", "Number", "Boolean", "String.prototype.trim", "Object.prototype.toString"])}).join());`,
      () =>
        `note("a-b-c".replace(/-/g, ${this.pick(["String", "Number", "Array.of", "encodeURIComponent", `(found${any}) => found + found`, "Boolean"])}));`,
      () => `note("a1b2".split(${this.pick(['""', "/\\d/", '"1"'])}).map(${this.conversion()}).join());`,
      () =>
        `note(JSON.stringify(JSON.parse(${JSON.stringify(this.pick(this.chance(50) ? this.textsOfLists() : this.textsOfRecords()))}, ${this.pick(["Array.of", "Object.is", `(key${any}, value${any}) => value`, `(key${any}, value${any}) => (typeof value === "number" ? value * 2 : value)`, "String", "Math.max"])})));`,
      () =>
        `note(JSON.stringify(${this.pick([list(), primitive(), arrayLike()])}, ${this.pick(["null", "Array.of", `["a", "0"]`, `(key${any}, value${any}) => value`, "Object.is", "String"])}));`,
      () =>
        `note(Object.entries(JSON.parse(${JSON.stringify(this.pick(this.textsOfRecords()))})).map(${this.pick(["String", "Array.from", "Object.fromEntries.length.valueOf", `([key, value]${any}) => key + value`, "JSON.stringify"])}).join());`,
      () =>
        `note(new Map(Object.entries(JSON.parse(${JSON.stringify(this.pick(this.textsOfRecords()))}))).${this.pick(["size", 'get("a")', 'has("b")'])});`,
      () => `new Set(${list()}).forEach(${this.pick(["note", this.conversion()])});`,
      () => `new Map(${list()}.entries()).forEach(${this.pick(["note", this.combination()])});`,
      () =>
        `note(${primitive()} ${this.pick(["+", "*", "-", "<", "==", '+ "" +', "%"])} ${this.pick(["1", '"a"', "1.5", primitive()])});`,
      () => `note(\`\${${primitive()}}\`);`,
      () =>
        `note(${this.pick(["Number", "String", "Math.abs", "isNaN", "parseInt", "Math.max", "BigInt", "Symbol.for"])}(${primitive()})${this.chance(20) ? ".toString()" : ""});`,
      () => `note(${list()}[${primitive()}]);`,
      () =>
        `note(${list()}.${this.pick(["at", "indexOf", "includes", "slice", "fill", "join", "concat"])}(${primitive()}));`,
      () =>
        `note("text".${this.pick(["at", "charAt", "padEnd", "repeat", "slice", "indexOf", "concat", "startsWith"])}(${primitive()}));`,
      () =>
        `note([${primitive()}, ${primitive()}].${this.pick(["join()", "sort().length", "toString()", "includes(1)"])});`,
      () =>
        `Promise.resolve(${thenable()}).then(${this.pick(["note", this.conversion()])}, ${this.pick(["note", "String", `(error${any}) => note(error?.constructor?.name)`])});`,
      () =>
        `Promise.${this.pick(["all", "allSettled", "race", "any"])}([${thenable()}, ${thenable()}]).then(${this.pick(["note", "JSON.stringify", "Array.from", "String"])}).then(note, ${this.pick(["note", "String"])});`,
      () =>
        `note(${this.pick(["[]", "1", '"a"', "null", "{}"])} instanceof ${`({ [Symbol.hasInstance]: ${this.pick([...predicates, `(value${any}) => { note("h"); return value; }`])} }${this.isTypeScript ? " as any" : ""})`});`,
      () =>
        `note([0].concat(${`{ [Symbol.isConcatSpreadable]: ${this.pick(["true", "1", "0"])}, length: 2, 0: "a", 1: "b" }${this.isTypeScript ? " as any" : ""}`}).length);`,
      () =>
        `note(Object.prototype.toString.call({ ${this.pick(['[Symbol.toStringTag]: "Tag"', 'get [Symbol.toStringTag]() { note("g"); return "Tag"; }', "[Symbol.toStringTag]: 1"])} }));`,
      () =>
        `note(new Set(${list()}).${this.pick(["union", "intersection", "difference", "isSubsetOf", "isDisjointFrom"])}({ size: ${this.pick(["2", "1.5", "0"])}, has: ${this.pick(["Boolean", "Number.isInteger", `(value${any}) => { note("h"); return value > 1; }`])}, keys() { note("k"); return ${list()}.values(); } })${this.chance(50) ? "?.size" : ""});`,
    ];
    const guard = this.pick(["nothing", "each", "each", "some"]);
    let waits = false;
    for (const idiom of this.several(1, 4, () => this.pick(idioms))) {
      const statement = idiom();
      waits ||= statement.startsWith("Promise.");
      this.emit(
        1,
        guard === "each" || (guard === "some" && this.chance(50))
          ? `try { ${statement} } catch (error) { note("threw " + (error${this.isTypeScript ? " as any" : ""})?.constructor?.name); }`
          : statement,
      );
    }
    if (waits) this.emit(1, `await new Promise(resolve => setTimeout(resolve, 1));`);
    this.emit(1, `printValue("idioms ${number}", out);`);
    this.lines.push("}");
  }

  /** Reads and stores under a name that the receiver really has, most of them under a key that a variable holds. The receiver can be a copy. The result goes into a list, an object, a typed place or an operator. */
  sceneOfKeysInVariables() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function show(value${any})${this.typed("string")} { return typeof value === "function" ? "function " + value.name : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : typeof value + " " + String(value); }`,
      `function note(value${any})${this.typed("void")} { out += show(value) + ";"; }`,
    );
    const kinds: [receivers: string[], names: string[], type: string][] = [
      [
        [
          "[5]",
          "[1, 2, 3]",
          "[1.5, 2.5]",
          `["a", "b"]`,
          "[]",
          "[[1], [2, 3]]",
          "new Array(3)",
          "Array.of(7, 8)",
          "[, 1]",
        ],
        ["length", "length", "length", "0", "1", "-1", "at", "constructor", "push", "concat"],
        "any[]",
      ],
      [
        [`"text"`, `""`, `"é1"`, "String(12)", "`a${1}`"],
        ["length", "length", "0", "-1", "at", "constructor", "charAt"],
        "string",
      ],
      [
        ["new Map([[1, 2]])", "new Set([1, 2, 3])", "new Map()"],
        ["size", "size", "has", "constructor", "length"],
        "any",
      ],
      [
        [
          "function (a, b) {}",
          "(a) => a",
          "class Named { static size = 2; }",
          "Math.max",
          "Array",
          "function named() {}.bind(null)",
        ],
        ["name", "length", "prototype", "constructor", "size"],
        "Function",
      ],
      [
        [
          "new Uint8Array([1, 2])",
          "new Float64Array(3)",
          "new Int32Array([-1])",
          "new Uint8Array(new ArrayBuffer(8), 2, 4)",
        ],
        ["length", "length", "byteLength", "byteOffset", "0", "-1", "at", "buffer", "constructor"],
        "any",
      ],
      [["/a+/gi", `new RegExp("b", "y")`], ["source", "flags", "lastIndex", "global", "constructor"], "RegExp"],
      [[`new Error("m")`, `new RangeError("r", { cause: 1 })`], ["message", "name", "cause", "constructor"], "Error"],
      [
        [
          `{ length: 2, size: 3, name: "n", 0: "zero" }`,
          `{ get length() { return 4; }, at: 1 }`,
          `new (class { size = 1; get length() { return this.size + 1; } at() { return 9; } })()`,
          `Object.create({ length: 6 })`,
        ],
        ["length", "size", "name", "0", "at", "constructor"],
        "any",
      ],
      [
        ["new ArrayBuffer(8)", "new DataView(new ArrayBuffer(4), 1)"],
        ["byteLength", "byteOffset", "constructor"],
        "any",
      ],
      [[`Symbol("d")`, "12", "1.5", "true", "10n"], ["description", "constructor", "toString", "length"], "any"],
    ];
    const namesOfFunctions = [
      "at",
      "constructor",
      "push",
      "concat",
      "charAt",
      "has",
      "prototype",
      "toString",
      "buffer",
    ];
    for (let index = this.pick([2, 3, 4, 6, 8]); index > 0; index--) {
      const [receivers, names, type] = this.pick(kinds);
      const id = `${number}_${index}`;
      const name = this.pick(names);
      const written = JSON.stringify(name);
      const key = `key${id}`;
      this.emit(
        1,
        this.pick([
          `const ${key} = ${written};`,
          `const ${key} = ${written};`,
          `const ${key} = ${written};`,
          `let ${key} = ${written};`,
          `var ${key} = ${written};`,
          `const ${key}${this.typed("string")} = ${written};`,
          `const ${key} = ${written}${this.isTypeScript ? " as const" : ""};`,
          `const ${key} = [${written}, "other"][0];`,
          `const ${key} = ${JSON.stringify(name.slice(0, 1))} + ${JSON.stringify(name.slice(1))};`,
          `const { ${key} } = { ${key}: ${written} };`,
          ...(/^-?\d+$/.test(name) ? [`const ${key} = ${name};`, `let ${key}${this.typed("number")} = ${name};`] : []),
        ]),
      );
      // Written in place, held in a variable, or what a call returns.
      const original = this.pick(receivers);
      // In three of ten, a copy of it, or an object that inherits from it. What a function, a list or a text has by itself is copied like any other property.
      const literal = this.plainly(70, original, () =>
        this.pick([
          `Object.defineProperties({}, Object.getOwnPropertyDescriptors(${original}))`,
          `Object.defineProperties({}, Object.getOwnPropertyDescriptors(${original}))`,
          `Object.create(Object.getPrototypeOf(${original}), Object.getOwnPropertyDescriptors(${original}))`,
          `Object.defineProperty({}, ${written}, Object.getOwnPropertyDescriptor(${original}, ${written}) ?? { value: "none" })`,
          `Object.fromEntries(Reflect.ownKeys(Object(${original})).map(own => [own, (${original})[own]]))`,
          `Object.assign({}, ${original})`,
          `{ ...(${original}) }`,
          `Object.create(Object(${original}))`,
          `Object.setPrototypeOf({}, Object(${original}))`,
        ]),
      );
      const declared = this.chance(50) ? this.typed(type) : "";
      const receiver = this.pick([
        () => `(${literal})`,
        () => `(${literal})`,
        () => (this.emit(1, `const held${id}${declared} = ${literal};`), `held${id}`),
        () => (this.emit(1, `function make${id}()${declared} { return ${literal}; }`), `make${id}()`),
        () => (this.emit(1, `const make${id} = () => (${literal});`), `make${id}()`),
      ])();
      const read = this.pick([
        `${receiver}[${key}]`,
        `${receiver}[${key}]`,
        `${receiver}[${key}]`,
        `${receiver}[${written}]`,
        /^[a-z]\w*$/i.test(name) ? `${receiver}.${name}` : `${receiver}[${name}]`,
      ]);
      const place = this.typed(this.pick(["number", "string", "any", "unknown", "number | undefined"]));
      const stored = this.pick(["0", "1", "2", "-1", "1.5", `"text"`, "undefined", "4294967296"]);
      const statement = this.pick([
        `note([${read}]);`,
        `note([${read}]);`,
        `note([${read}]);`,
        `note([${read}, ${read}]);`,
        `note([0, ${read}, "end"]);`,
        `note([...[${read}]]);`,
        `note({ held: ${read} }.held);`,
        `note({ ${written}: ${read} }[${key}]);`,
        `{ const placed${place} = ${read}; note(placed); }`,
        `{ const placed${this.typed("number[]")} = [${read}]; note(placed); note(placed.length); }`,
        `{ const [placed] = [${read}]; note(placed); }`,
        `note(${read});`,
        `note(typeof ${read});`,
        `note(${read} + 1);`,
        `note(${read} ? "yes" : "no");`,
        `note(${key} in Object(${receiver}));`,
        `note((function ()${any} { return [${read}]; })());`,
        `note([1, 2].map(() => ${read}));`,
        `for (let turn = 0; turn < 3; turn++) note([${read}]);`,
        // The constructor of a function makes a function out of a text, which an executable can refuse.
        ...(name === "constructor" ? [] : [`note([${read}?.(0)]);`]),
        ...(namesOfFunctions.includes(name)
          ? []
          : [
              `printValue([${read}]);`,
              `printValue([${read}]);`,
              `printValue({ ${written}: ${read} });`,
              `printValue({ ${written}: ${read} });`,
              `printValue({ first: 1, ${written}: ${read}, last: "l" });`,
              `{ const holder = { ${written}: ${read} }; note(holder[${key}]); printValue(holder); }`,
            ]),
        // A store to a built-in is refused in an executable.
        ...(/^(?:Math\.max|Array)$/.test(literal)
          ? []
          : [
              `{ const target${any} = ${receiver}; target[${key}] = ${stored}; note([target[${key}]]); note(target); }`,
              `{ const target${any} = ${receiver}; target[${key}] = ${stored}; note([target[${key}]]); note(target); }`,
              `{ const target${any} = ${receiver}; target[${key}]++; note([target[${key}]]); }`,
              `{ const target${any} = ${receiver}; target[${key}] += 1; note([target[${key}]]); note(target); }`,
              `{ const target${any} = ${receiver}; note(delete target[${key}]); note([target[${key}]]); }`,
            ]),
      ]);
      this.emit(1, `try { ${statement} } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`);
    }
    this.emit(1, `printValue("keys ${number}", out);`);
    this.lines.push("}");
  }

  /** Values of each kind with their types. The first twelve are numbers. */
  readonly everyValue: [text: string, type: string][] = [
    ["0", "number"],
    ["1", "number"],
    ["-1", "number"],
    ["-0", "number"],
    ["1.5", "number"],
    ["NaN", "number"],
    ["Infinity", "number"],
    ["31", "number"],
    ["2147483647", "number"],
    ["-2147483648", "number"],
    ["4294967295", "number"],
    ["9007199254740991", "number"],
    [`"text"`, "string"],
    [`""`, "string"],
    [`"3"`, "string"],
    ["undefined", "undefined"],
    ["null", "null"],
    ["true", "boolean"],
    ["false", "boolean"],
    ["10n", "bigint"],
    [`{ valueOf() { note("valueOf"); return 7; } }`, "object"],
    ["[2]", "number[]"],
    [`Symbol("s")`, "symbol"],
  ];

  /** An assignment operator on a place of each kind, with values of each kind on both sides. What the expression gives and what the place holds behind it are printed. */
  sceneOfAssignmentsToPlaces() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function show(value${any})${this.typed("string")} { return typeof value === "function" ? "function " + value.name : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : Object.is(value, -0) ? "number -0" : typeof value + " " + String(value); }`,
      `function note(value${any})${this.typed("void")} { out += show(value) + ";"; }`,
    );
    const value = () => (this.chance(60) ? this.pick(this.everyValue.slice(0, 12)) : this.pick(this.everyValue));
    for (let index = this.pick([2, 3, 4, 6, 8]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [first, type] = value();
      const [second] = value();
      const declared = this.plainly(50, "", () => this.typed(this.pick([type, type, "any", "number", "unknown"])));
      const whole = (body: string) => body;
      // What is declared in front, how the place is written, whether it is a member, and what stands around the code that uses it.
      const [before, place, isMember, around] = this.pick<() => [string[], string, boolean, (body: string) => string]>([
        () => [[`let p${id}${declared} = ${first};`], `p${id}`, false, whole],
        () => [[`let p${id}${declared} = ${first};`], `p${id}`, false, whole],
        () => [[`var p${id}${declared} = ${first};`], `p${id}`, false, whole],
        () => [[`const o${id} = { p: ${first} };`], `o${id}.p`, true, whole],
        () => [
          [`const o${id}${this.typed(`{ p${this.chance(50) ? "?" : ""}: ${type} }`)} = { p: ${first} };`],
          `o${id}.p`,
          true,
          whole,
        ],
        () => [[`const o${id}${any} = { p: ${first} };`, `const k${id} = "p";`], `o${id}[k${id}]`, true, whole],
        () => [[`const o${id}${any} = {};`], `o${id}.p`, true, whole],
        () => [[`const o${id}${any} = Object.create({ p: ${first} });`], `o${id}.p`, true, whole],
        () => [[`const o${id}${any} = Object.freeze({ p: ${first} });`], `o${id}.p`, true, whole],
        () => [
          [
            `const o${id}${any} = { held: ${first}, get p() { note("get"); return this.held; }, set p(given) { note("set"); this.held = given; } };`,
          ],
          `o${id}.p`,
          true,
          whole,
        ],
        () => [[`class C${id} { p${declared} = ${first}; }`, `const o${id} = new C${id}();`], `o${id}.p`, true, whole],
        () => [[`class C${id} { static p${declared} = ${first}; }`], `C${id}.p`, true, whole],
        () => [
          [],
          `this.#p`,
          false,
          body =>
            `class C${id} { #p${declared} = ${first}; run()${this.typed("void")} { ${body} } } new C${id}().run();`,
        ],
        () => [[`const a${id}${any} = [${first}, ${first}];`], `a${id}[${this.pick(["0", "1", "2"])}]`, true, whole],
        () => [[`const a${id} = [${first}];`, `const i${id} = 0;`], `a${id}[i${id}]`, true, whole],
        () => [[`const a${id}${any} = [1, 2, 3];`], `a${id}.length`, true, whole],
        () => [
          [
            `const a${id} = new ${this.pick(["Int32Array", "Float64Array", "Uint8Array", "Uint8ClampedArray", "Float32Array", "Int8Array", "Uint32Array"])}(2);`,
            `try { a${id}[0] = ${first}${asAny}; } catch {}`,
          ],
          `a${id}[${this.pick(["0", "0", "1", "2"])}]`,
          true,
          whole,
        ],
        () => [[], `p`, false, body => `(function (p${declared})${this.typed("void")} { ${body} })(${first});`],
        () => [[], `p`, false, body => `((p${declared})${this.typed("void")} => { ${body} })(${first});`],
        () => [
          [],
          `arguments[0]`,
          true,
          body => `(function (p${any})${this.typed("void")} { ${body} note(p); })(${first});`,
        ],
      ])();
      const operator = this.pick([
        ...["=", "+=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^="],
        ...["&&=", "||=", "??="],
      ]);
      const changed = this.pick([
        `${place} ${operator} ${second}`,
        `${place} ${operator} ${second}`,
        `${place} ${operator} ${second}`,
        `${place} ${operator} ${second}`,
        `${place}++`,
        `++${place}`,
        `${place}--`,
        `--${place}`,
        `[${place}] = [${second}]`,
        `[${place} = ${second}] = []`,
        `{ a: ${place} } = { a: ${second} }`,
        ...(isMember ? [`delete ${place}`] : []),
      ]);
      const expression = `(${changed})`;
      const statement = this.pick([
        `note(${expression}); note(${place});`,
        `note(${expression}); note(${place});`,
        `note([${expression}, ${place}]);`,
        `note([${place}, ${expression}, ${place}]);`,
        `${expression}; note(${place});`,
        `{ const kept${any} = ${expression}; note(kept); note(${place}); }`,
        `{ const kept${this.typed("number")} = ${expression}; note(kept + 1); note(${place}); }`,
        `for (let turn = 0; turn < 3; turn++) { ${expression}; } note(${place});`,
        `{ const change = ()${any} => ${expression}; note(change()); note(change()); note(${place}); }`,
        `note(typeof ${expression}); note(typeof ${place});`,
        `if (${expression}) note("yes"); else note("no"); note(${place});`,
        `note({ result: ${expression}, place: ${place} }.place);`,
      ]);
      this.emit(1, ...before);
      this.emit(
        1,
        around(`try { ${statement} } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`),
      );
    }
    this.emit(1, `printValue("places ${number}", out);`);
    this.lines.push("}");
  }

  /** An operator, a conversion or a function of Math on two values of each kind. Each operand is written in place, held in a variable, a field or an element, handed in as an argument, or what a call returns. */
  sceneOfOperatorsOnPairs() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function show(value${any})${this.typed("string")} { return typeof value === "function" ? "function " + value.name : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : Object.is(value, -0) ? "number -0" : typeof value + " " + String(value); }`,
      `function note(value${any})${this.typed("void")} { out += show(value) + ";"; }`,
    );
    const value = () => (this.chance(65) ? this.pick(this.everyValue.slice(0, 12)) : this.pick(this.everyValue));
    for (let index = this.pick([3, 4, 6, 8, 10]); index > 0; index--) {
      const id = `${number}_${index}`;
      const pair = [value(), value()];
      const parameters: string[] = [];
      const given: string[] = [];
      const [a, b] = pair.map(([text, type], side) => {
        const name = `${"ab"[side]}${id}`;
        const declared = this.plainly(40, "", () => this.typed(this.pick([type, type, "any", "number", "unknown"])));
        return this.pick([
          () => `(${text})`,
          () => `(${text})`,
          () => (this.emit(1, `const ${name}${declared} = ${text};`), name),
          () => (this.emit(1, `let ${name}${declared} = ${text};`), name),
          () => (this.emit(1, `const ${name} = { held: ${text} };`), `${name}.held`),
          () => (this.emit(1, `const ${name} = [${text}];`), `${name}[0]`),
          () => (this.emit(1, `const ${name} = ()${declared} => (${text});`), `${name}()`),
          () => (parameters.push(name + declared), given.push(text), name),
          () => (parameters.push(name + declared), given.push(text), name),
        ])();
      });
      const binary = this.pick([
        ...["+", "+", "-", "*", "/", "%", "%", "**", "&", "|", "^", "<<", ">>", ">>>"],
        ...["==", "!=", "===", "!==", "<", "<=", ">", ">=", "&&", "||", "??"],
      ]);
      const expression = this.pick([
        `${a} ${binary} ${b}`,
        `${a} ${binary} ${b}`,
        `${a} ${binary} ${b}`,
        `${a} ${binary} ${b}`,
        `(${a} ${binary} ${b}) ${this.pick(["| 0", ">>> 0", "+ 1", "* 1", `+ ""`, "=== 0"])}`,
        `${this.pick(["-", "+", "~", "!", "typeof ", "void "])}${a}`,
        `-(${a} ${this.pick(["*", "%", "/", "-"])} ${b})`,
        `Math.${this.pick(["floor", "ceil", "round", "trunc", "sign", "abs", "sqrt", "fround", "clz32", "cbrt", "log2"])}(${a})`,
        `Math.${this.pick(["min", "max", "pow", "imul", "atan2", "hypot"])}(${a}, ${b})`,
        `${this.pick(["Number", "String", "Boolean", "parseInt", "parseFloat", "BigInt", "Object", "Number.isInteger", "Number.isSafeInteger", "isNaN", "isFinite"])}(${a})`,
        `\`\${${a}}|\${${b}}\``,
        `${a} ? ${b} : ${a}`,
        `Object.is(${a}, ${b})`,
        `[${a}, ${b}].${this.pick(["includes", "indexOf", "lastIndexOf"])}(${b})`,
        `new Set([${a}, ${b}]).size`,
        `JSON.stringify([${a}, ${b}])`,
        `[${a}, ${b}].sort()`,
        `[${a}, ${b}].join()`,
        `(${a}${asAny})?.toString?.(${this.pick(["", "", "2", "16", "36"])})`,
        `(${a}${asAny})?.${this.pick(["toFixed", "toPrecision", "toExponential"])}?.(${this.pick(["1", "2", "0", "20"])})`,
      ]);
      const statement = this.pick([
        `note(${expression});`,
        `note(${expression});`,
        `note(${expression});`,
        `note([${expression}]);`,
        `{ const kept${this.typed(this.pick(["number", "any", "unknown", "string", "boolean"]))} = ${expression}; note(kept); }`,
        `if (${expression}) note("yes"); else note("no");`,
        `switch (${a}) { case ${b}: note("case"); break; default: note("default"); }`,
        `for (let turn = 0; turn < 3; turn++) note(${expression});`,
        `{ let sum${any} = 0; for (let turn = 0; turn < 3; turn++) sum += ${expression}; note(sum); }`,
      ]);
      const guarded = `try { ${statement} } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
      if (parameters.length === 0) this.emit(1, guarded);
      else {
        this.emit(1, `function run${id}(${parameters.join(", ")})${this.typed("void")} { ${guarded} }`);
        // Once with the pair, or also with values of other kinds, before or behind it.
        const others = () => given.map(() => value()[0]).join(", ");
        this.emit(
          1,
          this.pick([
            `run${id}(${given.join(", ")});`,
            `run${id}(${given.join(", ")});`,
            `run${id}(${given.join(", ")}); run${id}(${given.join(", ")});`,
            `run${id}(${others()}); run${id}(${given.join(", ")});`,
            `run${id}(${given.join(", ")}); run${id}(${others()}); run${id}(${given.join(", ")});`,
          ]),
        );
      }
    }
    this.emit(1, `printValue("pairs ${number}", out);`);
    this.lines.push("}");
  }

  /** A callee of each kind with parameters of each form, called in each way with too few, enough and too many arguments, some of them spread. */
  sceneOfCalls() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function show(value${any})${this.typed("string")} { return typeof value === "function" ? "function " + value.name : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : Object.is(value, -0) ? "number -0" : typeof value + " " + String(value); }`,
      `function note(value${any})${this.typed("void")} { out += show(value) + ";"; }`,
    );
    const value = () => (this.chance(60) ? this.pick(this.everyValue.slice(0, 12)) : this.pick(this.everyValue))[0];
    const given = () => {
      const [a, b, c] = [value(), value(), value()];
      return this.pick([
        ``,
        `${a}`,
        `${a}, ${b}`,
        `${a}, ${b}`,
        `${a}, ${b}, ${c}`,
        `...[${a}, ${b}]`,
        `${a}, ...[${b}, ${c}]`,
        `...[]`,
        `...[${a}], ...[${b}]`,
        `..."ab"`,
        `...new Set([${a}, ${b}])`,
        `undefined, ${b}`,
        `...[, ${b}]`,
        `{ x: ${a}, y: ${b} }`,
        `{ x: undefined, z: ${b} }, ${c}`,
        `[${a}, ${b}]`,
        `[${a}, undefined, ${b}, ${c}]`,
        `null`,
      ]);
    };
    for (let index = this.pick([2, 3, 4, 6, 8]); index > 0; index--) {
      const id = `${number}_${index}`;
      // The parameters, what the callee gives back, and whether that names `this` or `arguments`.
      const [parameters, result, needsAFunction] = this.pick<[string, string, boolean]>([
        ["a, b", "[a, b]", false],
        ["a, b", "[a, b]", false],
        ["a, b = a", "[a, b]", false],
        ["a = 1, b = 2", "[a, b]", false],
        ["a, b = () => a", `[a, typeof b === "function" ? b() : b]`, false],
        ["...rest", "[rest.length, rest]", false],
        ["a, ...rest", "[a, rest.length, rest]", false],
        ["{ x, y }", "[x, y]", false],
        ["{ x = 1, ...others } = {}", "[x, Object.keys(others).join()]", false],
        ["[x, y = 5, ...z] = []", "[x, y, z]", false],
        ["a, { x } = { x: a }, b = x", "[a, x, b]", false],
        ["a, b", "[arguments.length, a, b]", true],
        ["a, b", "[typeof this, a]", true],
        ["a", "((a = 9), [arguments[0], arguments.length, a])", true],
        ["a, b", "[new.target === undefined, a]", true],
      ]);
      const body = `{ return ${result}; }`;
      // What is declared, and how a call with the arguments is written.
      const [declared, call] = this.pick<() => [string, (list: string) => string]>([
        () => [`function f${id}(${parameters})${any} ${body}`, list => `f${id}(${list})`],
        () => [`function f${id}(${parameters})${any} ${body}`, list => `f${id}(${list})`],
        () => [`const f${id} = function (${parameters})${any} ${body};`, list => `f${id}(${list})`],
        () =>
          needsAFunction
            ? [`function f${id}(${parameters})${any} ${body}`, list => `f${id}?.(${list})`]
            : [`const f${id} = (${parameters})${any} => ${result};`, list => `f${id}(${list})`],
        () => [
          `function f${id}(${parameters})${any} ${body}`,
          list => `f${id}.call(${this.pick(["undefined", "null", "1", "{}"])}${list && ", " + list})`,
        ],
        () => [`function f${id}(${parameters})${any} ${body}`, list => `f${id}.apply(undefined, [${list}])`],
        () => [`function f${id}(${parameters})${any} ${body}`, list => `Reflect.apply(f${id}, undefined, [${list}])`],
        () => [`function f${id}(${parameters})${any} ${body}`, list => `f${id}.bind(null)(${list})`],
        () => [`function f${id}(${parameters})${any} ${body}`, list => `f${id}.bind(null, ${value()})(${list})`],
        () => [`function f${id}(${parameters})${any} ${body}`, list => `[${list}].map(f${id})`],
        () => [`function f${id}(${parameters})${any} ${body}`, list => `[${list}].reduce(f${id}, ${value()})`],
        () => [`function f${id}(${parameters})${any} ${body}`, () => `f${id}\`x\${${value()}}y\${${value()}}\``],
        () => [`function* f${id}(${parameters})${any} { yield ${result}; }`, list => `f${id}(${list}).next().value`],
        () => [`const o${id}${any} = { m(${parameters})${any} ${body} };`, list => `o${id}.m(${list})`],
        () => [`const o${id}${any} = { m(${parameters})${any} ${body} };`, list => `o${id}["m"](${list})`],
        () => [`const o${id}${any} = { m(${parameters})${any} ${body} };`, list => `o${id}?.m?.(${list})`],
        () => [`const o${id}${any} = { m(${parameters})${any} ${body} };`, list => `(0, o${id}.m)(${list})`],
        () => [`const { m: m${id} }${any} = { m(${parameters})${any} ${body} };`, list => `m${id}(${list})`],
        () => [
          `const o${id}${any} = { get m() { note("get"); return function (${parameters})${any} ${body}; } };`,
          list => `o${id}.m(${list})`,
        ],
        () => [`class C${id} { m(${parameters})${any} ${body} }`, list => `new C${id}().m(${list})`],
        () => [`class C${id} { static m(${parameters})${any} ${body} }`, list => `C${id}.m(${list})`],
        () => [
          `class C${id} { #m(${parameters})${any} ${body} run(...all${this.typed("any[]")})${any} { return this.#m(...all); } }`,
          list => `new C${id}().run(${list})`,
        ],
        () => [
          `class C${id} { kept${any}; constructor(${parameters}) { this.kept = ${result}; } }`,
          list => `new C${id}(${list}).kept`,
        ],
        () => [
          `function F${id}(${this.isTypeScript ? "this: any, " : ""}${parameters}) { this.kept = ${result}; }`,
          list => `new (F${id}${asAny})(${list}).kept`,
        ],
        () => [
          `function F${id}(${this.isTypeScript ? "this: any, " : ""}${parameters}) { this.kept = ${result}; }`,
          list => `Reflect.construct(F${id}, [${list}]).kept`,
        ],
        () => [
          `class C${id} { kept${any}; constructor(${parameters}) { this.kept = ${result}; } } class D${id} extends C${id} {}`,
          list => `new D${id}(${list}).kept`,
        ],
        () => [
          `class C${id} { kept${any}; constructor(${parameters}) { this.kept = ${result}; } } class D${id} extends C${id} { constructor(...all${this.typed("any[]")}) { super(...all); } }`,
          list => `new D${id}(${list}).kept`,
        ],
      ])();
      this.emit(1, declared);
      const statement = this.pick([
        `note(${call(given())});`,
        `note(${call(given())});`,
        `note(${call(given())}); note(${call(given())});`,
        `note(${call(given())}); note(${call(given())}); note(${call(given())});`,
        `for (let turn = 0; turn < 3; turn++) note(${call(given())});`,
        `{ const [first, second] = ${call(given())}; note(first); note(second); }`,
        `note([...${call(given())}]);`,
        `note(${call(given())}?.length);`,
      ]);
      this.emit(1, `try { ${statement} } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`);
    }
    this.emit(1, `printValue("calls ${number}", out);`);
    this.lines.push("}");
  }

  /** The functions that the language brings under a name, as they are written. Left out: what answers otherwise from run to run, waits, makes code out of a text or leaves a rejected promise behind. */
  static builtInFunctions = [
    ...["Object", "Array", "String", "Number", "BigInt", "Symbol", "Math", "JSON", "Reflect", "Proxy", "Map", "Date"],
    ...["RegExp", "Error", "ArrayBuffer", "Uint8Array", "Float64Array", "Iterator", "Atomics", "Promise"],
  ]
    .flatMap(holder =>
      Object.entries(Object.getOwnPropertyDescriptors((globalThis as any)[holder] ?? {}))
        .filter(([name, { value }]) => typeof value === "function" && /^[a-z]\w*$/i.test(name))
        .map(([name]) => `${holder}.${name}`),
    )
    .filter(
      written =>
        !/^(?:Math\.random|Date\.now|Atomics\.(?:wait|waitAsync|pause)|Array\.fromAsync|Error\.captureStackTrace)$/.test(
          written,
        ) &&
        (!written.startsWith("Promise.") || written === "Promise.resolve"),
    )
    .concat(
      ...["Object", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Error", "RegExp"],
      ...[
        "parseInt",
        "parseFloat",
        "isNaN",
        "isFinite",
        "encodeURIComponent",
        "decodeURIComponent",
        "escape",
        "unescape",
      ],
    )
    .sort();
  /** Methods of prototypes, which take their receiver through `call`. */
  static builtInMethods = ["Object", "Array", "String", "Number", "Map", "Set", "RegExp", "Function", "Uint8Array"]
    .flatMap(holder =>
      Object.entries(Object.getOwnPropertyDescriptors((globalThis as any)[holder].prototype))
        .filter(
          ([name, { value }]) => typeof value === "function" && /^[a-z]\w*$/i.test(name) && name !== "constructor",
        )
        .map(([name]) => `${holder}.prototype.${name}`),
    )
    .filter(written => !/\.(?:toLocale\w+|localeCompare|normalize|compile|toString|toSource)$/.test(written))
    .sort();

  /** One call site whose callee is one built-in function and then another, which arrive as values. Their results can be of different kinds. */
  sceneOfBuiltInCallees() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function show(value${any})${this.typed("string")} { return typeof value === "function" ? "function " + value.name : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : Object.is(value, -0) ? "number -0" : typeof value + " " + String(value); }`,
      `function note(value${any})${this.typed("void")} { out += show(value) + ";"; }`,
    );
    const operand = () =>
      this.chance(70)
        ? this.pick([
            "{}",
            "{}",
            "[]",
            "[1, 2]",
            `"ab"`,
            "1",
            "{ a: 1 }",
            "() => 1",
            "[[1, 2]]",
            `["a", "b"]`,
            "2",
            "0",
          ])
        : this.pick(this.everyValue)[0];
    let waits = false;
    for (let index = this.pick([2, 3, 4, 6]); index > 0; index--) {
      const id = `${number}_${index}`;
      if (this.chance(30)) {
        // Native code calls the built-in, with operands at which many of them throw, and a handler looks at what was thrown.
        const handed = this.pick(Scenes.builtInFunctions);
        const operand = () =>
          this.chance(60)
            ? this.pick([
                "Symbol.iterator",
                `Symbol("s")`,
                "10n",
                "null",
                "undefined",
                `{ valueOf() { throw new RangeError("v"); } }`,
                `{ toString() { throw new RangeError("t"); } }`,
                "Object.create(null)",
                `new Proxy({}, { get() { throw new EvalError("p"); } })`,
              ])
            : this.pick(this.everyValue)[0];
        const [a, b] = [operand(), operand()];
        const seen = `(error${any}) => note("rejected " + (error${asAny})?.constructor?.name + " " + (error === undefined) + " " + typeof error)`;
        const later = this.chance(35);
        waits ||= later;
        const statement = later
          ? this.pick([
              `Promise.resolve(${a}).then(${handed}${asAny}).then(note, ${seen});`,
              `Promise.resolve(${a}).then(${handed}${asAny}).catch(${seen});`,
              `Promise.reject(${a}).catch(${handed}${asAny}).then(note, ${seen});`,
              `Promise.resolve(${a}).finally(${handed}${asAny}).then(note, ${seen});`,
              `new Promise(${handed}${asAny}).then(note, ${seen}); note("made");`,
              `(async () => ${handed}(${a}${asAny}))().then(note, ${seen});`,
            ])
          : this.pick([
              `note([${a}, ${b}].map(${handed}${asAny}));`,
              `note([${a}, ${b}].map(${handed}${asAny}));`,
              `note(Array.from([${a}], ${handed}${asAny}));`,
              `note([${a}, ${b}].sort(${handed}${asAny}));`,
              `note([${a}, ${b}].reduce(${handed}${asAny}));`,
              `note([${a}, ${b}].${this.pick(["find", "filter", "some", "every", "flatMap", "findLast", "forEach"])}(${handed}${asAny}));`,
              `note("ab".replace(/a/, ${handed}${asAny}));`,
              `note(JSON.stringify([${a}], ${handed}${asAny}));`,
              `note(JSON.parse("[1, 2]", ${handed}${asAny}));`,
              `new Map([[${a}, ${b}]]${asAny}).forEach(${handed}${asAny}); note("walked");`,
              `note(Reflect.apply(${handed}, ${a}, [${b}]));`,
              `note(new Uint8Array([1, 2]).map(${handed}${asAny}));`,
            ]);
        this.emit(
          1,
          `try { ${statement} } catch (error) { note("threw " + (error${asAny})?.constructor?.name + " " + (error === undefined) + " " + typeof error); }`,
        );
        continue;
      }
      const areMethods = this.chance(25);
      const callees = this.several(2, 3, () => this.pick(areMethods ? Scenes.builtInMethods : Scenes.builtInFunctions));
      // Two objects are arguments that many of them take. A call that throws says little about its result.
      const list = this.plainly(40, "{}, {}", () => this.several(0, 3, operand).join(", "));
      const called = (callee: string) =>
        areMethods ? `${callee}.call(${[operand(), list].filter(Boolean).join(", ")})` : `${callee}(${list})`;
      const used = (result: string) =>
        this.pick([
          `${result}.length`,
          `${result}.length`,
          `${result}.length`,
          `${result}.length`,
          `${result}?.length`,
          `${result}`,
          `${result}`,
          `typeof ${result}`,
          `[${result}]`,
          `${result} + 1`,
          `String(${result})`,
          `${result}?.constructor?.name`,
          `Object.keys(Object(${result})).length`,
          `${result} === undefined`,
          `Array.isArray(${result})`,
          `{ held: ${result} }.held`,
          `${result}?.[0]`,
          `JSON.stringify(${result})`,
          `[...${result}]`,
          `${result} instanceof Object`,
          `${result} ? "yes" : "no"`,
          `${result}.size`,
          `${result}.proxy`,
          `${result}.name`,
        ]);
      const [first, second] = callees;
      const all = callees.join(", ");
      const guarded = (statement: string) =>
        `try { ${statement} } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
      // How the callee arrives at the one place that calls it.
      this.emit(
        1,
        ...this.pick<() => string[]>([
          () => [
            `function g${id}(f${any})${any} { return ${used(called("f"))}; }`,
            ...callees.map(callee => guarded(`note(g${id}(${callee}));`)),
          ],
          () => [
            `function g${id}(f${any})${any} { return ${used(called("f"))}; }`,
            guarded(`printValue(${callees.map(callee => `show(g${id}(${callee}))`).join(", ")});`),
          ],
          () => [
            `const g${id} = (f${any})${any} => ${used(called("f")).replace(/^\{.*$/, "($&)")};`,
            guarded(`note([${all}].map(g${id}));`),
          ],
          () => [
            `for (let turn = 0; turn < 4; turn++) { const f${any} = turn % 2 ? ${first} : ${second}; ${guarded(`note(${used(called("f"))});`)} }`,
          ],
          () => [
            `const table${id}${any} = [${all}];`,
            `for (const at of [0, 1, 0, 1]) { ${guarded(`note(${used(called(`table${id}[at]`))});`)} }`,
          ],
          () => [
            `const table${id}${any} = { one: ${first}, other: ${second} };`,
            `for (const key of ["one", "other", "one"]) { ${guarded(`note(${used(called(`table${id}[key]`))});`)} }`,
          ],
          () => [`for (const f of [${all}]${asAny}) { ${guarded(`note(${used(called("f"))});`)} }`],
          () => [
            `const holder${id}${any} = { f: ${first} };`,
            `function run${id}()${any} { return ${used(called(`holder${id}.f`))}; }`,
            guarded(`note(run${id}());`),
            `holder${id}.f = ${second};`,
            guarded(`note(run${id}());`),
          ],
          () => [
            `let f${id}${any} = ${first};`,
            `const run${id} = ()${any} => ${used(called(`f${id}`)).replace(/^\{.*$/, "($&)")};`,
            guarded(`note(run${id}());`),
            `f${id} = ${second};`,
            guarded(`note(run${id}());`),
          ],
          () => [
            `function g${id}(f${any} = ${first})${any} { return ${used(called("f"))}; }`,
            guarded(`note(g${id}());`),
            guarded(`note(g${id}(${second}));`),
          ],
        ])(),
      );
    }
    if (waits) this.emit(1, `await new Promise(resolve => setTimeout(resolve, 1));`);
    this.emit(1, `printValue("callees ${number}", out);`);
    this.lines.push("}");
  }

  /** One place that reads a member, calls a method or constructs, reached by receivers or classes of several kinds that all have the name. */
  sceneOfOnePlaceForSeveralKinds() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function show(value${any})${this.typed("string")} { return typeof value === "function" ? "function " + value.name : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : Object.is(value, -0) ? "number -0" : typeof value + " " + String(value); }`,
      `function note(value${any})${this.typed("void")} { out += show(value) + ";"; }`,
    );
    const [list, floats, text, bytes, doubles] = [
      "[1, 2, 3]",
      "[1.5, 2.5]",
      `"abc"`,
      "new Uint8Array([1, 2, 3])",
      "new Float64Array([1.5, 2.5])",
    ];
    const [map, set, buffer] = ["new Map([[1, 2]])", "new Set([1, 2])", "new ArrayBuffer(4)"];
    // What is done with `o`, and who has that name.
    const places: [use: string, receivers: string[]][] = [
      [
        "o.length",
        [list, floats, "[]", text, bytes, doubles, "function (a, b) {}", "{ length: 7 }", `["a"]`, "new Array(5)"],
      ],
      ["o.size", [map, set, "{ size: 7 }", "new Map()"]],
      ["o.byteLength", [buffer, bytes, doubles, "new DataView(new ArrayBuffer(8), 2)", "{ byteLength: 7 }"]],
      [
        "o.name",
        [`new Error("m")`, "function named() {}", "class Named {}", `{ name: "own" }`, "Math.max", "new RangeError()"],
      ],
      ["o[0]", [list, floats, text, bytes, doubles, `{ 0: "own" }`, "[]", "[[1]]", "[, 1]"]],
      ["o[1]", [list, floats, text, bytes, doubles, "[1]", "[, 1]"]],
      ["o.slice(1)", [list, floats, text, bytes, buffer, "{ slice(from) { return from; } }"]],
      [`o.at(${this.pick(["0", "-1", "5"])})`, [list, floats, text, bytes, doubles, "[]"]],
      [
        `o.${this.pick(["indexOf", "includes", "lastIndexOf"])}(${this.pick(["2", "2.5", `"b"`, "NaN"])})`,
        [list, floats, text, bytes, doubles, "[NaN]"],
      ],
      [`o.concat(${this.pick(["[4]", `"d"`, "4"])})`, [list, floats, text, "[]"]],
      [`o.${this.pick(["keys", "values", "entries"])}().next().value`, [list, floats, bytes, map, set, "[]"]],
      ["[...o]", [list, floats, text, bytes, map, set, "[1, 2].values()", "(function* () { yield 1; })()"]],
      ["o.has(1)", [map, set, "new WeakSet()", "new WeakMap()", "{ has(key) { return key; } }"]],
      ["o.get(1)", [map, "new WeakMap()", "new Map()", "{ get(key) { return key; } }"]],
      ["o.forEach((each, key) => note(key))", [list, floats, bytes, map, set]],
      [
        "o.toString()",
        [list, floats, text, "12", "1.5", "true", `Symbol("s")`, `new Error("m")`, "/a/g", "{}", bytes, "10n"],
      ],
      ["o.valueOf()", [list, text, "12", "true", `Symbol("s")`, "{}", "10n", "new Number(3)", `new String("s")`, map]],
      ["o.join()", [list, floats, bytes, doubles, "[[1], [2]]", "[null, undefined]"]],
      ["o.fill(0)", [list, floats, bytes, doubles, "new Array(2)"]],
      [
        `o.${this.pick(["reverse", "sort", "toSorted", "toReversed"])}()`,
        [list, floats, bytes, doubles, `["b", "a"]`, "[3, 10, 2]"],
      ],
      ["o.with(0, 9)", [list, floats, bytes, doubles]],
      [`o.${this.pick(["map", "filter"])}(each => each > 1)`, [list, floats, bytes, doubles, "[1, 2].values()"]],
      [
        `o.${this.pick(["find", "some", "every"])}(each => each > 1)`,
        [list, floats, bytes, doubles, "[1, 2].values()", "[]"],
      ],
      ["o.reduce((sum, each) => sum + each, 0)", [list, floats, bytes, doubles, "[1, 2].values()", `["a"]`]],
      ["o.add(3).size", [set, "new Set()", "{ add() { return { size: 7 }; } }"]],
      ["o.set(3, 4)", [map, bytes, "new WeakMap()", "{ set() { return 7; } }"]],
      ["o.delete(1)", [map, set, "new WeakSet()", "new WeakMap()"]],
      [
        "o.next().value",
        [
          "[1].values()",
          "(function* () { yield 1; })()",
          "{ next() { return { value: 7 }; } }",
          `"a"[Symbol.iterator]()`,
          "new Map([[1, 2]]).keys()",
        ],
      ],
      [`o.test("a")`, ["/a/", "/b/g", "{ test(given) { return given; } }"]],
      [
        "o.constructor.name",
        [list, text, bytes, map, set, "{}", "12", `new Error("m")`, "/a/", "() => 1", "class Named {}"],
      ],
      [
        "new o(2)",
        [
          "Array",
          "Uint8Array",
          "Float64Array",
          "String",
          "Number",
          "Object",
          "ArrayBuffer",
          "Error",
          "Boolean",
          "class Own { length = 7; }",
        ],
      ],
      [
        "new o(2).length",
        [
          "Array",
          "Uint8Array",
          "Float64Array",
          "String",
          "Object",
          "Error",
          "class Own { length = 7; }",
          "function Old() { this.length = 7; }",
        ],
      ],
      ["new o([[1, 2]]).size", ["Map", "Set", "class Own { size = 7; }"]],
      ["o(2)", ["Array", "String", "Number", "Object", "Boolean", "BigInt", "Symbol", "Error", "RegExp"]],
      ["o.of(1, 2)", ["Array", "Uint8Array", "Float64Array", "{ of() { return 7; } }"]],
      ["o.from([1, 2])", ["Array", "Uint8Array", "Float64Array", "Iterator", "{ from() { return 7; } }"]],
    ];
    for (let index = this.pick([2, 3, 4, 6]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [use, candidates] = this.pick(places);
      const receivers = this.several(2, 4, () => this.pick(candidates)).map(each => `(${each})`);
      const at = (receiver: string) => use.replace(/\bo\b/g, receiver);
      const used = (result: string) =>
        this.pick([
          result,
          result,
          result,
          `[${result}]`,
          `typeof ${result}`,
          `(${result}${asAny})?.length`,
          `(${result}${asAny}) + 1`,
          `Array.isArray(${result})`,
          `(${result}${asAny})?.[0]`,
          `{ held: ${result} }.held`,
          `(${result}${asAny}) instanceof Object`,
          `(${result}) ? "yes" : "no"`,
          `String(${result})`,
        ]);
      const guarded = (statement: string) =>
        `try { ${statement} } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
      const all = receivers.join(", ");
      const inParentheses = (written: string) => written.replace(/^\{.*$/, "($&)");
      this.emit(
        1,
        ...this.pick<() => string[]>([
          () => [
            `function g${id}(o${any})${any} { return ${used(at("o"))}; }`,
            ...receivers.map(each => guarded(`note(g${id}(${each}));`)),
          ],
          () => [
            `function g${id}(o${any})${any} { return ${used(at("o"))}; }`,
            ...receivers.map(each => guarded(`note(g${id}(${each}));`)),
          ],
          () => [
            `function g${id}(o${any})${any} { return ${used(at("o"))}; }`,
            `for (let turn = 0; turn < 3; turn++) { ${receivers.map(each => guarded(`note(g${id}(${each}));`)).join(" ")} }`,
          ],
          () => [
            `const g${id} = (o${any})${any} => ${inParentheses(used(at("o")))};`,
            guarded(`note([${all}].map(g${id}));`),
          ],
          () => [`for (const o of [${all}]${asAny}) { ${guarded(`note(${used(at("o"))});`)} }`],
          () => [
            `for (let turn = 0; turn < 4; turn++) { const o${any} = turn % 2 ? ${receivers[0]} : ${receivers[1]}; ${guarded(`note(${used(at("o"))});`)} }`,
          ],
          () => [
            `const table${id}${any} = [${all}];`,
            `for (const at of [0, 1, 0, 1]) { ${guarded(`note(${used(at(`table${id}[at]`))});`)} }`,
          ],
          () => [
            `const holder${id}${any} = { o: ${receivers[0]} };`,
            `function run${id}()${any} { return ${used(at(`holder${id}.o`))}; }`,
            guarded(`note(run${id}());`),
            `holder${id}.o = ${receivers[1]};`,
            guarded(`note(run${id}());`),
          ],
          () => [
            `let o${id}${any} = ${receivers[0]};`,
            `const run${id} = ()${any} => ${inParentheses(used(at(`o${id}`)))};`,
            guarded(`note(run${id}());`),
            `o${id} = ${receivers[1]};`,
            guarded(`note(run${id}());`),
          ],
        ])(),
      );
    }
    this.emit(1, `printValue("kinds ${number}", out);`);
    this.lines.push("}");
  }

  /** A name that no other scene and no other program of a build has. What the compiler knows about a name ends where any code deletes or redefines it. */
  nameOfItsOwn = (first: string) => first + Math.floor(this.random() * 36 ** 5).toString(36);

  /** A function makes an object, stores what it reads out of data of mixed kinds under a name, and asks the object for that name before the object leaves. */
  sceneOfPresenceBehindStores() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)) + ";"; }`,
    );
    for (let index = this.pick([1, 1, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [name, other] = [this.nameOfItsOwn("n"), this.nameOfItsOwn("m")];
      const held = () =>
        this.pick([
          `"x"`,
          "1",
          `"a"`,
          "1.5",
          "null",
          "true",
          "false",
          "0",
          `""`,
          "[1]",
          `{"k":1}`,
          "-1",
          "2147483648",
          "2",
        ]);
      const rows = this.several(3, 5, () =>
        this.chance(75) ? `{"id":${this.below(9)},"${name}":${held()}}` : `{"id":${this.below(9)}}`,
      );
      const text = `[${rows.join(",")}]`;
      const loose = this.plainly(50, "", () => any);
      this.emit(
        1,
        `const rows${id}${loose} = ${this.pick([
          `JSON.parse('${text}')`,
          `JSON.parse('${text}')`,
          `JSON.parse('${text}')`,
          `[...new Map(JSON.parse('${text}').map((row${any}, at${any}) => [at, row])).values()]`,
          `JSON.parse('${text}').map((row${any}) => Object.fromEntries(Object.entries(row)))`,
          `structuredClone(${text})`,
          text,
        ])};`,
      );
      const value = this.pick([
        `row.${name}`,
        `row.${name}`,
        `row.${name}`,
        `row.${name} + 1`,
        `row["${name}"]`,
        `-row.${name}`,
        `row.${name} || row.id`,
      ]);
      const store = this.pick([
        `o.${name} = ${value};`,
        `o.${name} = ${value};`,
        `o.${name} = ${value};`,
        `if (row.${name}) o.${name} = ${value};`,
        `if (row.${name}) o.${name} = ${value};`,
        `if (row.${name} !== undefined) o.${name} = ${value};`,
        `if ("${name}" in row) o.${name} = ${value};`,
        `o["${name}"] = ${value};`,
        `o.id = row.id; if (row.${name}) o.${name} = ${value};`,
        `o.${other} = 1; o.${name} = ${value};`,
        `Object.assign(o, { ${name}: ${value} });`,
        `Object.defineProperty(o, "${name}", { value: ${value}, enumerable: true, writable: true, configurable: true });`,
      ]);
      const asks = this.pick([
        `"${name}" in o`,
        `"${name}" in o`,
        `"${name}" in o`,
        `Object.hasOwn(o, "${name}")`,
        `Object.hasOwn(o, "${name}")`,
        `o.hasOwnProperty("${name}")`,
        `Object.prototype.hasOwnProperty.call(o, "${name}")`,
        `Reflect.has(o, "${name}")`,
        `Object.keys(o).includes("${name}")`,
        `Object.getOwnPropertyDescriptor(o, "${name}") !== undefined`,
        `o.${name} !== undefined`,
      ]);
      const end = this.pick([
        `if (!(${asks})) o.${name} = "default"; return o;`,
        `if (!(${asks})) o.${name} = "default"; return o;`,
        `return ${asks} ? o.${name} : "lost";`,
        `return ${asks} ? o.${name} : "lost";`,
        `return [${asks}, o.${name}];`,
        `if (${asks}) return o; return "none";`,
        `return (${asks}) && Object.keys(o).length;`,
        `const has = ${asks}; return has ? o : [has];`,
      ]);
      const made = this.pick([
        "{}",
        "{}",
        "{}",
        "{}",
        "Object.create(null)",
        "new Object()",
        "{ first: 1 }",
        "new (class {})()",
      ]);
      this.emit(1, `function make${id}(row${loose})${loose} { const o${loose} = ${made}; ${store} ${end} }`);
      const statement = this.pick([
        `note(rows${id}.map(make${id}));`,
        `note(rows${id}.map(make${id}));`,
        `rows${id}.forEach((row${any}) => note(make${id}(row)));`,
        `for (const row of rows${id}) note(make${id}(row));`,
        `for (let at = 0; at < rows${id}.length; at++) note(make${id}(rows${id}[at]));`,
        `{ const call = (row${any}) => make${id}(row); note(rows${id}.map(call)); }`,
        `note(rows${id}.map((row${any}) => ({ run() { return make${id}(row); } }).run()));`,
      ]);
      this.emit(1, `try { ${statement} } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`);
    }
    this.emit(1, `printValue("presence ${number}", out);`);
    this.lines.push("}");
  }

  /** An object literal with a spread and a member under a name that the spread object can have too, made in code that runs once or often. The member is deleted or stored to, and read. */
  sceneOfMembersOverSpreads() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value)) + ";"; }`,
    );
    for (let index = this.pick([1, 2, 2, 3, 4]); index > 0; index--) {
      const id = `${number}_${index}`;
      const key = this.nameOfItsOwn("a");
      const loose = this.plainly(50, "", () => any);
      this.emit(
        1,
        `const A${id}${loose} = ${this.pick([
          `{ ${key}: 2 }`,
          `{ ${key}: 2 }`,
          `{ ${key}: true }`,
          `{ ${key}: 1.5 }`,
          `{ ${key}: "t" }`,
          `{ ${key}: null }`,
          `{ ${key}: 2, z: 3 }`,
          `{ z: 3, ${key}: false }`,
          `{ z: 3 }`,
          `{}`,
          `{ get ${key}() { return 7; } }`,
          `{ ${key}() { return 8; } }`,
          `new (class { ${key} = 2; })()`,
          `Object.create({ ${key}: 2 })`,
          `null`,
          `[5]`,
        ])};`,
      );
      const A = `A${id}`;
      const literal = this.pick([
        `{ ...${A}, ${key}() {} }`,
        `{ ...${A}, ${key}() {} }`,
        `{ ...${A}, ${key}() {} }`,
        `{ ...${A}, ${key}() { return 1; } }`,
        `{ ...${A}, ${key}: 3 }`,
        `{ ${key}: 1, ...${A} }`,
        `{ ${key}() {}, ...${A} }`,
        `{ ...${A}, get ${key}() { return 5; } }`,
        `{ ...${A}, set ${key}(given${any}) {} }`,
        `{ ...${A}, ["${key}"]: 4 }`,
        `{ ...${A}, ["${key}"]() {} }`,
        `{ ...${A}, ...${A} }`,
        `{ ...${A}, ${key}: undefined }`,
        `{ ...${A}, async ${key}() {} }`,
        `{ ...${A}, *${key}() {} }`,
        `{ ...${A}, ${key}: () => 1 }`,
        `{ ...${A}, ${key}: function () {} }`,
        `{ ...${A}, ${key}: class {} }`,
        `{ __proto__: ${A}, ${key}() {} }`,
        `Object.assign({}, ${A}, { ${key}() {} })`,
      ]);
      // Code that runs once is compiled otherwise than code that runs often.
      this.emit(
        1,
        ...this.pick<() => string[]>([
          () => [`const r${id}${loose} = (() => (${literal}))();`],
          () => [`const r${id}${loose} = (() => (${literal}))();`],
          () => [`const r${id}${loose} = ${literal};`],
          () => [`const r${id}${loose} = (function ()${any} { return ${literal}; })();`],
          () => [`function make${id}()${any} { return ${literal}; }`, `const r${id}${loose} = make${id}();`],
          () => [
            `function make${id}()${any} { return ${literal}; }`,
            `let r${id}${any}; for (let turn = 0; turn < 3; turn++) r${id} = make${id}();`,
          ],
          // The same in steps: a value under the name by a copy or a store under a key, then a function by a plain store.
          () => [`const r${id}${any} = {};`, `Object.assign(r${id}, ${A});`, `r${id}.${key} = () => 1;`],
          () => [
            `const r${id}${any} = {};`,
            `{ const k = "${key}"; r${id}[k] = ${this.pick(["2", "true", "1.5"])}; }`,
            `r${id}.${key} = function () {};`,
          ],
          () => [
            `const r${id}${any} = {};`,
            `Reflect.set(r${id}, "${key}", ${this.pick(["2", "false"])});`,
            `r${id}.${key} = () => 1;`,
          ],
        ])(),
      );
      const r = `r${id}`;
      const change = this.pick([
        `delete ${r}.${key};`,
        `delete ${r}.${key};`,
        `delete ${r}.${key};`,
        `delete ${r}["${key}"];`,
        `Reflect.deleteProperty(${r}, "${key}");`,
        `{ const k = "${key}"; delete ${r}[k]; }`,
        `${r}.${key} = 9;`,
        `Object.defineProperty(${r}, "${key}", { value: 6 });`,
        ``,
        `delete ${r}.${key}; ${r}.${key} = 9;`,
        `delete ${r}.${key}; delete ${r}.${key};`,
        `note(delete ${r}.${key});`,
        `${r}.${key} = null; delete ${r}.${key};`,
        `note([delete ${r}.${key}, ${r}.${key}, delete ${r}.${key}, ${r}.${key}]);`,
      ]);
      const reads = this.several(1, 3, () =>
        this.pick([
          `note(${r}.${key});`,
          `note(${r}.${key});`,
          `note(${r}.${key});`,
          `note(typeof ${r}.${key});`,
          `note("${key}" in ${r});`,
          `note(Object.keys(${r}).join());`,
          `note(JSON.stringify(${r}));`,
          `note(Object.hasOwn(${r}, "${key}"));`,
          `note(${r}["${key}"]);`,
          `note({ ...${r} }.${key});`,
          `note(${A}?.${key});`,
        ]),
      ).join(" ");
      this.emit(1, `try { ${change} ${reads} } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`);
    }
    this.emit(1, `printValue("spreads ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * Three to seven ordinary steps, all on one object and one name: stores, definitions, deletes, copies, freezes, other prototypes, and between them what a
   * program can see of the name. Steps drawn for variables and names at random almost never meet on the same object.
   */
  sceneOfStepsOnOneObject() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value)) + ";"; }`,
    );
    for (let index = this.pick([1, 1, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [n, other] = [this.nameOfItsOwn("n"), this.nameOfItsOwn("m")];
      // Where the steps run for every row, a value can come out of data of mixed kinds.
      const perRow = this.chance(40);
      const written = () =>
        this.pick([
          "1",
          "2",
          "1.5",
          `"t"`,
          "true",
          "false",
          "null",
          "undefined",
          "{ k: 1 }",
          "[1]",
          "() => 1",
          "function () {}",
          "10n",
          "-0",
          "2147483648",
          `""`,
        ]);
      const value = () =>
        perRow && this.chance(60) ? this.pick(["row.x", "row.x", "row.x + 1", "row.y", "row.x ?? 0"]) : written();
      const condition = () =>
        perRow
          ? this.pick(["row.x", "row.y", "row.x !== undefined", `typeof row.x === "string"`])
          : this.pick(["out.length < 9999", `"${n}" in o`, `o.${n}`]);
      const origin = this.pick([
        "{}",
        "{}",
        "{}",
        `{ ${n}: ${value()} }`,
        `{ ${n}: ${value()} }`,
        `{ ${other}: 1, ${n}: ${value()} }`,
        `{ ${n}() { return 1; } }`,
        `{ get ${n}() { return 7; } }`,
        `{ ...{ ${n}: ${value()} } }`,
        "Object.create(null)",
        `Object.create({ ${n}: ${value()} })`,
        `{ __proto__: { ${n}: ${value()} } }`,
        `new (class { ${n} = ${value()}; })()`,
        `new (class { ${n}() { return 2; } })()`,
        `Object.assign({}, { ${n}: ${value()} })`,
        `JSON.parse('{"${n}":${this.pick(["1", `"t"`, "null", "1.5", "[1]"])}}')`,
        `Object.fromEntries([["${n}", ${value()}]])`,
        "[]",
        "function () {}",
      ]);
      const steps: (() => string)[] = [
        () => `o.${n} = ${value()};`,
        () => `o.${n} = ${value()};`,
        () => `o.${n} = ${value()};`,
        () => `o["${n}"] = ${value()};`,
        () => `{ const k = "${n}"; o[k] = ${value()}; }`,
        () => `Reflect.set(o, "${n}", ${value()});`,
        () => `Object.assign(o, { ${n}: ${value()} });`,
        () => `if (${condition()}) o.${n} = ${value()};`,
        () => `if (${condition()}) o.${n} = ${value()};`,
        () => `if (!("${n}" in o)) o.${n} = ${value()};`,
        () => `o.${n} ??= ${value()};`,
        () => `o.${n} ||= ${value()};`,
        () => `o.${n} += 1;`,
        () => `o.${n}++;`,
        () => `o.${other} = ${value()};`,
        () =>
          `Object.defineProperty(o, "${n}", { value: ${value()}, writable: ${this.chance(50)}, enumerable: ${this.chance(50)}, configurable: ${this.chance(70)} });`,
        () =>
          `Object.defineProperty(o, "${n}", { get() { return ${value()}; }, enumerable: ${this.chance(50)}, configurable: true });`,
        () => `delete o.${n};`,
        () => `delete o.${n};`,
        () => `delete o.${n};`,
        () => `{ const k = "${n}"; delete o[k]; }`,
        () => `Reflect.deleteProperty(o, "${n}");`,
        () => `if (${condition()}) delete o.${n};`,
        () => `delete o.${other};`,
        () => `o = { ...o };`,
        () => `o = { ...o };`,
        () => `o = Object.assign({}, o);`,
        () => `o = { ...o, ${n}() {} };`,
        () => `o = { ...o, ${n}: ${value()} };`,
        () => `o = { ${n}: ${value()}, ...o };`,
        () => `o = Object.create(o);`,
        () => `{ const { ${n}: taken, ...rest } = o; note(taken); o = rest; }`,
        () => `Object.freeze(o);`,
        () => `Object.seal(o);`,
        () => `Object.preventExtensions(o);`,
        () => `Object.setPrototypeOf(o, { ${n}: ${value()} });`,
        () => `Object.setPrototypeOf(o, null);`,
      ];
      const looks: (() => string)[] = [
        () => `note(o.${n});`,
        () => `note(o.${n});`,
        () => `note(o.${n});`,
        () => `note(o["${n}"]);`,
        () => `note(typeof o.${n});`,
        () => `note("${n}" in o);`,
        () => `note("${n}" in o);`,
        () => `note(Object.hasOwn(o, "${n}"));`,
        () => `note(Object.keys(o).join());`,
        () => `note(JSON.stringify(o));`,
        () => `note(Object.getOwnPropertyDescriptor(o, "${n}"));`,
        () => `for (const key in o) note(key);`,
        () => `note(Object.entries(o).length);`,
        () => `note({ ...o }.${n});`,
        () => `{ const { ${n}: read } = o; note(read); }`,
        () => `note("${n}" in o ? o.${n} : "lost");`,
        () => `note([delete o.${n}, o.${n}, delete o.${n}, o.${n}]);`,
        () => `note(Reflect.ownKeys(o).length);`,
      ];
      const body = [
        `let o${any} = ${origin};`,
        ...this.several(2, 6, () => (this.chance(70) ? this.pick(steps)() : this.pick(looks)())),
        ...this.several(1, 2, () => this.pick(looks)()),
      ].join(" ");
      const caught = `catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
      if (perRow) {
        const held = () =>
          this.pick([`"x"`, "1", `"a"`, "1.5", "null", "true", "0", `""`, "[1]", `{"k":1}`, "2147483648"]);
        const rows = this.several(
          3,
          4,
          () =>
            `{${[this.chance(80) ? `"x":${held()}` : "", this.chance(50) ? `"y":${held()}` : ""].filter(Boolean).join(",")}}`,
        );
        this.emit(
          1,
          `const rows${id}${any} = JSON.parse('[${rows.join(",")}]');`,
          `function run${id}(row${any})${this.typed("void")} { ${body} }`,
          this.pick([
            `for (const row of rows${id}) { try { run${id}(row); } ${caught} }`,
            `try { rows${id}.forEach(run${id}); } ${caught}`,
            `try { rows${id}.map((row${any}) => run${id}(row)); } ${caught}`,
          ]),
        );
      } else
        this.emit(
          1,
          ...this.pick<() => string[]>([
            () => [`try { (() => { ${body} })(); } ${caught}`],
            () => [`try { (() => { ${body} })(); } ${caught}`],
            () => [`try { ${body} } ${caught}`],
            () => [`function run${id}()${this.typed("void")} { ${body} }`, `try { run${id}(); } ${caught}`],
            () => [
              `function run${id}()${this.typed("void")} { ${body} }`,
              `for (let turn = 0; turn < 3; turn++) { try { run${id}(); } ${caught} }`,
            ],
          ])(),
        );
    }
    this.emit(1, `printValue("steps ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A small package and a program that uses it for many turns: classes whose methods call each other through `this`, async methods and awaits, an options object with defaults, a parameter whose
   * default is an empty literal, a table that is a function, an object or nothing, handlers that are called with `this`. In half of the draws the classes are in a file of their own and what
   * they call is in a CommonJS file.
   */
  sceneOfASmallPackage() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    const fields = (declared: string) => (this.isTypeScript ? declared + " " : "");
    const turns = this.pick([8, 24, 40, 64, 64]);
    const classes: string[] = [];
    const helpers: string[] = [];
    const uses: string[] = [];
    const names: string[] = [];
    const parts = this.several(1, 3, () => this.pick(["finder", "finder", "span", "span", "makers", "hub", "log"]));
    for (const part of new Set(parts)) {
      const C = part[0].toUpperCase() + part.slice(1) + number;
      names.push(C);
      if (part === "finder") {
        const test = this.pick([
          "Array.isArray(result)",
          "Array.isArray(result)",
          "result",
          "result?.length",
          `typeof result === "object" && result`,
        ]);
        const made = this.pick([
          "{ host: result[0], port: Number(result[1]) }",
          "{ host: result[0], port: Number(result[1]) }",
          "{ host: result?.[0], port: 1 }",
          "{ ...this.options.base, host: result[0], port: Number(result[1]) }",
          "{ host: result[0], port: Number(result[1]), ...(this.options.renews ? { fresh: true } : {}) }",
        ]);
        const none = this.pick(["null", "null", "undefined", "{}", "false", "this.options.fallback"]);
        const waits = this.pick([
          "",
          "await this.renew(client);",
          "await this.renew(client);",
          "await null; await this.renew(client);",
          "await this.renew(client); await this.renew(client);",
        ]);
        const handsOn = (item: string) =>
          this.pick([
            `this.translate(${item})`,
            `this.translate(${item})`,
            `this.translate(${item})`,
            `this["translate"](${item})`,
            `this.translate?.(${item})`,
            `${C}.prototype.translate.call(this, ${item})`,
          ]);
        classes.push(
          `class ${C} {`,
          `  ${fields("options: any; renewed: number;")}constructor(table${any}, options${any} = {}) { this.options = { name: "main", table, renews: true, ...options }; this.renewed = 0; }`,
          `  translate(item${any})${any} {`,
          `    if (!item || !this.options.table) return item;`,
          "    const key = `${item.host}:${item.port}`;",
          `    let result = item;`,
          `    if (typeof this.options.table === "function") result = this.options.table(key) || item;`,
          `    else if (typeof this.options.table === "object") result = this.options.table[key] || item;`,
          `    return result;`,
          `  }`,
          `  async renew(client${any})${any} {`,
          `    if (!this.options.renews) return;`,
          `    const result = await client.ask("others", this.options.name);`,
          `    if (!Array.isArray(result)) return;`,
          `    this.renewed += result.length;`,
          `  }`,
          `  async find(client${any})${any} {`,
          `    const result = await client.ask("address", this.options.name);`,
          `    ${waits}`,
          this.chance(70)
            ? `    return ${handsOn(`${test} ? ${made} : ${none}`)};`
            : `    const item = ${test} ? ${made} : ${none};\n    return ${handsOn("item")};`,
          `  }`,
          `  *each(items${any})${any} { for (const item of items) yield ${handsOn("item")}; }`,
          `}`,
        );
        uses.push(
          `const answers${number}${any} = { address: [["a.example", "7000"], null, ["b.example", "7001"], "no list"], others: [[1, 2], undefined, [3], []] };`,
          `function clientOf${number}(turn${any})${any} { return { ask: async (what${any}, name${any}) => (name === "main" ? answers${number}[what][turn & 3] : undefined) }; }`,
          `const tables${number}${any} = [undefined, { "a.example:7000": { host: "inside", port: 1 } }, (key${any}) => (key.startsWith("b.") ? { host: "made", port: key.length } : null), "neither"];`,
          `for (let turn = 0; turn < ${turns}; turn++) {`,
          `  const table = tables${number}[(turn >> 2) & 3];`,
          `  const finder = new ${C}(table${this.pick(["", "", ", {}", ", { renews: turn % 3 > 0 }", `, { base: { kind: "b" }, fallback: null }`])});`,
          `  const client = clientOf${number}(turn);`,
          `  const found = await finder.find(client);`,
          `  if (turn < 16) note(turn + ":" + JSON.stringify(found) + finder.renewed);`,
          this.chance(40)
            ? `  if (turn < 4) note(JSON.stringify([...finder.each([found, null, { host: "a.example", port: 7000 }])]));`
            : "",
          `}`,
        );
      } else if (part === "span") {
        const before = this.several(0, 3, () =>
          this.pick(["short: false", "prefix: false", `form: "long"`, "extra: undefined"]),
        );
        const after = this.several(0, 2, () => this.pick(["offset: false", "short: true", `form: "brief"`]));
        const merged = `{ ${[...new Set(before), "...options", ...new Set(after)].join(", ")} }`;
        const early = this.pick([
          "",
          "if (!this.isValid) return null;",
          "if (!this.isValid) return null;\n    if (length < 0 || length >= 86400) return null;",
        ]);
        const writes = this.pick([
          `write${number}(length, options)`,
          `write${number}(length, options)`,
          "this.write(length, options)",
          "JSON.stringify(options) + length",
        ]);
        helpers.push(
          `function write${number}(length${any}, { short, prefix, form, offset, extra }${any})${any} { return (prefix ? "T" : "") + (form === "long" ? length + " s" : length) + (short ? "" : ".000") + (offset ? "Z" : "") + (extra ?? ""); }`,
        );
        classes.push(
          `class ${C} {`,
          `  ${fields("length: any;")}constructor(length${any}) { this.length = length; }`,
          `  get isValid()${any} { return this.length === this.length; }`,
          `  write(length${any}, options${any})${any} { return write${number}(length, options); }`,
          `  describe(options${any} = {})${any} {`,
          `    const length = this.length | 0;`,
          `    ${early}`,
          this.chance(60)
            ? `    options = ${merged};`
            : `    { const given = options; options = ${merged.replace("...options", "...given")}; }`,
          `    return ${writes};`,
          `  }`,
          `}`,
        );
        uses.push(
          `const given${number}${any} = [undefined, {}, { short: true }, { prefix: true, form: "brief", offset: true }, { extra: "!" }, null];`,
          `for (let turn = 0; turn < ${turns}; turn++) {`,
          `  const span = new ${C}([11, -1, 86400, NaN, 3599][turn % 5]);`,
          `  const options = given${number}[turn % 6];`,
          `  const text = options === undefined ? span.describe() : span.describe(options);`,
          `  if (turn < 30) note(text);`,
          `}`,
        );
      } else if (part === "makers") {
        classes.push(
          `class ${C} {`,
          `  #made = new Map${this.isTypeScript ? "<any, any>" : ""}();`,
          `  isClosed = false;`,
          `  get(nameOrOptions${any}, version${this.isTypeScript ? "?: any" : ""}, options${any} = {})${any} {`,
          `    if (this.isClosed) return "closed";`,
          `    let name${any}, given${any};`,
          `    if (typeof nameOrOptions === "string") { name = nameOrOptions; given = ${this.pick(["{ version, ...options }", "{ ...options, version }", "{ version, ...options, ...(version ? {} : { none: true }) }"])}; }`,
          `    else { name = nameOrOptions.name; given = nameOrOptions; }`,
          '    const key = `${name}@${given.version || ""}`;',
          `    if (!this.#made.has(key)) this.#made.set(key, { key, address: given?.address || "" });`,
          `    return this.#made.get(key);`,
          `  }`,
          `}`,
        );
        uses.push(
          `const makers${number} = new ${C}();`,
          `for (let turn = 0; turn < ${turns}; turn++) {`,
          `  const made = turn % 4 === 0 ? makers${number}.get("a", "1") : turn % 4 === 1 ? makers${number}.get("b", "2", { address: "x", version: "3" }) : turn % 4 === 2 ? makers${number}.get({ name: "c", address: "y" }) : makers${number}.get("d");`,
          `  if (turn < 4) note(made.key + " " + made.address);`,
          `}`,
          `makers${number}.isClosed = true;`,
          `note(makers${number}.get("e"));`,
        );
      } else if (part === "hub") {
        classes.push(
          `class ${C} {`,
          `  ${fields("handlers: any; seen: number;")}constructor() { this.handlers = {}; this.seen = 0; }`,
          `  on(type${any}, handler${any})${any} { (this.handlers[type] ??= []).push(handler); return this; }`,
          `  dispatch(event${any})${any} { let out = ""; for (const handler of this.handlers[event.type] ?? []) out += handler.call(this, event) ?? ""; return out; }`,
          `  emit(type${any}, detail${this.isTypeScript ? "?: any" : ""})${any} { this.seen++; return this.dispatch(${this.pick(["detail === undefined ? { type } : { type, detail }", "{ type, ...(detail === undefined ? {} : { detail }) }", "detail ? { type, detail } : { type }"])}); }`,
          `}`,
        );
        uses.push(
          `const hub${number} = new ${C}();`,
          `hub${number}.on("a", function (${this.isTypeScript ? "this: any, " : ""}event${any}) { return event.type + this.seen; }).on("a", (event${any}) => event.detail?.x).on("b", (event${any}) => ("detail" in event ? "d" : "n"));`,
          `for (let turn = 0; turn < ${turns}; turn++) {`,
          `  const said = hub${number}.emit(["a", "b", "c"][turn % 3], [undefined, { x: turn }, 0, null][turn & 3]);`,
          `  if (turn < 12) note(said);`,
          `}`,
        );
      } else {
        classes.push(
          `class ${C} {`,
          `  ${fields("options: any; count: number;")}constructor(options${any} = {}) { this.options = { level: "info", ...options }; this.count = 0; }`,
          `  format(entry${any})${any} { return Object.keys(entry).join() + ":" + (entry.level ?? this.options.level); }`,
          `  log(level${any}, ...rest${this.isTypeScript ? ": any[]" : ""})${any} { const entry = { at: this.count++, ...(level ? { level } : {}), ...(rest.length ? { rest } : {}) }; return this.format(entry); }`,
          `  child(options${any} = {})${any} { return new (this.constructor${asAny})({ ...this.options, ...options }); }`,
          `}`,
        );
        uses.push(
          `const log${number} = new ${C}();`,
          `for (let turn = 0; turn < ${turns}; turn++) {`,
          `  const logger = turn % 5 === 4 ? log${number}.child(turn % 2 ? { level: "debug" } : undefined) : log${number};`,
          `  const line = turn % 3 === 0 ? logger.log("warn", turn) : turn % 3 === 1 ? logger.log(undefined) : logger.log("", 1, 2);`,
          `  if (turn < 12) note(line);`,
          `}`,
        );
      }
    }
    const ignore = this.isTypeScript ? "// @ts-ignore\n" : "";
    if (this.chance(50)) {
      // The classes are in a module, and what they call is in a CommonJS file.
      const [module, common] = [
        `./${this.nameOfItsOwn("package")}.${this.isTypeScript ? "ts" : "mjs"}`,
        `./${this.nameOfItsOwn("helpers")}.cjs`,
      ];
      const helperNames = helpers.map(each => /^function ([\w$]+)/.exec(each)![1]);
      const plain = helpers.map(each => each.replace(/: any/g, ""));
      if (helpers.length)
        this.files.push([common, [...plain, `module.exports = { ${helperNames.join(", ")} };`, ""].join("\n")]);
      this.files.push([
        module,
        [
          ...(helpers.length
            ? [`${ignore}import helpers from "${common}";`, `const { ${helperNames.join(", ")} }${any} = helpers;`]
            : []),
          ...classes,
          `export { ${names.join(", ")} };`,
          "",
        ].join("\n"),
      ]);
      this.imports.push(`${ignore}import { ${names.join(", ")} } from "${module}";`);
      this.lines.push("{");
    } else {
      this.lines.push("{");
      this.emit(1, ...helpers, ...classes.join("\n").split("\n"));
    }
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += String(value) + ";"; }`,
      ...uses.filter(Boolean),
      `printValue("package ${number}", out);`,
    );
    this.lines.push("}");
  }

  /** An object is made with a function under a name: a method, an arrow, a class. Native code stores something else under that name, and the program reads it. */
  sceneOfNativeStoresOverFunctions() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value)) + ";"; }`,
    );
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [n, other] = [this.nameOfItsOwn("n"), this.nameOfItsOwn("m")];
      const made = this.pick([
        `{ ${n}() { return 1; } }`,
        `{ ${n}() { return 1; } }`,
        `{ ${n}() { return 1; } }`,
        `{ ${n}: () => 1 }`,
        `{ ${n}: function () { return 1; } }`,
        `{ ${other}: 1, ${n}() { return this.${other}; } }`,
        `{ ${n}() { return 1; }, ${other}() { return 2; } }`,
        `{ async ${n}() { return 1; } }`,
        `{ *${n}() { yield 1; } }`,
        `{ ${n}: class {} }`,
        `{ get ${n}() { return () => 1; }, set ${n}(given) {} }`,
        `new (class { ${n} = () => 1; })()`,
        `Object.assign({}, { ${n}() { return 1; } })`,
        `{ ...{ ${n}() { return 1; } } }`,
      ]);
      const stores = this.several(1, 2, () =>
        this.pick([
          `Reflect.set(o, "${n}", y);`,
          `Reflect.set(o, "${n}", y);`,
          `Object.assign(o, { ${n}: y });`,
          `Object.assign(o, { ${n}: y });`,
          `Object.defineProperty(o, "${n}", { value: y, writable: true, enumerable: true, configurable: true });`,
          `Object.defineProperty(o, "${n}", { value: y });`,
          `Object.defineProperties(o, { ${n}: { value: y, enumerable: true, configurable: true } });`,
          `Reflect.defineProperty(o, "${n}", { value: y, configurable: true });`,
          `Object.defineProperty(o, "${n}", { get() { return y; }, configurable: true });`,
          `new Proxy(o, {}).${n} = y;`,
          `new Proxy(o, { set(target, key, value) { return Reflect.set(target, key, value); } }).${n} = y;`,
          `Reflect.set(Object.create(o), "${n}", y, o);`,
          `Object.assign(o, JSON.parse('{"${n}":2}'));`,
          `Object.assign(o, Object.fromEntries([["${n}", y]]));`,
          `[["${n}", y]].forEach(([key, value]) => { o[key${asAny}] = value; });`,
          `for (const key of Object.keys(o)) o[key] = y;`,
          `Reflect.deleteProperty(o, "${n}");`,
          `Object.setPrototypeOf(o, { ${n}: y }); Reflect.deleteProperty(o, "${n}");`,
          `Object.freeze(o);`,
        ]),
      ).join(" ");
      const looks = this.several(1, 3, () =>
        this.pick([
          `note(o.${n});`,
          `note(o.${n});`,
          `note(o.${n});`,
          `note(typeof o.${n});`,
          `note(typeof o.${n} === "function" ? o.${n}() : o.${n});`,
          `note(o.${n}?.call?.(o));`,
          `note(o["${n}"]);`,
          `note({ ...o }.${n});`,
          `{ const { ${n}: read } = o; note(read); }`,
          `note(JSON.stringify(o));`,
          `note(Object.getOwnPropertyDescriptor(o, "${n}")?.value);`,
          `note(Object.values(o).length);`,
          `note("${n}" in o);`,
        ]),
      ).join(" ");
      const given = this.several(2, 4, () =>
        this.pick([
          `""`,
          "true",
          "undefined",
          `"a"`,
          "0",
          "1.5",
          "null",
          "{ k: 1 }",
          "[1]",
          "() => 2",
          "10n",
          "function other() {}",
        ]),
      );
      const caught = `catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
      this.emit(
        1,
        `function run${id}(y${any})${this.typed("void")} { ${this.pick(["const", "const", "let"])} o${any} = ${made}; ${this.chance(25) ? looks + " " : ""}${stores} ${looks} }`,
        this.pick([
          `for (const y of [${given.join(", ")}]) { try { run${id}(y); } ${caught} }`,
          given.map(y => `try { run${id}(${y}); } ${caught}`).join(" "),
          `try { run${id}(${given[0]}); } ${caught}`,
          `for (const row of JSON.parse('[{"y":""},{"y":true},{"x":1},{"y":"a"},{"y":2}]')) { try { run${id}(row.y); } ${caught} }`,
        ]),
      );
    }
    this.emit(1, `printValue("natives ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A function answers a class expression, and the program extends what it answers or makes instances of it. The class holds what a class can hold: static blocks, private names of every kind,
   * accessors, computed keys, field initializers that close over the variables of the function, WeakMaps and WeakSets behind the helpers that tsc writes for private names, decorators as tsc writes them.
   */
  sceneOfClassesOutOfFactories() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    const caught = `catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
    const value = () => this.pick(["1", "2", "1.5", `"t"`, "true", "null", "[1]", "{ k: 1 }", "10n"]);
    type Part = {
      top?: string[];
      variables?: string[];
      members: string[];
      built?: string[];
      behind?: (made: string) => string[];
      looks: (K: string, o: string, Other: string) => string[];
    };
    const parts: ((i: string) => Part)[] = [
      i => ({
        members: [
          `static #c${i} = ${value()};`,
          `static { ${this.isTypeScript ? "(this as any)" : "this"}.t${i} = this.#c${i}; }`,
        ],
        looks: K => [`note(${K}.t${i});`],
      }),
      i => ({
        members: [
          `static #c${i} = ${value()};`,
          `static { ${this.isTypeScript ? "(this as any)" : "this"}.t${i} = this.#c${i}; }`,
        ],
        looks: K => [`note(${K}.t${i});`],
      }),
      i => ({
        variables: [`let next${i} = 1;`],
        members: [`static { next${i} = 100; }`, `id${i} = next${i}++;`],
        looks: (K, o) => [`note(${o}.id${i});`, `note(new ${K}(8).id${i});`],
      }),
      i => ({
        variables: [`let next${i} = 1;`],
        members: [`static { next${i} = 100; }`, `id${i} = next${i}++;`],
        looks: (K, o) => [`note(${o}.id${i});`, `note(new ${K}(8).id${i});`],
      }),
      i => ({
        members: [
          `#p${i}${any} = ${value()};`,
          `read${i}()${any} { return this.#p${i}; }`,
          `write${i}(given${any})${any} { this.#p${i} = given; return this; }`,
        ],
        looks: (_, o) => [`note(${o}.read${i}());`, `note(${o}.write${i}(5).read${i}());`],
      }),
      i => ({
        members: [
          `#m${i}()${any} { return ${value()}; }`,
          `get #g${i}()${any} { return this.#m${i}(); }`,
          `seen${i}()${any} { return this.#g${i}; }`,
        ],
        looks: (_, o) => [`note(${o}.seen${i}());`],
      }),
      i => ({
        members: [`#b${i}${any};`, `static is${i}(given${any})${any} { return #b${i} in given; }`],
        looks: (K, o, Other) => [
          `note(${K}.is${i}(${o}));`,
          `note(${K}.is${i}({}));`,
          `note(${K}.is${i}(new ${Other}(1)));`,
        ],
      }),
      i => ({
        members: [
          `static #s${i}()${any} { return ${value()}; }`,
          `static viaThis${i}()${any} { return this.#s${i}(); }`,
        ],
        looks: K => [`note(${K}.viaThis${i}());`],
      }),
      i => ({
        top: [
          `var get${i} = function (receiver${any}, map${any})${any} { if (!map.has(receiver)) { throw new TypeError("attempted to get private field on non-instance"); } return map.get(receiver); };`,
          `var set${i} = function (receiver${any}, map${any}, given${any})${any} { if (!map.has(receiver)) { throw new TypeError("attempted to set private field on non-instance"); } map.set(receiver, given); return given; };`,
          `const map${i} = new WeakMap${this.isTypeScript ? "<any, any>" : ""}();`,
        ],
        built: [`map${i}.set(this, v);`],
        members: [
          `readMap${i}()${any} { return get${i}(this, map${i}); }`,
          `writeMap${i}(given${any})${any} { return set${i}(this, map${i}, given); }`,
        ],
        looks: (_, o) => [
          `map${i}.set(${o}, 9); note([${o}.readMap${i}(), ${o}.readMap${i}()].join());`,
          `note(${o}.writeMap${i}(4)); note(${o}.readMap${i}());`,
        ],
      }),
      i => ({
        top: [
          `function in${i}(state${any}, receiver${any})${any} { if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object"); return typeof state === "function" ? receiver === state : state.has(receiver); }`,
          `const set${i} = new WeakSet${this.isTypeScript ? "<any>" : ""}();`,
        ],
        built: [`set${i}.add(this);`],
        members: [`isIn${i}()${any} { return in${i}(set${i}, this); }`],
        looks: (K, o) => [`note(${o}.isIn${i}());`, `note(${K}.prototype.isIn${i}.call({}));`],
      }),
      i => ({
        variables: [`let held${i}${any} = ${value()};`],
        members: [
          `get a${i}()${any} { return held${i}; }`,
          `set a${i}(given${any}) { held${i} = given; }`,
          `static get sa${i}()${any} { return held${i}; }`,
        ],
        looks: (K, o) => [`note(${o}.a${i});`, `${o}.a${i} = 5; note(${o}.a${i}); note(${K}.sa${i});`],
      }),
      i => ({
        variables: [`const key${i} = "k${i}";`],
        members: [
          `[key${i}]()${any} { return ${value()}; }`,
          `static [key${i} + "s"] = ${value()};`,
          `get [key${i} + "g"]()${any} { return ${value()}; }`,
        ],
        looks: (K, o) => [`note(${o}.k${i}());`, `note(${K}.k${i}s);`, `note(${o}.k${i}g);`],
      }),
      i => ({
        variables: [`let count${i} = 0;`],
        members: [`f${i} = ++count${i};`, `g${i} = ()${any} => count${i};`, `static sf${i} = count${i};`],
        looks: (K, o) => [
          `note(${o}.f${i});`,
          `note(new ${K}(2).g${i}());`,
          `note(${o}.g${i}());`,
          `note(${K}.sf${i});`,
        ],
      }),
      i => ({
        top: [`const registry${i}${this.isTypeScript ? ": any[]" : ""} = [];`],
        members: [`static { registry${i}.push(typeof this, this.name); }`],
        looks: () => [`note(registry${i}.join());`],
      }),
      i => ({
        top: [
          `var decorate${i} = function (decorators${any}, target${any}, key${this.isTypeScript ? "?: any" : ""}, desc${this.isTypeScript ? "?: any" : ""})${any} { var c = arguments.length, r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc, d; for (var i = decorators.length - 1; i >= 0; i--) if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r; return c > 3 && r && Object.defineProperty(target, key, r), r; };`,
          `function twice${i}(target${any}, key${any}, descriptor${any})${any} { const inner = descriptor.value; descriptor.value = function (${this.isTypeScript ? "this: any" : ""}) { return [inner.call(this), inner.call(this)]; }; return descriptor; }`,
          `function marked${i}(target${any})${any} { target.marked${i} = true; return target; }`,
        ],
        members: [`d${i}()${any} { return ${value()}; }`],
        behind: made => [
          `decorate${i}([twice${i}], ${made}.prototype, "d${i}", null);`,
          `${made} = decorate${i}([marked${i}], ${made});`,
        ],
        looks: (K, o) => [`note(${o}.d${i}());`, `note(${K}.marked${i});`],
      }),
    ];
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value)) + ";"; }`,
    );
    for (let index = this.pick([1, 1, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const chosen = this.several(1, 3, () => this.pick(parts)).map((part, at) => part(`${id}_${at}`));
      const isMixin = this.chance(50);
      const built = chosen.flatMap(part => part.built ?? []);
      const members = [
        ...(built.length || this.chance(30)
          ? [`constructor(v${this.isTypeScript ? "?: any" : ""}) { ${isMixin ? "super(); " : ""}${built.join(" ")} }`]
          : []),
        ...chosen.flatMap(part => part.members),
      ];
      const written = `class ${this.pick(["", "", `Named${id} `])}${isMixin ? "extends Base " : ""}{ ${members.join(" ")} }`;
      const variables = chosen.flatMap(part => part.variables ?? []);
      const behind = chosen.flatMap(part => part.behind?.("made") ?? []);
      const parameter = isMixin ? `Base${any}` : "";
      const isShort = variables.length === 0 && behind.length === 0;
      const body = behind.length
        ? `{ ${variables.join(" ")} let made${any} = ${written}; ${behind.join(" ")} return made; }`
        : `{ ${variables.join(" ")} return ${written}; }`;
      const base = isMixin
        ? this.pick(["Object", "Object", `P${id}`, `P${id}`, "Array", "class { base() { return 1; } }"])
        : "";
      this.emit(
        1,
        ...chosen.flatMap(part => part.top ?? []),
        ...(base === `P${id}` ? [`class P${id} {}`] : []),
        this.pick([
          isShort
            ? `const make${id} = (${parameter})${any} => ${written};`
            : `const make${id} = (${parameter})${any} => ${body};`,
          isShort
            ? `const make${id} = (${parameter})${any} => ${written};`
            : `const make${id} = (${parameter})${any} => ${body};`,
          `function make${id}(${parameter})${any} ${body}`,
          `const make${id} = function (${parameter})${any} ${body};`,
        ]),
      );
      const call = `make${id}(${base})`;
      const [K, Other] = [`K${id}`, `Other${id}`];
      this.emit(
        1,
        ...this.pick<() => string[]>([
          () => [`class ${K} extends ${call} {}`],
          () => [`class ${K} extends ${call} {}`],
          () => [`const ${K}${any} = ${call};`],
          () => [`const ${K}${any} = ${call};`],
          () => [`class ${K} extends ${call} { constructor(v${this.isTypeScript ? "?: any" : ""}) { super(v); } }`],
          () => [`let ${K}${any}; for (let turn = 0; turn < 3; turn++) ${K} = ${call};`],
          () => [`class Between${id} extends ${call} {}`, `class ${K} extends Between${id} {}`],
        ])(),
        `const ${Other}${any} = ${call};`,
      );
      const looks = chosen.flatMap(part => part.looks(this.isTypeScript ? `(${K} as any)` : K, `o${id}`, Other));
      this.emit(
        1,
        ...this.pick<() => string[]>([
          () => [
            `let o${id}${any}; try { o${id} = new ${K}(7); } ${caught}`,
            ...looks.map(look => `try { ${look} } ${caught}`),
          ],
          () => [
            `let o${id}${any}; try { o${id} = new ${K}(7); } ${caught}`,
            ...looks.map(look => `try { ${look} } ${caught}`),
          ],
          () => [
            `function use${id}()${this.typed("void")} { const o${id}${any} = new ${K}(7); ${looks.join(" ")} }`,
            `try { use${id}(); } ${caught}`,
          ],
          () => [
            `function use${id}()${this.typed("void")} { const o${id}${any} = new ${K}(7); ${looks.join(" ")} }`,
            `for (let turn = 0; turn < 2; turn++) { try { use${id}(); } ${caught} }`,
          ],
        ])(),
      );
      if (this.chance(40))
        this.emit(
          1,
          `try { note(${K} === ${Other}); note(new ${K}(1) instanceof ${Other}); note(Object.getOwnPropertyNames(${K}).sort().join()); note(Object.getOwnPropertyNames(${Other}.prototype).sort().join()); } ${caught}`,
        );
    }
    this.emit(1, `printValue("factories ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A small loop walks a list by its counter. In one turn it tests the element, or a field of it, stores to the same place in one arm, and reads the place again.
   * The function is called with lists of one kind alone, and both what it answers and the list are printed.
   */
  sceneOfElementsStoredAndReadAgain() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += JSON.stringify(value) + ";"; }`,
    );
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const hasRows = this.chance(40);
      const hasFractions = this.chance(30);
      const hit = hasFractions ? "100.5" : "100";
      const stored = this.chance(90)
        ? this.pick(hasFractions ? ["3.5", "0.5", "-1.5"] : ["3", "0", "-1", "7", "2147483647"])
        : this.pick([`"t"`, "1.5", "null", "undefined"]);
      const element = (at: number) => (this.chance(35) ? hit : String(at + 1) + (hasFractions ? ".5" : ""));
      const written = (length: number) =>
        `[${Array.from({ length }, (_, at) => (hasRows ? `{ value: ${element(at)} }` : element(at))).join(", ")}]`;
      const made = () => {
        const length = this.pick([1, 3, 3, 8, 21]);
        const list = written(length);
        return this.pick([
          list,
          list,
          `(() => { const made${any} = []; for (const each of ${list}) made.push(each); return made; })()`,
          `Array.from(${list})`,
          `${list}.map((each${any}) => each)`,
          `${list}.slice()`,
          `[...${list}]`,
          `([]${asAny}).concat(${list})`,
          `Array.of(...${list})`,
          hasRows
            ? `Array.from({ length: ${length} }, (_, at) => ({ value: at % 2 ? ${hit} : at }))`
            : `new Array(${length}).fill(${hit})`,
          hasRows ? `${list}.map((each${any}) => new (class { value = each.value; })())` : `[, ...${list}]`,
        ]);
      };
      const place = hasRows ? "a[i].value" : "a[i]";
      const test = this.pick([
        `${place} === ${hit}`,
        `${place} === ${hit}`,
        `${place} == ${hit}`,
        `${place} > 99`,
        `${place} >= ${hit}`,
        `${place} !== 1`,
      ]);
      const [before, store] = this.pick<[string, string]>([
        ["", `${place} = ${stored};`],
        ["", `${place} = ${stored};`],
        ["", `${place} = ${stored};`],
        ["const b = a;", `${place.replace("a[", "b[")} = ${stored};`],
        ["", `{ const j = i; ${place.replace("[i]", "[j]")} = ${stored}; }`],
        ["", `${place.replace("[i]", "[i + 0]")} = ${stored};`],
        ["", hasRows ? `a[i] = { value: ${stored} };` : `a[i + 1 < a.length ? i + 1 : i] = ${stored};`],
        ["", hasRows ? `{ const row = a[i]; row.value = ${stored}; }` : `a[i] = a[i] - 97;`],
        ["", `${place} += 1;`],
      ]);
      const turn = this.pick([
        `if (${test}) ${store} s += ${place};`,
        `if (${test}) ${store} s += ${place};`,
        `if (${test}) { ${store} } s = s + ${place};`,
        `if (!(${test})) { s += 1; } else { ${store} } s += ${place};`,
        `const first = ${place}; if (${test}) ${store} s += first + ${place};`,
        `if (${test}) ${store} s += ${place} * 2;`,
      ]);
      const loop = this.pick([
        `for (let i = 0; i < a.length; i++) { ${turn} }`,
        `for (let i = 0; i < a.length; i++) { ${turn} }`,
        `for (let i = 0, n = a.length; i < n; i++) { ${turn} }`,
        `for (let i = a.length - 1; i >= 0; i--) { ${turn} }`,
        `let i = 0; while (i < a.length) { ${turn} i++; }`,
        `for (let i = 0; i < a.length; i += 1) { ${turn} }`,
      ]);
      const type = this.isTypeScript
        ? this.plainly(30, ": any", () => (hasRows ? ": { value: number }[]" : ": number[]"))
        : "";
      this.emit(1, `function total${id}(a${type})${any} { let s${any} = 0; ${before} ${loop} return s; }`);
      // Each list has a name of its own: run-batch.ts can take the try away (--unwraps-try-blocks), and then the declarations stand in one block.
      for (const [at, list] of this.several(1, 3, made).entries())
        this.emit(
          1,
          `try { const list${id}_${at}${any} = ${list}; note(total${id}(list${id}_${at})); note(list${id}_${at}); } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`,
        );
    }
    this.emit(1, `printValue("elements ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A second file from which the program takes types alone, so that no code of it is in the executable: enums whose members name members by a path, classes with private names, namespaces,
   * ambient constants. Or a declaration file beside a JavaScript file. In JavaScript there are no such files, and the scene is one of steps on an object.
   */
  sceneOfAFileUsedOnlyForItsTypes() {
    if (!this.isTypeScript) return this.sceneOfStepsOnOneObject();
    const number = ++this.count;
    const tag = this.nameOfItsOwn("t");
    const declared: [name: string, text: string][] = [
      ["Flags", `export enum Flags { Read = 1, Write = 2, All = Flags.Read | Flags.Write }`],
      ["Keyed", `export enum Keyed { A = 1, B = Keyed["A"] + 1 }`],
      ["Other", `export enum Seed { A = 3 }\nexport enum Other { A = Seed.A, B = Seed.A << 1, C = Other.B | Seed.A }`],
      [
        "Via",
        `export namespace Ns { export enum E { A = 5, B = E.A * 2 } }\nexport enum Via { A = Ns.E.A, B = Ns.E.B + 1 }`,
      ],
      ["Texts", 'export enum Texts { A = "a", B = `${Texts.A}b` }'],
      ["Quick", `export const enum Quick { A = 1, B = Quick.A + 1 }`],
      ["Mixed", `export enum Mixed { A, B = A + 2, C, D = "d" }`],
      [
        "Held",
        `export class Held { #p = 1; get a() { return this.#p; } static #s = 2; static { Held.#s++; } #m() { return 3; } call() { return this.#m(); } }`,
      ],
      [
        "Shape",
        `export enum Kind { Round = 1, Square = Kind.Round + 1 }\nexport interface Shape { kind: Kind; side?: number }`,
      ],
      ["Alias", `export enum Left { A = 1 }\nexport enum Right { A = Left.A + 1 }\nexport type Alias = Left | Right;`],
      [
        "Ambient",
        `export enum Base { A = 7 }\nexport declare const ambient = Base.A;\nexport type Ambient = typeof ambient;`,
      ],
      ["Old", `export function Old(this: any) { this.x = 1; }\nOld.prototype.y = 2;`],
    ];
    // The names are the scene's own: a program that it is written into can declare a `Texts` itself.
    const own = (text: string) =>
      text.replace(
        /\b(?:Flags|Keyed|Seed|Other|Ns|Via|Texts|Quick|Mixed|Held|Kind|Shape|Left|Right|Alias|Base|ambient|Ambient|Old)\b/g,
        name => name + number,
      );
    const isCode = (name: string) => /^(?:Held|Old|Ambient)\d/.test(name);
    const chosen = [...new Map(this.several(1, 4, () => this.pick(declared))).entries()].map(
      ([name, text]): [string, string] => [own(name), own(text)],
    );
    const names = chosen.map(([name]) => name);
    const isDeclarationFile = this.chance(25);
    const file = `./${tag}.${isDeclarationFile ? "js" : "ts"}`;
    if (isDeclarationFile) {
      this.files.push([file, `export const made${number} = ${number};\n`]);
      this.files.push([
        `./${tag}.d.ts`,
        [
          `export declare const made${number}: number;`,
          ...chosen
            .filter(([name]) => !isCode(name))
            .map(([, text]) => text.replace(/^export (?=enum|const enum|namespace)/gm, "export declare ")),
          "",
        ].join("\n"),
      ]);
    } else this.files.push([file, chosen.map(([, text]) => text).join("\n") + "\n"]);
    const usable = isDeclarationFile ? names.filter(name => !isCode(name)) : names;
    const space = `space${number}`;
    const byNamespace = this.chance(25);
    const ignore = "// @ts-ignore\n";
    if (isDeclarationFile) this.imports.push(`${ignore}import { made${number} } from "${file}";`);
    if (usable.length)
      this.imports.push(
        ignore +
          (byNamespace
            ? `import type * as ${space} from "${file}";`
            : this.pick([
                `import { ${usable.join(", ")} } from "${file}";`,
                `import { ${usable.join(", ")} } from "${file}";`,
                `import type { ${usable.join(", ")} } from "${file}";`,
                `import { ${usable.map(name => "type " + name).join(", ")} } from "${file}";`,
              ])),
      );
    this.lines.push("{");
    this.emit(1, `let out = "";`, `function note(value: any): void { out += String(value) + ";"; }`);
    usable.forEach((name, at) => {
      const type = (name.startsWith("Old") ? "typeof " : "") + (byNamespace ? space + "." : "") + name;
      this.emit(
        1,
        this.pick([
          `const held${number}_${at}: ${type} = ${at + 1} as any; note(held${number}_${at});`,
          `function takes${number}_${at}(given: ${type}): ${type} | undefined { return given; } note(takes${number}_${at}(${at + 2} as any));`,
          `let later${number}_${at}: ${type} | undefined; note(later${number}_${at});`,
          `const list${number}_${at}: ${type}[] = []; note(list${number}_${at}.length);`,
          `type Local${number}_${at} = { inner: ${type} }; const local${number}_${at}: Local${number}_${at} = { inner: ${at} as any }; note(local${number}_${at}.inner);`,
          `class Uses${number}_${at} { field?: ${type}; method(given?: ${type}): ${type} | undefined { return given ?? this.field; } } note(new Uses${number}_${at}().method());`,
        ]),
      );
    });
    if (isDeclarationFile) this.emit(1, `note(made${number});`);
    this.emit(1, `printValue("types ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A constant at the top of a block whose value a transpiler can work out, because everything in it is written out: `"abcdef".charCodeAt(3)`. Then a statement that does something, then the
   * constant is answered, directly, in a list, out of an inner function or through a second constant. What the statement did is printed beside the answer.
   */
  sceneOfConstantsWorkedOutAheadOfEffects() {
    const number = ++this.count;
    const any = this.typed("any");
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "function" ? "function" : JSON.stringify(value) ?? String(value)) + ";"; }`,
    );
    for (let index = this.pick([2, 3, 3, 4]); index > 0; index--) {
      const id = `${number}_${index}`;
      const written = () =>
        this.pick([
          `"abcdef".charCodeAt(3)`,
          `"abcdef".charCodeAt(3)`,
          `"abcdef".charCodeAt(9)`,
          `"abcdef".charAt(1)`,
          `"abcdef".codePointAt(2)`,
          `"abcdef".at(-1)`,
          `"abcdef"[2]`,
          `"abcdef".length`,
          `"abcdef".indexOf("d")`,
          `"abcdef".slice(1, 3)`,
          `"abcdef".substring(2)`,
          `"abcdef".includes("cd")`,
          `"abcdef".startsWith("ab")`,
          `"abc".concat("def")`,
          `"abc".toUpperCase()`,
          `" abc ".trim()`,
          `"ab".repeat(2)`,
          `"a,b".split(",")`,
          `"abc" + "def"`,
          "`a${1}b`",
          `1 + 2 * 3`,
          `7 % 4`,
          `2 ** 10`,
          `1 << 4`,
          `-"3"`,
          `+"12"`,
          `typeof "x"`,
          `typeof 1n`,
          `!0`,
          `void 0`,
          `"a" === "a"`,
          `1 < 2`,
          `null ?? 5`,
          `"" || "z"`,
          `0 && 1`,
          `true ? "yes" : "no"`,
          `[1, 2, 3].length`,
          `[1, 2, 3][1]`,
          `({ a: 1 }).a`,
          `Math.max(1, 2)`,
          `Number("3")`,
          `String(4)`,
          `Boolean("")`,
          `10n * 2n === 20n`,
        ]);
      const ahead = this.several(0, 2, () =>
        this.pick([
          `const ahead${this.count++} = 1;`,
          `const ahead${this.count++} = "t";`,
          `const ahead${this.count++} = null;`,
        ]),
      ).join(" ");
      const effect = this.pick([
        `n${id}++;`,
        `n${id}++;`,
        `n${id} += 2;`,
        `list${id}.push(n${id}++);`,
        `note("in"); n${id}++;`,
        `held${id}.x = ++n${id};`,
        `if (n${id} >= 0) n${id}++;`,
        `for (let i = 0; i < 2; i++) n${id}++;`,
        `try { n${id}++; } finally { n${id}++; }`,
        `bump${id}();`,
        `n${id} = n${id} + (c === c ? 1 : 2);`,
      ]);
      const answer = this.pick([
        `return c;`,
        `return c;`,
        `return c;`,
        `return [c, n${id}];`,
        `return () => c;`,
        `return function () { return c; };`,
        `{ return c; }`,
        `const d = c; n${id}++; return d;`,
        `return { c };`,
        `return c ?? "none";`,
      ]);
      const body = `${ahead} const c = ${written()}; ${effect} ${answer}`;
      const [declared, called] = this.pick<[string, string]>([
        [`function f${id}()${any} { ${body} }`, `f${id}()`],
        [`function f${id}()${any} { ${body} }`, `f${id}()`],
        [`const f${id} = ()${any} => { ${body} };`, `f${id}()`],
        [`const o${id} = { m()${any} { ${body} } };`, `o${id}.m()`],
        [`const o${id} = { get m()${any} { ${body} } };`, `o${id}.m`],
        [`class C${id} { m()${any} { ${body} } }`, `new C${id}().m()`],
        [`class C${id} { static m()${any} { ${body} } }`, `C${id}.m()`],
        [
          `function f${id}(given${any} = 0)${any} { if (given) { ${body} } ${body.replaceAll("const ahead", "const below")} }`,
          `f${id}(1)`,
        ],
        [`function* f${id}()${any} { ${body} }`, `f${id}().next().value`],
      ]);
      this.emit(
        1,
        `let n${id} = 0; const list${id}${any} = []; const held${id}${any} = {}; function bump${id}()${this.typed("void")} { n${id}++; }`,
        declared,
      );
      this.emit(
        1,
        `try { for (let turn = 0; turn < 2; turn++) { let got${any} = ${called}; if (typeof got === "function") got = got(); note(got); note(n${id}); } note(list${id}); note(held${id}); } catch (error) { note("threw"); }`,
      );
    }
    this.emit(1, `printValue("constants ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A for-in whose keys are printed, over an object that is no array and has about twenty keys that are indexes, or many more, and a name that an object above it has too: own over inherited,
   * hidden over enumerable and the reverse, an accessor over a value, removed and stored again. The indexes come ahead of the names or behind them, and the object above can have indexes as well.
   */
  sceneOfForInOverManyIndexKeys() {
    const number = ++this.count;
    const any = this.typed("any");
    this.lines.push("{");
    this.emit(1, `let out = "";`, `function note(value${any})${this.typed("void")} { out += String(value) + ";"; }`);
    this.emit(
      1,
      `function walked(object${any})${this.typed("string")} { const keys${this.typed("string[]")} = []; for (const key in object) keys.push(key); return keys.length + ":" + keys.filter(key => !/^\\d+$/.test(key)).join() + ":" + keys.slice(0, 2).join() + ":" + keys.slice(-2).join(); }`,
    );
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const shared = this.nameOfItsOwn("s");
      const other = this.nameOfItsOwn("t");
      const count = () => this.pick([19, 20, 21, 21, 22, 64, 1000]);
      const above = this.pick([
        `{ ${shared}: 7 }`,
        `{ ${shared}: 7 }`,
        `{ ${shared}: 7, ${other}: 8 }`,
        `{ ${other}: 8, ${shared}: 7 }`,
        `{ 3: "up", ${shared}: 7 }`,
        `{ get ${shared}() { return 1; } }`,
        `Object.defineProperty({ ${other}: 8 }, "${shared}", { value: 1, enumerable: false, configurable: true, writable: true })`,
        `Object.create({ ${shared}: 1 }, { ${other}: { value: 2, enumerable: true } })`,
        `Object.create({ ${shared}: 1, ${other}: 2 }, { ${shared}: { value: 3, enumerable: true, writable: true, configurable: true } })`,
      ]);
      const made = this.pick([
        `Object.create(up${id})`,
        `Object.create(up${id})`,
        `{ __proto__: up${id} }`,
        `Object.setPrototypeOf({}, up${id})`,
        `(() => { class K${id} { own = 1; } Object.setPrototypeOf(K${id}.prototype, up${id}); return new K${id}(); })()`,
        `(() => { function F${id}(${this.isTypeScript ? "this: any" : ""}) { this.own = 1; } F${id}.prototype = up${id}; return new (F${id}${this.isTypeScript ? " as any" : ""})(); })()`,
      ]);
      const indexes = `for (let i = 0; i < ${count()}; i++) o${id}[i] = i;`;
      const name = this.pick([
        `o${id}.${shared} = null;`,
        `o${id}.${shared} = null;`,
        `o${id}.${shared} = 1; o${id}.${other} = 2;`,
        `Object.defineProperty(o${id}, "${shared}", { value: 1, enumerable: false, configurable: true });`,
        `Object.defineProperty(o${id}, "${shared}", { get() { return 1; }, enumerable: true, configurable: true });`,
        `o${id}.${shared} = 1; delete o${id}.${shared}; o${id}.${shared} = 2;`,
        `o${id}.${shared} = 1; delete o${id}.${shared};`,
        `o${id}["${shared}"] = undefined;`,
      ]);
      this.emit(1, `const up${id}${any} = ${above};`);
      if (this.chance(30))
        this.emit(1, `for (let i = 0; i < ${count()}; i++) up${id}[i + ${this.pick([0, 10, 100])}] = i;`);
      this.emit(1, `const o${id}${any} = ${made};`);
      const named = `try { ${name} } catch (error) { note("refused"); }`;
      this.emit(1, ...(this.chance(50) ? [indexes, named] : [named, indexes]));
      this.emit(
        1,
        `try { note(walked(o${id})); note(Object.keys(o${id}).length); note(walked(o${id})); note(walked({ ...o${id} })); } catch (error) { note("threw"); }`,
      );
    }
    this.emit(1, `printValue("walks ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A record gets a key under a name that only the run knows, then may not grow any more (or gets a private field through a base class that answers its argument), and is copied.
   * The copy may grow: an index key and a name are written to it, and what it is afterwards is printed.
   */
  sceneOfCopiesOfRecordsThatMayNotGrow() {
    const number = ++this.count;
    const any = this.typed("any");
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)) + ";"; }`,
    );
    this.emit(
      1,
      `class Answers${number} { constructor(given${any}) { return given; } }`,
      `class Stamps${number} extends Answers${number} { #p = 1; static has(given${any})${this.typed("boolean")} { return #p in given; } }`,
    );
    for (let index = this.pick([2, 3, 3, 4]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [head, tail] = [this.nameOfItsOwn("k"), this.nameOfItsOwn("l")];
      const held = this.pick([
        `Object.preventExtensions(o${id});`,
        `Object.preventExtensions(o${id});`,
        `Object.seal(o${id});`,
        `Object.freeze(o${id});`,
        `Reflect.preventExtensions(o${id});`,
        `new Stamps${number}(o${id});`,
        `new Stamps${number}(o${id}); Object.freeze(o${id});`,
      ]);
      const copy = this.pick([
        `{ ...o${id} }`,
        `{ ...o${id} }`,
        `{ ...o${id}, 1: 1 }`,
        `{ 1: 1, ...o${id} }`,
        `(({ a, ...rest }${any}) => rest)(o${id})`,
        `Object.assign({}, o${id})`,
        `Object.fromEntries(Object.entries(o${id}))`,
        `{ ...{ ...o${id} } }`,
      ]);
      this.emit(
        1,
        `const key${id}${this.typed("string")} = ["${head}", "${tail}"].join("");`,
        `const o${id}${any} = ${this.pick([`{ a: 1 }`, `{ a: 1, b: "t" }`, `{}`, `{ a: 1, 0: "zero" }`])};`,
      );
      this.emit(
        1,
        this.pick([
          `o${id}[key${id}] = 2;`,
          `o${id}[key${id}] = 2;`,
          `o${id}[key${id}] = { inner: 1 };`,
          `Object.defineProperty(o${id}, key${id}, { value: 2, enumerable: true, writable: true, configurable: true });`,
          ``,
        ]),
        held,
      );
      this.emit(1, `const c${id}${any} = ${copy};`);
      this.emit(
        1,
        `try { c${id}[${this.pick(["0", "5", "1", "4294967294", `"7"`])}] = "index"; note("stored"); } catch (error) { note("threw"); }`,
        `note(Reflect.set(c${id}, 9, 1)); note(Reflect.defineProperty(c${id}, 11, { value: 1, enumerable: true })); note(Object.isExtensible(c${id})); note(Object.isFrozen(c${id})); note(Stamps${number}.has(c${id})); note(Stamps${number}.has(o${id}));`,
        `try { c${id}.named = 1; c${id}.a = 5; delete c${id}[key${id}]; } catch (error) { note("threw"); }`,
        `note(Object.keys(c${id}).join()); note(Object.getOwnPropertyDescriptors(c${id})); note(Object.keys(o${id}).join());`,
      );
    }
    this.emit(1, `printValue("copies ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * Three or four files. One exports a function that answers closures over its arguments. A second has a binding at its top, exports what that function makes of the binding, and has a second
   * reader of the binding that the program never reaches: an export that nobody imports. The program imports what was made, uses the function once more itself, and calls what both answer.
   */
  sceneOfExportsThatNobodyImports() {
    const number = ++this.count;
    const any = this.typed("any");
    const ignore = this.isTypeScript ? "// @ts-ignore\n" : "";
    const extension = this.isTypeScript ? "ts" : "mjs";
    const tag = this.nameOfItsOwn("x");
    const [tables, prices, apart] = [
      `./tables-${tag}.${extension}`,
      `./prices-${tag}.${extension}`,
      `./held-${tag}.${extension}`,
    ];
    const [factory, use] = this.pick<[string, (made: string, key: string) => string[]]>([
      [
        `export function column${number}(name${any}, empty${any})${any} { return (load${any}, save${any}) => ({ read: () => load()[name] ?? empty, write: (next${any}) => save((row${any}) => ({ ...row, [name]: next(row[name] ?? empty) })) }); }`,
        (made, key) => [
          `{ const cell = ${made}(load${number}, save${number}); note(cell.read()); cell.write((each${any}) => [each, 1]); note(row${number}.${key}[0]); note(row${number}.${key}[1]); note(cell.read()); }`,
        ],
      ],
      [
        `export function column${number}(name${any}, empty${any})${any} { return (load${any}, save${any}) => ({ read: () => load()[name] ?? empty, write: (next${any}) => save((row${any}) => ({ ...row, [name]: next(row[name] ?? empty) })) }); }`,
        (made, key) => [
          `{ const cell = ${made}(load${number}, save${number}); note(cell.read()); cell.write((each${any}) => [each, 1]); note(row${number}.${key}[0]); note(row${number}.${key}[1]); note(cell.read()); }`,
        ],
      ],
      [
        `export const column${number} = (name${any}, empty${any})${any} => ({ read: () => empty, named: () => name, both: () => [name, empty] });`,
        made => [
          `note(${made}.read()); note(${made}.named()); note(${made}.both()[1]); note(${made}.read() === ${made}.both()[1]);`,
        ],
      ],
      [
        `export function column${number}(name${any}, empty${any})${any} { const seen${any} = []; return function (extra${any})${any} { seen.push(extra); return [name, empty, seen.length]; }; }`,
        made => [`note(${made}(1)[1]); note(${made}(2)[2]); note(${made}(3)[0]);`],
      ],
      [
        `export function column${number}(name${any}, empty${any})${any} { return class { static read() { return empty; } name = name; value = empty; }; }`,
        made => [`note(${made}.read()); note(new ${made}().value); note(new ${made}().name);`],
      ],
      [
        `export function* steps${number}(empty${any})${any} { yield empty; yield [empty]; }\nexport function column${number}(name${any}, empty${any})${any} { return () => steps${number}(empty); }`,
        made => [`for (const each of ${made}()) note(each);`],
      ],
    ]);
    const held = this.pick([
      `const held${number}${any} = [1, 2];`,
      `const held${number}${any} = [{}];`,
      `const held${number}${any} = new Map([["a", 1]]);`,
      `const held${number}${any} = new Set([1]);`,
      `const held${number}${any} = /x/g;`,
      `const held${number}${any} = () => 1;`,
      `const held${number}${any} = function () {};`,
      `const held${number}${any} = { low: {}, high: {} };`,
      `class held${number} { static low = {}; static high = {}; }`,
      `function held${number}() { return 1; }`,
      `const held${number}${any} = new Date(0);`,
      `const held${number}${any} = Symbol("s");`,
      `let held${number}${any} = [1, 2];`,
      `const held${number}${any} = new (class Kept { kept = 1; })();`,
    ]);
    const never = this.pick([
      `export function neverCalled${number}()${any} { return held${number}; }`,
      `export function neverCalled${number}()${any} { return held${number}; }`,
      `export const neverCalled${number} = ()${any} => held${number};`,
      `export const never${number} = { method()${any} { return held${number}; } };`,
      `export const never${number} = { get got()${any} { return held${number}; } };`,
      `export class Never${number} { read()${any} { return held${number}; } }`,
      `export class Never${number} { static read()${any} { return held${number}; } }`,
      `export function neverCalled${number}()${any} { return () => held${number}; }`,
      `export function neverCalled${number}(given${any} = held${number})${any} { return given; }`,
      `export { held${number} };`,
      `function hidden${number}()${any} { return held${number}; }\nexport function neverCalled${number}()${any} { return hidden${number}(); }`,
      ``,
    ]);
    const made = `export const prices${number}${any} = column${number}("prices", held${number});`;
    this.files.push([tables, factory + "\n"]);
    if (this.chance(20) && !never.startsWith("export {")) {
      this.files.push([apart, [held, `export { held${number} };`, never, ""].join("\n")]);
      this.files.push([
        prices,
        [
          `${ignore}import { column${number} } from "${tables}";`,
          `${ignore}import { held${number} } from "${apart}";`,
          this.chance(50) ? `export { held${number} } from "${apart}";` : "",
          made,
          "",
        ].join("\n"),
      ]);
    } else {
      const body = this.pick([
        [held, made, never],
        [held, made, never],
        [held, never, made],
      ]);
      this.files.push([prices, [`${ignore}import { column${number} } from "${tables}";`, ...body, ""].join("\n")]);
    }
    this.imports.push(
      `${ignore}import { prices${number} } from "${prices}";`,
      `${ignore}import { column${number} } from "${tables}";`,
    );
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "function" ? "function " + value.name + " " + Object.keys(value).join() : value instanceof Map ? "map " + [...value.keys()].join() : value instanceof Set ? "set " + [...value].join() : value instanceof RegExp || typeof value === "symbol" ? String(value) : JSON.stringify(value)) + ";"; }`,
      `let row${number}${any} = {};`,
      `const load${number} = ()${any} => row${number};`,
      `const save${number} = (change${any})${this.typed("void")} => { row${number} = change(row${number}); };`,
      `const names${number}${any} = column${number}("names", { first: 1 });`,
    );
    const [mine, theirs] = [use(`names${number}`, "names"), use(`prices${number}`, "prices")];
    this.emit(
      1,
      `try {`,
      ...(this.chance(50) ? [...mine, ...theirs] : [...theirs, ...mine]),
      `} catch (error) { note("threw"); }`,
    );
    this.emit(1, `printValue("exports ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * TypeScript. A field is born with the least that its type allows and never gets the rest of that type; then a value outside the type reaches it past the checker, and the object is looked at
   * in every way. Each case has a type and names of its own. In JavaScript there are no such types, and the scene is one of steps on an object.
   */
  sceneOfValuesOutsideTheTypeOfAField() {
    if (!this.isTypeScript) return this.sceneOfStepsOnOneObject();
    const number = ++this.count;
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value: unknown): void { out += (typeof value === "symbol" || typeof value === "bigint" ? typeof value + " " + String(value) : typeof value === "function" ? "function" : (JSON.stringify(value) ?? "undefined")) + ";"; }`,
    );
    for (let index = this.pick([2, 3, 3, 4]); index > 0; index--) {
      const id = `${number}_${index}`;
      const u = this.nameOfItsOwn("u");
      const [type, born] = this.pick<[string, string]>([
        ["number | undefined", "undefined"],
        ["number | undefined", "undefined"],
        ["number | null", "null"],
        ["boolean | undefined", "undefined"],
        ["1 | 2 | undefined", "undefined"],
        ["undefined", "undefined"],
        ["null", "null"],
        ["string | undefined", "undefined"],
        ["{ inner: number } | undefined", "undefined"],
        ["number[] | null", "null"],
        ["number", "3"],
        ["number", "1.5"],
        ["boolean", "true"],
      ]);
      const stored = this.pick([
        "null",
        "null",
        "undefined",
        "0",
        "1.5",
        `"text"`,
        "true",
        `Symbol("s")`,
        "{}",
        "[]",
        "10n",
        "() => 1",
        "NaN",
        "-0",
      ]);
      const way = this.pick([
        `Object.assign(v${id}, { ${u}: ${stored} });`,
        `Object.assign(v${id}, { ${u}: ${stored} });`,
        `Reflect.set(v${id}, "${u}", ${stored});`,
        `Object.defineProperty(v${id}, "${u}", { value: ${stored}, writable: true, enumerable: true, configurable: true });`,
        `(v${id} as any).${u} = ${stored};`,
        `(v${id} as any)["${u}"] = ${stored};`,
        `(function (given: { ${u}: unknown }): void { given.${u} = ${stored}; })(v${id});`,
        `v${id} = { ...v${id}, ...({ ${u}: ${stored} } as any) };`,
        `for (const [key, value] of Object.entries({ ${u}: ${stored} })) (v${id} as any)[key] = value;`,
      ]);
      this.emit(
        1,
        `interface R${id} { a: number; ${u}: ${type} }`,
        `let v${id}: R${id} = { a: 1, ${u}: ${born} };`,
        `note(v${id}.${u});`,
        way,
      );
      this.emit(
        1,
        `try { note(v${id}.${u}); note(typeof v${id}.${u}); note(v${id}.${u} === undefined); note(v${id}.${u} === null); note(v${id}.${u} == null); note(v${id}.${u} ?? "none"); note(v${id}.${u} ? "yes" : "no"); } catch (error) { note("threw"); }`,
        `try { note(v${id}); note([v${id}]); note({ v${id} }); } catch (error) { note("threw " + (error as any)?.name); }`,
        `try { note(Object.entries(v${id}).map(([key, value]) => key + ":" + typeof value).join()); const { ${u}: taken } = v${id}; note(taken); note({ ...v${id} }.${u}); note(Object.values(v${id}).length); } catch (error) { note("threw"); }`,
      );
    }
    this.emit(1, `printValue("fields ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * TypeScript. A value of a built-in that the build can follow by its name is declared as unknown, cast to a function type, and goes where an honest function goes too: a parameter, a variable,
   * a field, an element, an answer, a capture. There it is called, constructed, handed to map, compared and asked for its type. In JavaScript the scene is one of built-in callees.
   */
  sceneOfBuiltInValuesDeclaredAsFunctions() {
    if (!this.isTypeScript) return this.sceneOfBuiltInCallees();
    const number = ++this.count;
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value: unknown): void { out += (typeof value === "symbol" ? String(value) : typeof value === "function" ? "function" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : typeof value + " " + String(value)) + ";"; }`,
      `type F${number} = (n: number) => number;`,
    );
    for (let index = this.pick([2, 3, 3, 4]); index > 0; index--) {
      const id = `${number}_${index}`;
      const value = this.pick([
        "Symbol.iterator",
        "Symbol.iterator",
        "Symbol.asyncIterator",
        "Symbol.hasInstance",
        "Symbol.toPrimitive",
        "Symbol.toStringTag",
        "Symbol.species",
        "Symbol.unscopables",
        "Math.PI",
        "Number.EPSILON",
        "Number.MAX_SAFE_INTEGER",
        "Int8Array.BYTES_PER_ELEMENT",
        "Float64Array.BYTES_PER_ELEMENT",
        "Math",
        "JSON",
        "Reflect",
        "Array.prototype",
        "Object.prototype",
        "process.platform.length",
        "undefined",
        "null",
      ]);
      const declared = this.pick([
        `const held${id}: unknown = ${value};`,
        `const held${id}: unknown = ${value};`,
        `const held${id}: any = ${value};`,
        `let held${id}: unknown = ${value};`,
      ]);
      const honest = `(n: number): number => n + ${index}`;
      const cast = `held${id} as F${number}`;
      // What is done with the function stands INSIDE a function of its own, which meets an honest function first and the cast value second, each in a statement of its own.
      const done = (f: string) =>
        this.several(1, 3, () =>
          this.pick([
            `note(${f}(1));`,
            `note(${f}(1));`,
            `note(${f}(1));`,
            `note(new (${f} as any)(1));`,
            `note(${f}.call(null, 2));`,
            `note([1, 2].map(${f}).join());`,
            `note(Reflect.apply(${f}, undefined, [3]));`,
            `note(${f} === (${value} as unknown));`,
            `note(typeof ${f});`,
          ]),
        )
          .map(each => `try { ${each} } catch (error) { note("threw " + (error as any)?.name); }`)
          .join(" ");
      const steps = this.pick<string[]>([
        [`function uses${id}(p: F${number}): void { ${done("p")} }`, `uses${id}(${honest});`, `uses${id}(${cast});`],
        [`function uses${id}(p: F${number}): void { ${done("p")} }`, `uses${id}(${honest});`, `uses${id}(${cast});`],
        [
          `const uses${id} = (p: F${number}): void => { ${done("p")} };`,
          `uses${id}(${honest});`,
          `uses${id}(${cast});`,
        ],
        [
          `let kept${id}: F${number} = ${honest};`,
          `function uses${id}(): void { ${done(`kept${id}`)} }`,
          `uses${id}();`,
          `kept${id} = ${cast};`,
          `uses${id}();`,
        ],
        [
          `const box${id}: { f: F${number} } = { f: ${honest} };`,
          `function uses${id}(): void { ${done(`box${id}.f`)} }`,
          `uses${id}();`,
          `box${id}.f = ${cast};`,
          `uses${id}();`,
        ],
        [
          `const list${id}: F${number}[] = [${honest}, ${cast}];`,
          `function uses${id}(at: number): void { const f = list${id}[at]; ${done("f")} }`,
          `uses${id}(0);`,
          `uses${id}(1);`,
        ],
        [
          `function answers${id}(which: number): F${number} { if (which) return ${cast}; return ${honest}; }`,
          `function uses${id}(which: number): void { const f = answers${id}(which); ${done("f")} }`,
          `uses${id}(0);`,
          `uses${id}(1);`,
        ],
        [
          `function makes${id}(f: F${number}): () => void { return () => { ${done("f")} }; }`,
          `makes${id}(${honest})();`,
          `makes${id}(${cast})();`,
        ],
        [
          `class Uses${id} { constructor(public f: F${number}) {} run(): void { ${done("this.f")} } }`,
          `new Uses${id}(${honest}).run();`,
          `new Uses${id}(${cast}).run();`,
        ],
        [
          `async function uses${id}(p: F${number}): Promise<void> { ${done("p")} }`,
          `await uses${id}(${honest});`,
          `await uses${id}(${cast});`,
        ],
      ]);
      this.emit(1, declared, ...steps);
    }
    this.emit(1, `printValue("declared ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * An object of the host reaches a reader through hands that are not the program's: a listener, a callback of a built-in. The reader reads it under a key made at run time, or walks the own keys of
   * the objects above it and reads each one that is an accessor.
   */
  sceneOfHostObjectsReadUnderMadeKeys() {
    const number = ++this.count;
    const any = this.typed("any");
    const ignore = this.isTypeScript ? "// @ts-ignore\n" : "";
    this.imports.push(`${ignore}import { EventEmitter as Emitter${number} } from "node:events";`);
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "string" || typeof value === "boolean" ? typeof value + " " + value : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : typeof value) + ";"; }`,
    );
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [host, keys] = this.pick<[string, string[]]>([
        [`Buffer.from("abc")`, ["parent", "offset", "buffer", "byteLength", "length", "byteOffset"]],
        [`Buffer.from("abc")`, ["parent", "offset", "buffer", "byteLength", "length", "byteOffset"]],
        [
          `new URL("http://user@host.example:81/a/b?c=d#e")`,
          ["href", "origin", "protocol", "host", "port", "pathname", "search", "hash", "username", "searchParams"],
        ],
        [
          `new Request("http://host.example/a", { method: "POST", body: "b" })`,
          ["method", "url", "headers", "bodyUsed", "signal", "redirect", "mode"],
        ],
        [
          `new Response("b", { status: 201 })`,
          ["status", "ok", "statusText", "headers", "bodyUsed", "type", "redirected"],
        ],
        [
          `new Event("x", { cancelable: true })`,
          ["type", "cancelable", "bubbles", "defaultPrevented", "target", "eventPhase", "isTrusted"],
        ],
        [`new Blob(["abc"], { type: "text/plain" })`, ["size", "type"]],
        [`new AbortController().signal`, ["aborted", "reason", "onabort"]],
        [`new TextDecoder("utf-8", { fatal: true })`, ["encoding", "fatal", "ignoreBOM"]],
        [`new URLSearchParams("a=1&b=2")`, ["size"]],
        [`new Uint8Array([1, 2, 3])`, ["buffer", "byteLength", "byteOffset", "length"]],
        [`new Map([[1, 2]])`, ["size"]],
      ]);
      const key = this.pick(keys);
      const cut = Math.max(1, Math.floor(key.length / 2));
      const made = this.pick([
        `["${key.slice(0, cut)}", "${key.slice(cut)}"].join("")`,
        `["${key.slice(0, cut)}", "${key.slice(cut)}"].join("")`,
        `"${key.slice(0, cut)}".concat("${key.slice(cut)}")`,
        `String("${key}").slice(0)`,
        `JSON.parse('"${key}"')`,
      ]);
      const read = this.pick([
        `note(v[key${id}]);`,
        `note(v[key${id}]);`,
        `note(Reflect.get(v, key${id}));`,
        `{ const { [key${id}]: taken } = v; note(taken); }`,
        `note(key${id} in v); note(v[key${id}]); note(Object.hasOwn(v, key${id}));`,
        `for (let at = Object.getPrototypeOf(v); at && at !== Object.prototype; at = Object.getPrototypeOf(at)) for (const k of Reflect.ownKeys(at)) { if (typeof k === "string" && Object.getOwnPropertyDescriptor(at, k)?.get) { note(k); try { note(v[k]); } catch (error) { note("threw"); } } }`,
      ]);
      const reader = `(v${any})${this.typed("void")} => { try { ${read} } catch (error) { note("threw"); } }`;
      this.emit(1, `const key${id}${this.typed("string")} = ${made};`);
      this.emit(
        1,
        this.pick([
          `{ const e = new Emitter${number}(); e.on("x", ${reader}); e.emit("x", ${host}); }`,
          `{ const e = new Emitter${number}(); e.on("x", ${reader}); e.emit("x", ${host}); }`,
          `{ const e = new Emitter${number}(); e.once("x", ${reader}); e.emit("x", ${host}); }`,
          `{ const t = new EventTarget(); const held${any} = ${host}; t.addEventListener("x", () => (${reader})(held)); t.dispatchEvent(new Event("x")); }`,
          `[${host}].forEach(${reader});`,
          `Array.from([${host}], ${reader});`,
          `new Map([[1, ${host}]]).forEach(${reader});`,
          `(${reader})(${host});`,
          `Reflect.apply(${reader}, undefined, [${host}]);`,
          `[${host}].sort().map(${reader});`,
        ]),
      );
    }
    this.emit(1, `printValue("hosts ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * In one function: a handler that is an instance of a class, a proxy made with it, a trap stored on the handler AFTER the proxy is made, and an access through the proxy. The function is called
   * from a loop. Elsewhere in the program a proxy of a function is constructed.
   */
  sceneOfProxiesWhoseTrapsAreStoredLater() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)) + ";"; }`,
    );
    if (this.chance(75))
      this.emit(
        1,
        this.pick([
          `try { const constructible${any} = new Proxy(function () {}, { get: () => 1 }); const built${any} = new constructible(); note(built.size); } catch (error) { note("threw"); }`,
          `try { note(typeof new (new Proxy(function () {}, { get: () => 1 })${asAny})()); } catch (error) { note("threw"); }`,
          `try { note(typeof new (new Proxy(class {}, {})${asAny})()); } catch (error) { note("threw"); }`,
          `try { note(new (new Proxy(function (${this.isTypeScript ? "this: any" : ""}) { this.a = 1; }, { construct: (target${any}, given${any}) => ({ made: given.length }) })${asAny})(1, 2)); } catch (error) { note("threw"); }`,
        ]),
      );
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const name = this.nameOfItsOwn("c");
      const handler = this.pick([
        `new class {}`,
        `new class {}`,
        `new (class {})()`,
        `new (class Handler${id} {})()`,
        `new (class { kept = 1; })()`,
        `Object.create(null)`,
        `{}`,
        `new (class { get(target${any}, key${any})${any} { return "above"; } })()`,
        `Object.create({ has: () => false })`,
      ]);
      const [trap, access] = this.pick<[string, string]>([
        [`get = () => "trapped"`, `note(p.${name});`],
        [`get = () => "trapped"`, `note(p.${name});`],
        [
          `get = (target${any}, key${any}, receiver${any}) => String(key) + (receiver === p)`,
          `note(p.${name}); note(Reflect.get(p, "${name}", {}));`,
        ],
        [`has = () => true`, `note("${name}" in p); note("other" in p);`],
        [`has = () => false`, `note("other" in p); note(Reflect.has(p, "other"));`],
        [
          `set = (target${any}, key${any}, value${any}) => { target[key] = value + 1; return true; }`,
          `p.${name} = 1; note(target.${name});`,
        ],
        [`deleteProperty = () => true`, `note(delete p.${name}); note(target.${name});`],
        [
          `getOwnPropertyDescriptor = () => ({ value: "made", configurable: true, enumerable: true, writable: true })`,
          `note(Object.getOwnPropertyDescriptor(p, "${name}")); note(Object.hasOwn(p, "${name}"));`,
        ],
        [`ownKeys = () => ["${name}", "more"]`, `note(Reflect.ownKeys(p).join());`],
        [
          `getPrototypeOf = () => Array.prototype`,
          `note(p instanceof Array); note(Object.getPrototypeOf(p) === Array.prototype);`,
        ],
      ]);
      const before = this.chance(30) ? access : "";
      this.emit(
        1,
        `function uses${id}()${this.typed("void")} { const h${any} = ${handler}; const target${any} = { ${name}: "red" }; const p${any} = new Proxy(target, h); ${before} h.${trap}; ${access} }`,
      );
      this.emit(
        1,
        `try { for (let round = 0; round < ${this.pick([1, 2, 2, 5])}; round++) uses${id}(); } catch (error) { note("threw"); }`,
      );
    }
    this.emit(1, `printValue("traps ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A member that only a step of the language or a built-in ever uses, and that the program names nowhere else: the length of a list-like object that Array.prototype.values walks, the next() of a
   * generator that only a built-in steps. Beside it, in code that never runs, the same built-in can be given a proxy or what eval answers.
   */
  sceneOfMembersThatOnlyTheLanguageUses() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)) + ";"; }`,
      `const never${number} = Date.now() < 5;`,
    );
    for (let index = this.pick([2, 3, 3, 4]); index > 0; index--) {
      const id = `${number}_${index}`;
      if (this.chance(50)) {
        const length = this.pick([
          `2`,
          `count${id}`,
          `count${id}`,
          `{ valueOf() { note("valueOf"); return 2; } }`,
          `{ toString() { note("toString"); return "2"; } }`,
          `{ [Symbol.toPrimitive]() { note("toPrimitive"); return 2; } }`,
          `"2"`,
          `2.5`,
        ]);
        const like = this.pick([
          `{ 0: "a", 1: "b", 2: "c", length: ${length} }`,
          `{ 0: "a", 1: "b", 2: "c", get length() { note("length"); return ${length.startsWith("{") ? "2" : length}; } }`,
        ]);
        const walker = this.pick(["values", "values", "keys", "entries"]);
        this.emit(1, `let count${id}${any} = 2;`, `const like${id}${any} = ${like};`);
        this.emit(
          1,
          this.pick([
            `try { for (const each of Array.prototype.${walker}.call(like${id})) note(each); } catch (error) { note("threw"); }`,
            `try { note([...Array.prototype.${walker}.call(like${id})]); } catch (error) { note("threw"); }`,
            `try { like${id}[Symbol.iterator] = Array.prototype.${walker}; note([...like${id}]); } catch (error) { note("threw"); }`,
            `try { like${id}[Symbol.iterator] = Array.prototype.${walker}; const [first, second, third] = like${id}; note([first, second, third]); } catch (error) { note("threw"); }`,
            `try { const walk${id} = Array.prototype.${walker}.call(like${id}); note(walk${id}.next()); count${id} = 3; note(walk${id}.next()); note(walk${id}.next()); note(walk${id}.next()); } catch (error) { note("threw"); }`,
            `try { note(Array.from(Array.prototype.${walker}.call(like${id}))); } catch (error) { note("threw"); }`,
          ]),
        );
      } else {
        const texts = this.chance(25);
        const [a, b] = texts ? [`"a"`, `"b"`] : ["1", "2"];
        const source = this.pick([
          `(function* () { note("in"); yield ${a}; yield ${b}; note("end"); })()`,
          `(function* () { note("in"); yield ${a}; yield ${b}; note("end"); })()`,
          `{ *[Symbol.iterator]() { note("in"); yield ${a}; yield ${b}; } }`,
          `{ [Symbol.iterator]() { let at = 0; return { next() { note("next"); return at++ < 2 ? { value: ${a}, done: false } : { value: undefined, done: true }; }, return() { note("return"); return {}; } }; } }`,
          `new (class { *[Symbol.iterator]() { yield ${a}; yield ${b}; } })()`,
        ]);
        const native = (given: string) =>
          texts
            ? this.pick([
                `new Intl.ListFormat("en").format(${given})`,
                `new Set(${given}).size`,
                `Array.from(${given}).join()`,
              ])
            : this.pick([
                `new AggregateError(${given}).errors`,
                `new AggregateError(${given}).errors`,
                `Uint8Array.from(${given}).length`,
                `(Math${asAny}).sumPrecise(${given})`,
                `new Set(${given}).size`,
                `Array.from(${given})`,
                `new Float64Array(${given}).length`,
                `new WeakSet([...${given}].map(() => ({}))) instanceof WeakSet`,
                `Math.max(...${given})`,
              ]);
        const call = native(`source${id}`);
        this.emit(
          1,
          `const source${id}${any} = ${source};`,
          `try { note(${call}); } catch (error) { note("threw " + (error${asAny})?.name); }`,
        );
        if (this.chance(40))
          this.emit(
            1,
            `if (never${number}) { try { note(${call.replace(`source${id}`, this.pick([`new Proxy([], {})`, `(0, eval)("[]")`, `new Proxy(source${id}, {})`]))}); } catch (error) { note("threw"); } }`,
          );
      }
    }
    this.emit(1, `printValue("steps of the language ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * TypeScript. A file in a folder of its own, beside a tsconfig.json with an option that changes what a transpiler writes. In it a class below a base whose prototype has a setter, a getter or a member
   * that can't be written, with fields of the same names, a field under a key in brackets that only the run knows, and a field without a value. In JavaScript the scene is one of class factories.
   *
   * With `bun run` every file follows the tsconfig.json where Bun is started, and in an executable each file follows the one nearest to it. So run-batch.ts holds a program of this scene against the
   * executable that `bun build --compile` makes without --aot (hasATsconfigInAFolderOfItsOwn there).
   * The folder lies two deep: a tsconfig.json one folder below a program makes that folder the project that run-batch.ts checks in the program's place.
   */
  sceneOfFieldsUnderOptionsOfTheTranspiler() {
    if (!this.isTypeScript) return this.sceneOfClassesOutOfFactories();
    const number = ++this.count;
    const tag = this.nameOfItsOwn("o");
    const options = this.pick([
      `{ "useDefineForClassFields": false }`,
      `{ "useDefineForClassFields": false }`,
      `{ "useDefineForClassFields": false }`,
      `{ "useDefineForClassFields": true }`,
      `{ "target": "ES2020" }`,
      `{ "target": "ES2021", "useDefineForClassFields": true }`,
      `{ "target": "ESNext" }`,
      `{ "useDefineForClassFields": false, "experimentalDecorators": true }`,
      `{ "useDefineForClassFields": false, "verbatimModuleSyntax": true }`,
      `{}`,
    ]);
    const lines: string[] = [
      `let out = "";`,
      `function note(value: any): void { out += (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)) + ";"; }`,
    ];
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const above = this.pick([
        `Object.defineProperty(Base${id}.prototype, "y", { set(v) { note("setter ran " + v); }, configurable: true });`,
        `Object.defineProperty(Base${id}.prototype, "y", { set(v) { note("setter ran " + v); }, configurable: true });`,
        `Object.defineProperty(Base${id}.prototype, "y", { get() { return "got"; }, configurable: true });`,
        `Object.defineProperty(Base${id}.prototype, "y", { value: "fixed", writable: false, configurable: true });`,
        `Object.defineProperty(Base${id}.prototype, "opt", { set(v) { note("opt set " + v); }, configurable: true });`,
        `Object.defineProperty(Base${id}.prototype, "name", { set(v) { note("name set " + v); }, configurable: true });`,
      ]);
      // A key that a transpiler can work out ahead is left out: beside one, the executable built without --aot defines the fields whatever the tsconfig.json says, so there is nothing to hold the program against.
      const key = this.pick([
        `late${id}`,
        `late${id}`,
        "Symbol.iterator",
        `String("called")`,
        `late${id} + "r"`,
        `[late${id}].join()`,
      ]);
      lines.push(`let late${id} = "late";`, `class Base${id} {}`, above);
      lines.push(
        `// @ts-ignore`,
        `class D${id} extends Base${id} { ${this.pick([`[${key}] = 1; y = 2; opt?: number;`, `[${key}] = 1; y = 2; opt?: number;`, `y = 2; [${key}] = 1; opt?: number;`, `opt?: number; y = 2; [${key}] = 1;`, `[${key}] = 1; declare y: number; opt?: number;`, `static [${key}] = 1; y = 2; opt!: number;`, `[${key}]: number; y = 2;`, `y = 2; opt?: number;`, `y = 2; opt?: number;`, `opt?: number; y = 2; name = 1;`, `declare y: number; opt = 1;`])} }`,
      );
      lines.push(
        `try { const made${id}: any = new D${id}(); note(Reflect.ownKeys(made${id}).map(String).join("+")); note(made${id}.y); note(Object.prototype.hasOwnProperty.call(made${id}, "opt")); note(Reflect.ownKeys(D${id}).map(String).join("+")); } catch (error) { note("threw " + (error as any)?.name); }`,
      );
    }
    lines.push(`export const said${number} = out;`, "");
    this.files.push([`./options-${tag}/sources/tsconfig.json`, `{ "compilerOptions": ${options} }\n`]);
    this.files.push([`./options-${tag}/sources/part.ts`, lines.join("\n")]);
    this.imports.push(`// @ts-ignore\nimport { said${number} } from "./options-${tag}/sources/part.ts";`);
    this.lines.push(`printValue("options ${number}", said${number});`);
  }

  /**
   * TypeScript. Classes below a base whose prototype has a setter, a getter or a member that can't be written, with fields of the same names, a field without a value, and a field under a key in brackets
   * that a transpiler can work out ahead: a constant, a signed number, a sum of literals, a member of an enum. Whether the fields are assigned or defined goes by the tsconfig.json where Bun is started
   * (run-batch.ts, --options-of-the-project). In JavaScript the scene is one of class factories.
   */
  sceneOfFieldsBesideKeysThatAreWorkedOutAhead() {
    if (!this.isTypeScript) return this.sceneOfClassesOutOfFactories();
    const number = ++this.count;
    this.lines.push("{");
    // A constant is replaced by its value where its declaration stands first in its block.
    this.emit(
      1,
      `const KEY${number} = "name";`,
      `let out = "";`,
      `function note(value: any): void { out += (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)) + ";"; }`,
      `enum En${number} { A = "ea", C = 3 }`,
    );
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const above = this.pick([
        `Object.defineProperty(Base${id}.prototype, "y", { set(v) { note("setter ran " + v); }, configurable: true });`,
        `Object.defineProperty(Base${id}.prototype, "y", { set(v) { note("setter ran " + v); }, configurable: true });`,
        `Object.defineProperty(Base${id}.prototype, "y", { get() { return "got"; }, configurable: true });`,
        `Object.defineProperty(Base${id}.prototype, "y", { value: "fixed", writable: false, configurable: true });`,
        `Object.defineProperty(Base${id}.prototype, "opt", { set(v) { note("opt set " + v); }, configurable: true });`,
        `Object.defineProperty(Base${id}.prototype, "name", { set(v) { note("name set " + v); }, configurable: true });`,
      ]);
      const key = this.pick([
        `KEY${number}`,
        `KEY${number}`,
        "-1",
        "+1",
        "-0",
        "NaN",
        "Infinity",
        `("a")`,
        `"a" as string`,
        `"a"!`,
        "1 + 2",
        `"a" + "b"`,
        "`a${1}`",
        "typeof 1",
        "~1",
        `1 ? "a" : "b"`,
        `0 || "a"`,
        `(0, "a")`,
        `+"1"`,
        `"abc".length`,
        `"abc"[1]`,
        `-En${number}.C`,
        `En${number}.A`,
        "1n",
        "Symbol.iterator",
        `late${id}`,
        `String("called")`,
      ]);
      this.emit(1, `let late${id} = "late";`, `class Base${id} {}`, above);
      this.emit(
        1,
        `// @ts-ignore`,
        `class D${id} extends Base${id} { ${this.pick([`[${key}] = 1; y = 2; opt?: number;`, `[${key}] = 1; y = 2; opt?: number;`, `y = 2; [${key}] = 1; opt?: number;`, `opt?: number; y = 2; [${key}] = 1;`, `[${key}] = 1; declare y: number; opt?: number;`, `static [${key}] = 1; y = 2; opt!: number;`, `[${key}]: number; y = 2;`, `y = 2; opt?: number;`])} }`,
      );
      this.emit(
        1,
        `try { const made${id}: any = new D${id}(); note(Reflect.ownKeys(made${id}).map(String).join("+")); note(made${id}.y); note(Object.prototype.hasOwnProperty.call(made${id}, "opt")); note(Reflect.ownKeys(D${id}).map(String).join("+")); } catch (error) { note("threw " + (error as any)?.name); }`,
      );
    }
    this.emit(1, `printValue("fields ahead ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A member that is no function is called: with `?.(`, which asks only whether it is null or undefined, or with `(`. The member is a number, a text, a boolean, a symbol, a big integer, an object, null or
   * undefined. It is read by name, under a key that a list answers, or under one made at run time. The object is written out, or is a copy, by descriptors or by a spread, of a built-in object.
   */
  sceneOfCallsOfMembersThatAreNoFunctions() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "symbol" ? "symbol" : String(value)) + ";"; }`,
    );
    for (let index = this.pick([2, 3, 3, 4]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [made, name] = this.pick<[string, string]>([
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors(/a+/gi))`, "lastIndex"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors(/a+/gi))`, "lastIndex"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors([1, 2]))`, "length"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors([1, 2]))`, "0"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors("ab"))`, "length"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors("ab"))`, "1"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors(function two(a${any}, b${any}) {}))`, "length"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors(function two(a${any}, b${any}) {}))`, "name"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors(new Error("m")))`, "message"],
        [`Object.create(null, Object.getOwnPropertyDescriptors(/a+/gi))`, "lastIndex"],
        [`{ ...[7, 8] }`, "1"],
        [`{ ..."ab" }`, "0"],
        [`Object.assign({}, /a+/gi, { lastIndex: 0 })`, "lastIndex"],
        [
          `{ held: ${this.pick(["0", "1.5", `"t"`, "true", "false", "null", "undefined", "10n", `Symbol("s")`, "{}", "[]", "NaN", "-0"])} }`,
          "held",
        ],
        [
          `{ held: ${this.pick(["0", "1.5", `"t"`, "true", "false", "null", "undefined", "10n", `Symbol("s")`, "{}", "[]", "NaN", "-0"])} }`,
          "held",
        ],
        [`/a+/gi`, "lastIndex"],
        [`[1, 2]`, "length"],
        [`new Map([[1, 2]])`, "size"],
      ]);
      const key = this.pick([
        `["${name}", "other"][0]`,
        `["${name}", "other"][0]`,
        `["other", "${name}"][1]`,
        `"${name}"`,
        `["${name}"].join("")`,
        `String("${name}")`,
      ]);
      const isAName = /^[a-z]/i.test(name);
      const read = (object: string) =>
        this.pick([
          `${object}[key${id}]`,
          `${object}[key${id}]`,
          `${object}[key${id}]`,
          isAName ? `${object}.${name}` : `${object}[${name}]`,
          `${object}?.[key${id}]`,
        ]);
      // An optional chain can be neither the tag of a template nor, for `bun run`, what `new` constructs.
      const call = (member: string) =>
        this.pick([
          `${member}?.(0)`,
          `${member}?.(0)`,
          `${member}?.(0)`,
          `${member}?.()`,
          `${member}(0)`,
          `${member}?.(0)?.x`,
          `${member}?.call(null, 0)`,
          ...(member.includes("?.") ? [] : [`new (${member})(0)`, `${member}\`t\``]),
        ]);
      this.emit(1, `const key${id}${any} = ${key};`, `const make${id} = ()${any} => (${made});`);
      for (let use = this.pick([1, 2, 2]); use > 0; use--) {
        const object = this.pick([`make${id}()`, `make${id}()`, `held${id}_${use}`]);
        if (object.startsWith("held")) this.emit(1, `const held${id}_${use}${any} = make${id}();`);
        this.emit(
          1,
          `try { note(${this.pick(["", "", "["])}${call(read(object))}`.replace(/note\(\[(.*)$/, "note([$1]") +
            `); } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`,
        );
      }
    }
    this.emit(1, `printValue("calls of members ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A member comes to an object by a road through a built-in, and no statement of the program stores it under its name: descriptors handed on, JSON.parse, Object.fromEntries, a spread or Object.assign of a built-in
   * object, structuredClone, Reflect.set, the groups of a match, Object.groupBy. Then the program reads it, by name or under a key, and uses what it read in every way a value is used.
   */
  sceneOfMembersThatComeThroughBuiltIns() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "symbol" ? "symbol" : typeof value === "function" ? "function" : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value)) + ";"; }`,
    );
    for (let index = this.pick([2, 3, 3, 4]); index > 0; index--) {
      const id = `${number}_${index}`;
      const own = this.nameOfItsOwn("m");
      const value = this.pick([
        "0",
        "1",
        "-0",
        "1.5",
        "2147483648",
        `"t"`,
        `""`,
        "true",
        "false",
        "null",
        "[1, 2]",
        "{}",
        `{ inner: 1 }`,
      ]);
      const text = JSON.stringify(value === "-0" ? "0" : value.replace(/(\w+):/g, '"$1":'));
      const [made, name] = this.pick<[string, string]>([
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors(/a+/gi))`, "lastIndex"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors([7, 8]))`, "length"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors(function two(a${any}, b${any}) {}))`, "length"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors(function two(a${any}, b${any}) {}))`, "name"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors(new Error("m")))`, "message"],
        [`Object.defineProperties({}, Object.getOwnPropertyDescriptors("ab".match(/b/)))`, "index"],
        [`Object.create(null, Object.getOwnPropertyDescriptors(/a+/gi))`, "lastIndex"],
        [`JSON.parse('{ "${own}": ' + ${text} + " }")`, own],
        [`JSON.parse('{ "${own}": ' + ${text} + " }")`, own],
        [`Object.fromEntries([["${own}", ${value}]])`, own],
        [`Object.fromEntries(new Map([["${own}", ${value}]]${asAny}))`, own],
        [`Object.fromEntries(new URLSearchParams("${own}=1"))`, own],
        [`structuredClone(Object.fromEntries([["${own}", ${value}]]))`, own],
        [`Object.assign({}, Object.fromEntries([["${own}", ${value}]]))`, own],
        [`{ ...Object.fromEntries([["${own}", ${value}]]) }`, own],
        [`{ ...[7, 8] }`, "1"],
        [`{ ..."ab" }`, "0"],
        [`Object.assign({}, "ab")`, "1"],
        [`(() => { const o${any} = {}; Reflect.set(o, ["${own}"][0], ${value}); return o; })()`, own],
        [
          `(() => { const o${any} = {}; Reflect.defineProperty(o, ["${own}"][0], { value: ${value}, enumerable: true, writable: true, configurable: true }); return o; })()`,
          own,
        ],
        [`"ab".match(/(?<${own}>b)/)${this.isTypeScript ? "!" : ""}.groups`, own],
        [`(Object${asAny}).groupBy([1, 2, 3], (each${any}) => (each % 2 ? "${own}" : "even"))`, own],
        [`Object.getOwnPropertyDescriptor({ held: ${value} }, "held")`, "value"],
        [`Object.entries({ held: ${value} })[0]`, "1"],
        [
          `new Proxy({}, { get: (target${any}, key${any}) => (key === "${own}" ? ${value} : undefined), has: () => true })`,
          own,
        ],
      ]);
      const isAName = /^[a-z]/i.test(name);
      const key = this.pick([
        `["${name}", "other"][0]`,
        `["${name}", "other"][0]`,
        `"${name}"`,
        `["${name}"].join("")`,
        `String("${name}")`,
      ]);
      this.emit(1, `const key${id}${any} = ${key};`, `const make${id} = ()${any} => (${made});`);
      const read = (object: string) =>
        this.pick([
          `${object}[key${id}]`,
          `${object}[key${id}]`,
          isAName ? `${object}.${name}` : `${object}[${name}]`,
          `${object}?.[key${id}]`,
        ]);
      for (let use = this.pick([2, 3, 4]); use > 0; use--) {
        const o = `o${id}_${use}`;
        const used = this.pick([
          `note(typeof ${read(o)});`,
          `note(${read(o)});`,
          `note(${read(o)} + 1);`,
          `note(\`\${String(${read(o)})}\`);`,
          `note(${read(o)} === ${read(o)});`,
          `note(${read(o)} ?? "none");`,
          `note(${read(o)} || "falsy");`,
          `note(${read(o)} ? "yes" : "no");`,
          `note(!${read(o)});`,
          `note(-${read(o)});`,
          `note(${read(o)} | 0);`,
          `note(${read(o)} > 0);`,
          `note(${read(o)}?.length);`,
          `note(${read(o)}?.inner);`,
          `note(${read(o)}?.toString());`,
          `note([...${read(o)}]);`,
          `note({ ...${read(o)} });`,
          `note(key${id} in ${o});`,
          `note(Object.prototype.hasOwnProperty.call(${o}, key${id}));`,
          `note(Object.keys(${o}).join());`,
          `note(JSON.stringify(${o}));`,
          `{ const keys${any} = []; for (const each in ${o}) keys.push(each); note(keys.join()); }`,
          `{ const { [key${id}]: taken = "default" } = ${o}; note(taken); }`,
          `${o}[key${id}] ??= "filled"; note(${o}[key${id}]);`,
          `${o}[key${id}] ||= "filled"; note(${o}[key${id}]);`,
          `${o}[key${id}]++; note(${o}[key${id}]);`,
          `${o}[key${id}] += 1; note(${o}[key${id}]);`,
          `note(delete ${o}[key${id}]); note(${o}[key${id}]);`,
          `note(Array.isArray(${read(o)}));`,
          `note(Number.isInteger(${read(o)}));`,
          `note(Object.is(${read(o)}, -0));`,
          `note([${read(o)}].includes(0));`,
          `note(Math.max(${read(o)}, 1));`,
          `note((function (given${any}) { return typeof given; })(${read(o)}));`,
          `switch (${read(o)}) { case 0: note("zero"); break; case "t": note("text"); break; case null: note("null"); break; default: note("other"); }`,
        ]);
        this.emit(
          1,
          `try { const ${o}${any} = make${id}(); ${used} } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`,
        );
      }
    }
    this.emit(1, `printValue("through built-ins ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A built-in calls a function of the program and hands it arguments of its own making: the two functions of a promise's executor, the element, index and list of the walks over lists, maps, sets and typed arrays,
   * what replace, a reviver, a replacer, the traps of a proxy, a tagged template, Symbol.toPrimitive, toJSON and Symbol.split are given. The function uses one of them in every way a value is used.
   * The number in front of each is how many of its parameters may be used: the last one of the traps get, set and construct is the proxy itself, and a use of it would enter the trap again without end.
   */
  sceneOfWhatBuiltInsHandToCallbacks() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "symbol" ? "symbol" : typeof value === "function" ? "function" : typeof value === "object" && value !== null ? "object" : typeof value + " " + String(value)) + ";"; }`,
    );
    for (let index = this.pick([2, 3, 3, 4]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(letter => `${letter}${id}`);
      const given = (...names: string[]) => names.map(name => name + any).join(", ");
      const [count, around] = this.pick<[number, (body: string) => string]>([
        [2, body => `new Promise((${given(a, b)}) => { ${body} }).catch(() => {});`],
        [2, body => `new Promise((${given(a, b)}) => { ${body} }).catch(() => {});`],
        [2, body => `function executor${id}(${given(a, b)}) { ${body} } new Promise(executor${id}).catch(() => {});`],
        [
          3,
          body =>
            `(({ resolve: ${a}, reject: ${b}, promise: ${c} }${any}) => { ${c}.catch(() => {}); ${body} })((Promise${asAny}).withResolvers());`,
        ],
        [2, body => `(({ proxy: ${a}, revoke: ${b} }${any}) => { ${body} })(Proxy.revocable({}, {}));`],
        [3, body => `[1, 2].map((${given(a, b, c)}) => { ${body} });`],
        [3, body => `[{}, []].forEach((${given(a, b, c)}) => { ${body} });`],
        [2, body => `[3, 1].sort((${given(a, b)}) => { ${body} return 0; });`],
        [4, body => `[1, 2].reduce((${given(a, b, c, d)}) => { ${body} return ${a}; });`],
        [3, body => `[1].flatMap((${given(a, b, c)}) => { ${body} return []; });`],
        [3, body => `[..."ab"].findLast((${given(a, b, c)}) => { ${body} return false; });`],
        [2, body => `Array.from({ length: 1 }, (${given(a, b)}) => { ${body} });`],
        [5, body => `"abc".replace(/(?<g>b)/, (${given(a, b, c, d, e)}) => { ${body} return ""; });`],
        [3, body => `"aba".replaceAll("a", (${given(a, b, c)}) => { ${body} return ""; });`],
        [2, body => `JSON.parse('{ "k": [1] }', function (${given(a, b)}) { ${body} return ${b}; });`],
        [2, body => `JSON.stringify({ k: [1] }, function (${given(a, b)}) { ${body} return ${b}; });`],
        [1, body => `JSON.stringify({ k: { toJSON(${given(a)}) { ${body} return 1; } } });`],
        [3, body => `new Map([[1, {}]]${asAny}).forEach((${given(a, b, c)}) => { ${body} });`],
        [3, body => `new Set(["s"]).forEach((${given(a, b, c)}) => { ${body} });`],
        [3, body => `new Uint8Array(1).map((${given(a, b, c)}) => { ${body} return 0; });`],
        [2, body => `(Object${asAny}).groupBy([1], (${given(a, b)}) => { ${body} return "k"; });`],
        [2, body => `void (new Proxy({}, { get(${given(a, b, c)}) { ${body} return 1; } })${asAny}).key;`],
        [3, body => `(new Proxy({}, { set(${given(a, b, c, d)}) { ${body} return true; } })${asAny}).key = 1;`],
        [2, body => `void ("key" in new Proxy({}, { has(${given(a, b)}) { ${body} return true; } }));`],
        [3, body => `(new Proxy(function () {}, { apply(${given(a, b, c)}) { ${body} return 1; } })${asAny})(1, 2);`],
        [
          2,
          body =>
            `new (new Proxy(function () {}, { construct(${given(a, b, c)}) { ${body} return {}; } })${asAny})(1);`,
        ],
        [2, body => `((${a}${any}, ...${b}${any}) => { ${body} })\`x\${1}y\`;`],
        [1, body => `void +({ [Symbol.toPrimitive](${given(a)}) { ${body} return 1; } }${asAny});`],
        [2, body => `"a-b".split({ [Symbol.split](${given(a, b)}) { ${body} return []; } }${asAny});`],
        [2, body => `([1].values()${asAny}).map((${given(a, b)}) => { ${body} }).toArray();`],
        [
          1,
          body =>
            `{ const walk${id}${any} = (function* ()${any} { const ${a}${any} = yield 1; ${body} })(); walk${id}.next(); walk${id}.next({ sent: 1 }); }`,
        ],
        [2, body => `Reflect.apply(function (${given(a, b)}) { ${body} }, null, [() => 1, []]);`],
      ]);
      const p = this.pick([a, b, c, d, e].slice(0, count));
      const uses: string[] = [];
      for (let use = this.pick([1, 2, 2, 3]); use > 0; use--) {
        const tag = `${id}_${use}`;
        uses.push(
          this.pick([
            `note(typeof ${p});`,
            `note(${p});`,
            `{ class C${tag} extends ${p} {} const made = new C${tag}(); note(made); }`,
            `{ class C${tag} extends ${p} {} const made = new C${tag}(); note(made); }`,
            `{ class C${tag} extends ${p} {} note(C${tag}); }`,
            `{ class C${tag} extends ${p} { static s = 1; } note(C${tag}.s); }`,
            `{ const made = new ${p}(); note(made); }`,
            `{ const made = Reflect.construct(${p}, []); note(made); }`,
            `{ const made = Reflect.construct(Object, [], ${p}); note(made); }`,
            `{ const got = ${p}(); note(got); }`,
            `{ const got = ${p}?.(1); note(got); }`,
            `{ const got = ${p}.call(null, 1); note(got); }`,
            `note(${p}?.length);`,
            `note(${p}?.name);`,
            `note(typeof ${p}?.prototype);`,
            `note(${p} instanceof Function);`,
            `note(${p} instanceof Object);`,
            `note({} instanceof ${p});`,
            `note(Object.keys(Object(${p})).join());`,
            `note(Object.getOwnPropertyNames(Object(${p})).join());`,
            `note(Reflect.ownKeys(Object(${p})).length);`,
            `note(Array.isArray(${p}));`,
            `note(Object.isFrozen(${p}));`,
            `note(Object.prototype.toString.call(${p}));`,
            `note(${p}?.constructor?.name);`,
            `note(${p} == null);`,
            `note(typeof (${p} + 1));`,
            `note(${p}?.[0]);`,
            `note("raw" in Object(${p}));`,
            `{ const [first] = ${p}; note(first); }`,
            `{ const { length } = ${p}; note(length); }`,
            `{ ${p}.added = 1; note(${p}.added); }`,
            `{ const list = [...${p}]; note(list.length); }`,
            `{ const copy = { ...${p} }; note(Object.keys(copy).join()); }`,
            `switch (typeof ${p}) { case "function": note("f"); break; case "object": note("o"); break; case "number": note("n"); break; default: note("other"); }`,
          ]),
        );
      }
      const caught = `catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
      if (this.pick([true, true, false]))
        this.emit(1, `try { ${around(uses.map(use => `try { ${use} } ${caught}`).join(" "))} } ${caught}`);
      else this.emit(1, `try { ${around(uses.join(" "))} } ${caught}`);
    }
    this.emit(1, `printValue("handed to callbacks ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * Several literals of one interface hold one member in different ways: a value, a value that never arrives because the call or the construction that should give it throws, a getter, a getter and a setter,
   * a property defined afterwards. A method stands in front of the member or behind it. Each literal is made by a function of its own, and what comes back is read, listed and stored to.
   */
  sceneOfLiteralsOfOneInterfaceThatHoldAMemberInDifferentWays() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    const member = this.pick(["size", "held", "count", "at"]);
    const kind = this.pick<[string, string, string]>([
      ["number", "1", "2"],
      ["number", "1.5", "0"],
      ["string", `"a"`, `"b"`],
      ["boolean", "true", "false"],
      ["number[]", "[1]", "[2, 3]"],
    ]);
    const [type, value, other] = kind;
    const shape = `Held${number}`;
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "function" ? "function" : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value)) + ";"; }`,
    );
    if (this.isTypeScript) this.emit(1, `interface ${shape} { ${member}: ${type}; run(): number }`);
    this.emit(1, `function fail${number}()${this.typed("never")} { throw new Error("no"); }`);
    const returns = this.typed(shape);
    const forms = [
      `${member}: ${value}`,
      `${member}: ${other}`,
      `${member}: fail${number}()`,
      `${member}: fail${number}()`,
      `${member}: new (1${asAny})()`,
      `${member}: (()${this.typed("never")} => { throw new Error("no"); })()`,
      `${member}: (undefined${asAny}).x`,
      `get ${member}()${this.typed(type)} { return ${value}; }`,
      `get ${member}()${this.typed(type)} { return ${other}; }`,
      `get ${member}()${this.typed(type)} { return ${value}; }, set ${member}(given${this.typed(type)}) { note(given); }`,
      `get ${member}()${this.typed(type)} { return fail${number}(); }`,
    ];
    const names: string[] = [];
    for (let index = this.pick([2, 3, 3, 4]); index > 0; index--) {
      const name = `make${number}_${index}`;
      names.push(name);
      const form = this.pick(forms);
      const method = `run() { return ${index}; }`;
      const literal = this.pick([
        `{ ${form}, ${method} }`,
        `{ ${form}, ${method} }`,
        `{ ${method}, ${form} }`,
        `{ ${method}, ${form}, again() { return 0; } }${asAny}`,
      ]);
      if (this.pick([true, true, true, false])) this.emit(1, `function ${name}()${returns} { return ${literal}; }`);
      else
        this.emit(
          1,
          `function ${name}()${returns} { return Object.defineProperty({ ${method} }, "${member}", { get() { return ${value}; }, enumerable: true, configurable: true })${asAny}; }`,
        );
    }
    const caught = `catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
    for (const name of names) {
      const uses = [
        `note(made.${member});`,
        `note(made.run());`,
        `note(Object.keys(made).join());`,
        `note(typeof Object.getOwnPropertyDescriptor(made, "${member}")?.get);`,
        `made.${member} = ${other}; note(made.${member});`,
        `note({ ...made }.${member});`,
        `note(JSON.stringify(made));`,
        `{ const { ${member}: taken } = made; note(taken); }`,
      ];
      const drawn: string[] = [];
      for (let use = this.pick([2, 3, 4]); use > 0; use--) drawn.push(this.pick(uses));
      this.emit(1, `try { const made = ${name}(); ${drawn.join(" ")} } ${caught}`);
    }
    this.emit(1, `printValue("one member in different ways ${number}", out);`);
    this.lines.push("}");
  }
  /**
   * Statements stand behind tests of what kind of value a variable holds: Array.isArray, instanceof, typeof, a comparison of the constructor or of the prototype, a look for a member, a function that
   * answers for a type. The values are ones whose kind is not what their making suggests: a proxy of a list, a list without its prototype, an object made below the prototype of a class, a function
   * below another prototype, a wrapper of a primitive, a class that answers instanceof itself. They come to the test along several roads. What a statement behind a test does shows later: it stores
   * another kind of value into a record that is read at the end, calls a function that nothing else calls, or links the classes anew, and a later test asks for what an earlier statement stored.
   * In half of them the value is a record with a tag, written where it is handed over, and the tests ask for the tag: which statements can run is plain from the text. Among the statements are the
   * ways of writing a list of a length, a copy of all properties, a walk over entries, `using` and a look into a query, which are compiled in a way of their own.
   */
  sceneOfStatementsBehindTestsOfAKind() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "symbol" ? "symbol" : typeof value === "function" ? "function" : typeof value === "object" && value !== null ? "object" : String(value)) + ";"; }`,
    );
    const caught = `catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [C, D, F, H, s, v] = [`Kind${id}`, `Below${id}`, `Made${id}`, `Asked${id}`, `record${id}`, `value${id}`];
      const isExact = this.chance(50);
      const operand = isExact ? `${v}.value` : v;
      const tag = () =>
        this.pick(['"first"', '"first"', '"second"', '"second"', '"third"', "true", "false", "null", "0", "1", '""']);
      const tagged = () =>
        `{ kind: ${tag()}, value: ${this.pick(["1", "1", "2", "1.5", '"s"', "[1]", "{ inner: 1 }", "null", "() => 1", `new ${C}()`])}, tag: "${this.pick(["c", "f"])}" }`;
      const makers = [
        `[]`,
        `[1, 2]`,
        `new Array(2)`,
        `new Proxy([], {})`,
        `new Proxy([1], {})`,
        `Object.create(Array.prototype)`,
        `Object.setPrototypeOf([1], null)`,
        `Object.setPrototypeOf([1], ${C}.prototype)`,
        `new (class extends Array {})()`,
        `Reflect.construct(Array, [], ${C})`,
        `Reflect.construct(${C}, [], Array)`,
        `JSON.parse("[1]")`,
        `(function () { return arguments; })()`,
        `new Uint8Array(1)`,
        `Array.prototype`,
        `{ length: 1, 0: "a" }`,
        `"ab"`,
        `Object("ab")`,
        `new ${C}()`,
        `new ${C}()`,
        `new ${D}()`,
        `Object.create(${C}.prototype)`,
        `{ __proto__: ${C}.prototype }`,
        `Object.setPrototypeOf({ tag: "o" }, ${D}.prototype)`,
        `Reflect.construct(Object, [], ${C})`,
        `Reflect.construct(${C}, [], Object)`,
        `Reflect.construct(${D}, [], ${F})`,
        `new Proxy(new ${C}(), {})`,
        `Object.setPrototypeOf(new ${C}(), null)`,
        `Object.setPrototypeOf(new ${D}(), ${F}.prototype)`,
        `new (${F}${asAny})()`,
        `Object.create(null)`,
        `{}`,
        `{ constructor: ${C} }`,
        `{ tag: "c" }`,
        `${C}`,
        `${D}`,
        `${F}`,
        `${C}.prototype`,
        `() => 1`,
        `function () {}`,
        `class {}`,
        `(() => 1).bind(null)`,
        `${C}.bind(null)`,
        `new Proxy(function () {}, {})`,
        `new Proxy(${C}, {})`,
        `Object.setPrototypeOf(function () {}, null)`,
        `Object.setPrototypeOf(() => 1, ${C}.prototype)`,
        `async () => 1`,
        `function* () {}`,
        `Function.prototype`,
        `Math.max`,
        `Object.assign(() => 1, { tag: "c" })`,
        `new Error("e")`,
        `new TypeError("t")`,
        `Object.create(Error.prototype)`,
        `new (class extends Error {})("x")`,
        `{ message: "m", stack: "s" }`,
        `Object.setPrototypeOf(new Error("e"), ${C}.prototype)`,
        `new Proxy(new Error("e"), {})`,
        `new Map()`,
        `new Set([1])`,
        `Object.create(Map.prototype)`,
        `new (class extends Map {})()`,
        `/x/`,
        `new Date(0)`,
        `Promise.resolve(1)`,
        `{ then() {} }`,
        `null`,
        `undefined`,
        `0`,
        `-0`,
        `NaN`,
        `1`,
        `1.5`,
        `""`,
        `"s"`,
        `true`,
        `1n`,
        `Symbol("s")`,
        `Object(1)`,
        `Object(1n)`,
        `Object(Symbol("s"))`,
        `new Boolean(false)`,
        `new String("")`,
      ];
      const test = (x: string): string =>
        isExact && this.chance(75)
          ? this.pick([
              `${x}.kind === ${tag()}`,
              `${x}.kind === ${tag()}`,
              `${x}.kind === ${tag()}`,
              `${x}.kind !== ${tag()}`,
              `${x}.kind == ${tag()}`,
              `${x}.kind`,
              `!${x}.kind`,
              `typeof ${x}.kind === "${this.pick(["string", "boolean", "number", "object"])}"`,
              `typeof ${x}.value === "${this.pick(["number", "string", "object", "function"])}"`,
              `Array.isArray(${x}.value)`,
              `${x}.value instanceof ${C}`,
              `${x}.value === ${this.pick(["1", "2", "null", '"s"'])}`,
              `${x}.tag === "${this.pick(["c", "f", "o"])}"`,
              `"other" in ${x}`,
            ])
          : anyTest(x);
      const anyTest = (x: string): string =>
        this.pick([
          `Array.isArray(${x})`,
          `Array.isArray(${x})`,
          `${x} instanceof Array`,
          `${x} instanceof ${C}`,
          `${x} instanceof ${C}`,
          `${x} instanceof ${D}`,
          `${x} instanceof ${F}`,
          `${x} instanceof ${H}`,
          `${x} instanceof ${C}.bind(null)`,
          `${x} instanceof Object`,
          `${x} instanceof Function`,
          `${x} instanceof Error`,
          `${x} instanceof ${this.pick(["TypeError", "Map", "Promise", "String", "Number", "Uint8Array", "RegExp", "Date"])}`,
          `typeof ${x} === "function"`,
          `typeof ${x} === "function"`,
          `typeof ${x} === "object"`,
          `typeof ${x} === "object" && ${x} !== null`,
          `${x} !== null && typeof ${x} === "object"`,
          `typeof ${x} === "${this.pick(["string", "number", "undefined", "symbol", "bigint", "boolean"])}"`,
          `typeof ${x} !== "${this.pick(["object", "function", "string", "number"])}"`,
          `${x} === null`,
          `${x} == null`,
          `${x} != null`,
          `${x} === undefined`,
          `${x}?.constructor === ${this.pick([C, D, "Array", "Object", "Function"])}`,
          `${this.pick([C, D, F, "Array", "Function", "Error"])}.prototype.isPrototypeOf(${x})`,
          `Object.getPrototypeOf(Object(${x})) === ${this.pick([`${C}.prototype`, `${D}.prototype`, "Array.prototype", "Object.prototype", "Function.prototype", "null"])}`,
          `Object.prototype.toString.call(${x}) === "[object ${this.pick(["Array", "Function", "Error", "Object", "String"])}]"`,
          `"${this.pick(["tag", "below", "length", "message"])}" in Object(${x})`,
          `Symbol.iterator in Object(${x})`,
          `Object.hasOwn(Object(${x}), "${this.pick(["tag", "length", "prototype"])}")`,
          `Reflect.has(Object(${x}), "${this.pick(["tag", "below", "push"])}")`,
          `${x}?.tag === "${this.pick(["c", "f", "o"])}"`,
          `typeof ${x}?.${this.pick(["then", "push", "call", "get"])} === "function"`,
          `typeof ${x}?.[Symbol.iterator] === "function"`,
          `ArrayBuffer.isView(${x})`,
          `Number.isInteger(${x})`,
          `Number.isNaN(${x})`,
          `Object.is(${x}, -0)`,
          `${x} === Object(${x})`,
          `(Error${asAny}).isError?.(${x}) === true`,
          `${x}`,
          `!${x}`,
          `is${id}(${x})`,
          `is${id}(${x})`,
          `${s}.count ${this.pick(["===", ">", "<", "!=="])} ${this.pick([0, 1, 2])}`,
          `typeof ${s}.m === "${this.pick(["number", "string", "object", "function", "undefined"])}"`,
          `${s}.m === ${this.pick(["0", "undefined", "null", '"text"'])}`,
          `Array.isArray(${s}.${this.pick(["m", "list"])})`,
          `${s}.m instanceof ${this.pick([C, D, F])}`,
          `${s}.list?.length > ${this.pick([0, 1])}`,
          `"${this.pick(["m", "added", "only", "inherited"])}" in ${s}`,
          `held${id} ${this.pick(["===", "!=="])} undefined`,
          `held${id} instanceof ${this.pick([C, "Array", "Function"])}`,
          `new ${D}() instanceof ${F}`,
        ]);
      const builtIn = (): string =>
        this.pick([
          `new Array(3).fill(${operand})`,
          `new Array${this.isTypeScript ? "<number>" : ""}(3).fill(${operand})`,
          `Array.from({ length: 2 }, () => ${operand})`,
          `Array.of(${operand}, ${operand})`,
          `[${operand}].concat(${operand})`,
          `[1, 2].map(() => ${operand})`,
          `[1, 2].includes(${operand})`,
          `[1, 2].indexOf(${operand})`,
          `[${operand}, ${operand}].join("-")`,
          `Array.prototype.slice.call(Object(${operand}))`,
          `Object.keys(Object(${operand}))`,
          `Object.entries(Object(${operand})).length`,
          `Object.assign({}, ${operand})`,
          `Object.freeze([${operand}])`,
          `Reflect.ownKeys(Object(${operand})).length`,
          `new Map([[${operand}, ${operand}]])`,
          `new Set([${operand}]).size`,
          `new Uint8Array(2).fill(${operand})`,
          `new Error(${operand})`,
          `Math.max(${operand}, 1)`,
          `Math.floor(${operand})`,
          `Number(${operand})`,
          `parseInt(${operand})`,
          `String(${operand}).padStart(3)`,
          `String(${operand}).length`,
          `"ab".includes(${operand})`,
          `"ab".repeat(${operand}?.length ?? 1)`,
          `JSON.stringify(${operand})`,
          `${operand}.toString()`,
          `${operand}.length`,
          `${operand}.tag.toUpperCase()`,
          `${operand}.map((each${any}) => each)`,
          `${operand}.call(null)`,
          `new ${operand}()`,
          `[...${operand}]`,
          `{ ...${operand} }`,
          `Promise.resolve(${operand})`,
          `Symbol.for(String(${operand}))`,
          `structuredClone(${s}.count)`,
          `Array.from({ length: 2 })`,
          `Array.from({ length: 2 }, (_, at) => [${operand}, at])`,
          `Array.from({ length: ${operand} })`,
          `Array(2).fill(${operand})`,
          `Array(${operand}).fill(0)`,
          `new Array(2).fill(${operand}).map((each${any}, at${any}) => at)`,
          `Array(3).fill(0).map(() => ${operand})`,
          `Object.defineProperties({}, Object.getOwnPropertyDescriptors(Object(${operand})))`,
          `(() => { let sum = 0; for (const [key, each] of Object.entries(Object(${operand}))) sum += key.length + String(each).length; return sum; })()`,
          `(() => { using kept = { [Symbol.dispose]() { note("disposed"); } }; return ${operand}; })()`,
          `new URLSearchParams("a=1&b=2").get(String(${operand}))`,
          `new URLSearchParams("a=1&b=2").has("a")`,
          `[...new URLSearchParams("a=1&b=2").keys()].join()`,
          `[...new URLSearchParams("a=1&b=2").values()].join()`,
          `[...new URLSearchParams("a=1&b=2")].length`,
          `new URL("http://h/p?a=1").searchParams.get("a")`,
          `new URL("/p", "http://h").pathname`,
          `new URL("/p?" + ${operand}, new URL("http://h/q")).search`,
          `new Headers({ a: "1" }).get("a")`,
        ]);
      const effect = (): string =>
        this.pick([
          `${s}.m = ${v};`,
          `${s}.m = ${v};`,
          `${s}.m = ${this.pick(['"text"', "1.5", "null", `[${v}]`, `{ inner: ${v} }`, `new ${D}()`, `() => ${v}`])};`,
          `${s}.m = ${builtIn()};`,
          `${s}.m = ${builtIn()};`,
          `${s}.m = ${builtIn()};`,
          `note(${builtIn()});`,
          `${s}.list.push(${builtIn()});`,
          `${s}.list.push(${v});`,
          `${s}.list = ${this.pick(['"none"', "null", `[${v}, ${v}]`])};`,
          `${s}.list.length = 0;`,
          `${s}.count++;`,
          `${s}.count++;`,
          `${s}.count += 0.5;`,
          `${s}.count = "n" + ${s}.count;`,
          `delete ${s}.m;`,
          `${s}.added = typeof ${v};`,
          `Object.defineProperty(${s}, "m", { get() { return "got"; }, configurable: true });`,
          `Object.setPrototypeOf(${s}, { inherited: "i" });`,
          `Object.freeze(${s});`,
          `only${id}();`,
          `only${id}();`,
          `${s}.call = () => "called";`,
          `${F}.prototype = ${C}.prototype;`,
          `Object.setPrototypeOf(${D}.prototype, ${F}.prototype);`,
          `Object.setPrototypeOf(${D}, ${F});`,
          `held${id} = ${v};`,
          `held${id} = ${v};`,
          `${s} = { m: "another", list: [], count: 0 };`,
          `throw new ${this.pick([C, D])}();`,
          `return "early";`,
          `note("here");`,
        ]);
      const guarded = (): string => {
        const [t, u] = [test(v), test(v)];
        return this.pick([
          () => `if (${t}) { ${effect()} }`,
          () => `if (${t}) { ${effect()} }`,
          () => `if (${t}) { ${effect()} ${effect()} }`,
          () => `if (!(${t})) { ${effect()} }`,
          () => `if (${t}) { ${effect()} } else { ${effect()} }`,
          () => `if (${t}) { ${effect()} } else if (${u}) { ${effect()} } else { ${effect()} }`,
          () => `if (!(${t})) return "not"; ${effect()}`,
          () => `if (${t}) return "is"; ${effect()}`,
          () =>
            `switch (true) { case ${t}: ${effect().replace(/^return .*/, `note("case");`)} break; case ${u}: ${effect().replace(/^return .*/, `note("case");`)} break; default: note("neither"); }`,
          () =>
            `switch (${v}?.kind) { case ${tag()}: ${effect().replace(/^return .*/, `note("case");`)} break; case ${tag()}: ${effect().replace(/^return .*/, `note("case");`)} break; default: ${effect().replace(/^return .*/, `note("neither");`)} }`,
          () =>
            `switch (typeof ${operand}) { case "${this.pick(["function", "object", "number"])}": ${effect().replace(/^return .*/, `note("case");`)} break; case "string": ${effect().replace(/^return .*/, `note("case");`)} break; default: note("neither"); }`,
          () => `note((${t}) ? ${builtIn()} : (${u}) ? ${builtIn()} : ${builtIn()});`,
          () => `for (; ${t}; ) { ${effect()} break; }`,
          () => `while (${t}) { ${effect()} break; }`,
          () => `if (${t}) { if (${u}) { ${effect()} } else { ${effect()} } }`,
          () => `if ((${t}) && (${u})) { ${effect()} }`,
          () => `if ((${t}) || (${u})) { ${effect()} }`,
          () => `if ((${t}) && !(${u})) { ${effect()} }`,
          () => `{ const answer = ${t}; if (answer) { ${effect()} } }`,
          () => `{ const answer = ${t}; if (!answer) { ${effect()} } else { ${effect()} } }`,
          () => `note((${t}) ? "yes" : "no");`,
          () => `(${t}) && only${id}();`,
          () => `(${t}) || only${id}();`,
          () => `try { if (${t}) throw ${v}; } catch (thrown) { ${effect().replace(/^throw .*/, `note("caught");`)} }`,
        ])();
      };
      const parameter = this.isTypeScript
        ? `${v}: ${this.pick(["any", "any", "unknown", "object | null | undefined", `${C} | unknown[] | string | null`, `${C}`, "unknown[]", "Function"])}`
        : v;
      const predicate = this.isTypeScript
        ? `function is${id}(x: any): x is ${this.pick([C, D, "unknown[]", "Function", "string"])} { return ${test("x").replaceAll(`is${id}(x)`, "Array.isArray(x)")}; }`
        : `function is${id}(x) { return ${test("x").replaceAll(`is${id}(x)`, "Array.isArray(x)")}; }`;
      this.emit(
        1,
        `class ${C} { tag = "c"; }`,
        `class ${D} extends ${C} { below = 1; }`,
        `function ${F}(${this.isTypeScript ? "this: any" : ""}) { this.tag = "f"; }`,
        `class ${H} { static [Symbol.hasInstance](x${any}) { return ${this.pick(["x === 1", "Array.isArray(x)", 'typeof x === "string"', "true", "false", 'x?.tag === "c"', `x instanceof ${C}`])}; } }`,
        `let ${s}${any} = { m: 0, list: [], count: 0 };`,
        `let held${id}${any};`,
        `function only${id}() { ${s}.only = ${this.pick(['"ran"', `(${s}.only ?? 0) + 1`, `new ${C}()`])}; }`,
        predicate,
        `function sort${id}(${parameter})${any} { ${Array.from({ length: this.pick([1, 2, 2, 3, 4]) }, guarded).join(" ")} return "end"; }`,
      );
      for (let call = isExact ? this.pick([1, 1, 2, 3]) : this.pick([2, 3, 4, 5, 6]); call > 0; call--) {
        const made = isExact ? tagged() : this.pick(makers);
        const m = this.isTypeScript ? `(${made} as any)` : `(${made})`;
        const sort = `sort${id}`;
        const asked = this.pick([
          ...(isExact ? Array(20).fill(`note(${sort}(${m}));`) : []),
          ...(isExact
            ? Array(6).fill(
                `{ const written${any} = ${m}; for (let turn = 0; turn < 3; turn++) note(${sort}(written)); }`,
              )
            : []),
          `note(${sort}(${m}));`,
          `note(${sort}(${m}));`,
          `note(${sort}(${m}));`,
          `[${m}].forEach(each => note(${sort}(each)));`,
          `note(${sort}.call(null, ${m}));`,
          `note(Reflect.apply(${sort}, null, [${m}]));`,
          `note(${sort}(...([${m}]${asAny})));`,
          `{ const box = { inside: ${m} }; note(${sort}(box.inside)); }`,
          `{ const list = [0, ${m}]; note(${sort}(list[1])); }`,
          `{ const list = [${m}]; note(${sort}(list.pop())); }`,
          `note(${sort}(new Map([["k", ${m}]]).get("k")));`,
          `note(${sort}((() => ${m})()));`,
          `note(${sort}(JSON.parse("[0]").map(() => ${m})[0]));`,
          `{ let late${any}; const set = () => { late = ${m}; }; set(); note(${sort}(late)); }`,
          `note(${sort}(Object.values({ inside: ${m} })[0]));`,
          `note(${sort}([${m}].find(() => true)));`,
          `note(${sort}((function* ()${any} { yield ${m}; })().next().value));`,
          `note(${sort}({ get inside() { return ${m}; } }.inside));`,
          `note(${sort}(new Proxy({ inside: ${m} }, {}).inside));`,
          `{ const [first = ${m}] = []${asAny}; note(${sort}(first)); }`,
          `note(${sort}(held${id}));`,
          `note(${sort}(${s}.m));`,
          `note(${sort}(${s}));`,
        ]);
        this.emit(1, `try { ${asked} } ${caught}`);
      }
      const reads = [
        `note(${s}.m);`,
        `note(typeof ${s}.m);`,
        `note(${s}.m + 1);`,
        `note(${s}.list?.length);`,
        `note(${s}.count);`,
        `note(${s}.count + 1);`,
        `note(Object.keys(${s}).join());`,
        `note(${s}.added);`,
        `note(${s}.inherited);`,
        `note(${s}.only);`,
        `note(${s}.call?.());`,
        `note(held${id});`,
        `note(Array.isArray(held${id}));`,
        `note(held${id} instanceof ${C});`,
        `note(new ${D}() instanceof ${F});`,
        `note(new (${F}${asAny})() instanceof ${C});`,
        `note(${s}.m instanceof ${C});`,
        `note(${s}.m?.tag);`,
        `note(Object.isFrozen(${s}));`,
      ];
      for (let read = this.pick([4, 6, 8, 10]); read > 0; read--) this.emit(1, `try { ${this.pick(reads)} } ${caught}`);
    }
    this.emit(1, `printValue("behind tests of a kind ${number}", out);`);
    this.lines.push("}");
  }
}

/**
 * `text` with one to three scenes of ordinary code. In six programs of ten they are the whole program: what the compiler knows about a function of the library depends on all its callers.
 * What is drawn depends on `text` alone.
 */
export function writeOrdinaryScenes(text: string, isTypeScript: boolean, only?: string) {
  const [program, ...otherFiles] = text.split(/^(?=\/\/ @filename: )/m);
  const first = "const printValue = console.log;\n";
  if (!program.startsWith(first)) return text;
  const random = randomFrom("ordinary" + text);
  const scenes = new Scenes(random, isTypeScript);
  for (let count = scenes.pick([1, 1, 1, 2, 2, 3]); count > 0; count--)
    if (only) (scenes as unknown as Record<string, () => void>)[only]();
    else
      scenes.pick([
        () => scenes.sceneOfParsedData(),
        () => scenes.sceneOfParsedData(),
        () => scenes.sceneOfWalks(),
        () => scenes.sceneOfWalks(),
        () => scenes.sceneOfIdioms(),
        () => scenes.sceneOfStatementsBehindTestsOfAKind(),
        () => scenes.sceneOfStatementsBehindTestsOfAKind(),
        () => scenes.sceneOfStatementsBehindTestsOfAKind(),
        () => scenes.sceneOfStatementsBehindTestsOfAKind(),
        () => scenes.sceneOfStatementsBehindTestsOfAKind(),
        () => scenes.sceneOfLiteralsOfOneInterfaceThatHoldAMemberInDifferentWays(),
        () => scenes.sceneOfLiteralsOfOneInterfaceThatHoldAMemberInDifferentWays(),
        () => scenes.sceneOfLiteralsOfOneInterfaceThatHoldAMemberInDifferentWays(),
        () => scenes.sceneOfLiteralsOfOneInterfaceThatHoldAMemberInDifferentWays(),
        () => scenes.sceneOfLiteralsOfOneInterfaceThatHoldAMemberInDifferentWays(),
        () => scenes.sceneOfWhatBuiltInsHandToCallbacks(),
        () => scenes.sceneOfWhatBuiltInsHandToCallbacks(),
        () => scenes.sceneOfWhatBuiltInsHandToCallbacks(),
        () => scenes.sceneOfWhatBuiltInsHandToCallbacks(),
        () => scenes.sceneOfWhatBuiltInsHandToCallbacks(),
        () => scenes.sceneOfMembersThatComeThroughBuiltIns(),
        () => scenes.sceneOfMembersThatComeThroughBuiltIns(),
        () => scenes.sceneOfMembersThatComeThroughBuiltIns(),
        () => scenes.sceneOfMembersThatComeThroughBuiltIns(),
        () => scenes.sceneOfMembersThatComeThroughBuiltIns(),
        () => scenes.sceneOfCallsOfMembersThatAreNoFunctions(),
        () => scenes.sceneOfCallsOfMembersThatAreNoFunctions(),
        () => scenes.sceneOfCallsOfMembersThatAreNoFunctions(),
        () => scenes.sceneOfCallsOfMembersThatAreNoFunctions(),
        () => scenes.sceneOfFieldsBesideKeysThatAreWorkedOutAhead(),
        () => scenes.sceneOfFieldsBesideKeysThatAreWorkedOutAhead(),
        () => scenes.sceneOfFieldsBesideKeysThatAreWorkedOutAhead(),
        () => scenes.sceneOfFieldsUnderOptionsOfTheTranspiler(),
        () => scenes.sceneOfFieldsUnderOptionsOfTheTranspiler(),
        () => scenes.sceneOfFieldsUnderOptionsOfTheTranspiler(),
        () => scenes.sceneOfProxiesWhoseTrapsAreStoredLater(),
        () => scenes.sceneOfProxiesWhoseTrapsAreStoredLater(),
        () => scenes.sceneOfProxiesWhoseTrapsAreStoredLater(),
        () => scenes.sceneOfProxiesWhoseTrapsAreStoredLater(),
        () => scenes.sceneOfMembersThatOnlyTheLanguageUses(),
        () => scenes.sceneOfMembersThatOnlyTheLanguageUses(),
        () => scenes.sceneOfMembersThatOnlyTheLanguageUses(),
        () => scenes.sceneOfMembersThatOnlyTheLanguageUses(),
        () => scenes.sceneOfValuesOutsideTheTypeOfAField(),
        () => scenes.sceneOfValuesOutsideTheTypeOfAField(),
        () => scenes.sceneOfValuesOutsideTheTypeOfAField(),
        () => scenes.sceneOfValuesOutsideTheTypeOfAField(),
        () => scenes.sceneOfBuiltInValuesDeclaredAsFunctions(),
        () => scenes.sceneOfBuiltInValuesDeclaredAsFunctions(),
        () => scenes.sceneOfBuiltInValuesDeclaredAsFunctions(),
        () => scenes.sceneOfBuiltInValuesDeclaredAsFunctions(),
        () => scenes.sceneOfHostObjectsReadUnderMadeKeys(),
        () => scenes.sceneOfHostObjectsReadUnderMadeKeys(),
        () => scenes.sceneOfHostObjectsReadUnderMadeKeys(),
        () => scenes.sceneOfHostObjectsReadUnderMadeKeys(),
        () => scenes.sceneOfExportsThatNobodyImports(),
        () => scenes.sceneOfExportsThatNobodyImports(),
        () => scenes.sceneOfExportsThatNobodyImports(),
        () => scenes.sceneOfExportsThatNobodyImports(),
        () => scenes.sceneOfExportsThatNobodyImports(),
        () => scenes.sceneOfExportsThatNobodyImports(),
        () => scenes.sceneOfForInOverManyIndexKeys(),
        () => scenes.sceneOfForInOverManyIndexKeys(),
        () => scenes.sceneOfForInOverManyIndexKeys(),
        () => scenes.sceneOfForInOverManyIndexKeys(),
        () => scenes.sceneOfCopiesOfRecordsThatMayNotGrow(),
        () => scenes.sceneOfCopiesOfRecordsThatMayNotGrow(),
        () => scenes.sceneOfCopiesOfRecordsThatMayNotGrow(),
        () => scenes.sceneOfCopiesOfRecordsThatMayNotGrow(),
        () => scenes.sceneOfConstantsWorkedOutAheadOfEffects(),
        () => scenes.sceneOfConstantsWorkedOutAheadOfEffects(),
        () => scenes.sceneOfConstantsWorkedOutAheadOfEffects(),
        () => scenes.sceneOfConstantsWorkedOutAheadOfEffects(),
        () => scenes.sceneOfConstantsWorkedOutAheadOfEffects(),
        () => scenes.sceneOfElementsStoredAndReadAgain(),
        () => scenes.sceneOfElementsStoredAndReadAgain(),
        () => scenes.sceneOfElementsStoredAndReadAgain(),
        () => scenes.sceneOfElementsStoredAndReadAgain(),
        () => scenes.sceneOfElementsStoredAndReadAgain(),
        () => scenes.sceneOfAFileUsedOnlyForItsTypes(),
        () => scenes.sceneOfAFileUsedOnlyForItsTypes(),
        () => scenes.sceneOfAFileUsedOnlyForItsTypes(),
        () => scenes.sceneOfAFileUsedOnlyForItsTypes(),
        () => scenes.sceneOfClassesOutOfFactories(),
        () => scenes.sceneOfClassesOutOfFactories(),
        () => scenes.sceneOfClassesOutOfFactories(),
        () => scenes.sceneOfClassesOutOfFactories(),
        () => scenes.sceneOfClassesOutOfFactories(),
        () => scenes.sceneOfClassesOutOfFactories(),
        () => scenes.sceneOfNativeStoresOverFunctions(),
        () => scenes.sceneOfNativeStoresOverFunctions(),
        () => scenes.sceneOfNativeStoresOverFunctions(),
        () => scenes.sceneOfNativeStoresOverFunctions(),
        () => scenes.sceneOfNativeStoresOverFunctions(),
        () => scenes.sceneOfASmallPackage(),
        () => scenes.sceneOfASmallPackage(),
        () => scenes.sceneOfASmallPackage(),
        () => scenes.sceneOfASmallPackage(),
        () => scenes.sceneOfASmallPackage(),
        () => scenes.sceneOfStepsOnOneObject(),
        () => scenes.sceneOfStepsOnOneObject(),
        () => scenes.sceneOfStepsOnOneObject(),
        () => scenes.sceneOfStepsOnOneObject(),
        () => scenes.sceneOfStepsOnOneObject(),
        () => scenes.sceneOfStepsOnOneObject(),
        () => scenes.sceneOfPresenceBehindStores(),
        () => scenes.sceneOfPresenceBehindStores(),
        () => scenes.sceneOfPresenceBehindStores(),
        () => scenes.sceneOfMembersOverSpreads(),
        () => scenes.sceneOfMembersOverSpreads(),
        () => scenes.sceneOfMembersOverSpreads(),
        () => scenes.sceneOfOnePlaceForSeveralKinds(),
        () => scenes.sceneOfOnePlaceForSeveralKinds(),
        () => scenes.sceneOfOnePlaceForSeveralKinds(),
        () => scenes.sceneOfBuiltInCallees(),
        () => scenes.sceneOfBuiltInCallees(),
        () => scenes.sceneOfBuiltInCallees(),
        () => scenes.sceneOfCalls(),
        () => scenes.sceneOfCalls(),
        () => scenes.sceneOfOperatorsOnPairs(),
        () => scenes.sceneOfOperatorsOnPairs(),
        () => scenes.sceneOfAssignmentsToPlaces(),
        () => scenes.sceneOfAssignmentsToPlaces(),
        () => scenes.sceneOfKeysInVariables(),
        () => scenes.sceneOfKeysInVariables(),
        () => scenes.sceneOfChangesInTheMiddle(),
        () => scenes.sceneOfChangesInTheMiddle(),
        () => scenes.sceneOfNamespaces(Bun.hash.crc32(text).toString(36)),
      ])();
  const written = [...scenes.imports, ...scenes.lines].join("\n") + "\n";
  const files = scenes.files.map(([name, content]) => `// @filename: ${name}\n${content}`).join("");
  if (scenes.chance(60)) return first + written + "export {};\n" + files;
  // In front of the lines at the end that print each variable.
  const lines = program.split("\n");
  let at = lines.length;
  while (at > 0 && /^(?:printValue\(.*\);|export \{\};|)$/.test(lines[at - 1])) at--;
  return [...lines.slice(0, at), written.trimEnd(), ...lines.slice(at)].join("\n") + otherFiles.join("") + files;
}
