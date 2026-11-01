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

  /**
   * Lists in which a place is empty or holds undefined, made in several ways. Loops ask `in` for a place before they read it, and methods of lists walk them with callbacks.
   * Between the walks and inside them the lists lose places, shrink, grow and take elements of another kind. A list with a written type holds what the type says.
   */
  sceneOfListsWithEmptyPlaces() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "number" && Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? JSON.stringify(value) + Object.keys(value).join() : String(value)) + ";"; }`,
      `function nothing()${this.typed("void")} {}`,
      `function handBack(value${this.isTypeScript ? "?: any" : ""})${any} { return value; }`,
    );
    const caught = `catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const kind = this.pick(["whole", "whole", "whole", "fraction", "text", "record", "mixed"]);
      const full = () =>
        this.pick(
          kind === "whole"
            ? ["1", "2", "3", "0", "7", "-1"]
            : kind === "fraction"
              ? ["0.5", "1.5", "2", "-0", "NaN"]
              : kind === "text"
                ? ['"a"', '"b"', '""']
                : kind === "record"
                  ? ["{ a: 1 }", "[1]", "null"]
                  : ["1", "0.5", '"a"', "{ a: 1 }", "null", "true"],
        );
      const held = () =>
        this.pick([
          "undefined",
          "void 0",
          "nothing()",
          "nothing()",
          "(() => {})()",
          "(() => {})()",
          "handBack()",
          `([]${asAny})[0]`,
          `({}${asAny}).missing`,
        ]);
      const cells = (length: number, gaps: number, mayBeEmpty: boolean) => {
        const all = Array.from({ length }, full);
        for (; gaps > 0 && length > 0; gaps--) all[this.below(length)] = mayBeEmpty && this.chance(30) ? "" : held();
        return all.join(", ");
      };
      const literal = (gaps = this.pick([0, 1, 1, 1, 2])) => `[${cells(this.pick([2, 3, 3, 4, 5, 8]), gaps, true)}]`;
      const turn = `(each${any}, at${any})`;
      const made = () =>
        this.pick([
          () => literal(),
          () => literal(),
          () => literal(),
          () => literal(),
          () => literal(),
          () => literal(),
          () => `ofParameters${id}(${cells(this.pick([0, 1, 2]), this.pick([0, 1]), false)})`,
          () => `ofParameters${id}(${cells(this.pick([0, 1, 2]), this.pick([0, 1]), false)})`,
          () => `ofTheRest${id}(${cells(this.pick([1, 2, 3]), 1, false)})`,
          () => `[...${literal()}]`,
          () => `${literal()}.slice()`,
          () => `${literal(0)}.concat(${literal()})`,
          () => `Array.from({ length: ${this.pick([2, 3, 4])} }, ${turn} => (at === 1 ? ${held()} : ${full()}))`,
          () => `new Array(${this.pick([2, 3, 4])})`,
          () => `new Array(${cells(3, 1, false)})`,
          () => `Array.of(${cells(3, 1, false)})`,
          () => `JSON.parse("[1,null,3]")`,
          () => `${literal(0)}.map(${turn} => (at === 1 ? ${held()} : each))`,
          () => `Object.setPrototypeOf(${literal()}, { __proto__: Array.prototype, 1: "inherited" })`,
        ])();
      const place = () => this.pick(["0", "1", "1", "2", "2", "3"]);
      const step = (list: string, keepsItsType: boolean) =>
        this.pick([
          () => `delete ${list}[${place()}];`,
          () => `delete ${list}[${place()}];`,
          () => `delete ${list}[${place()}];`,
          () => `${list}.length = ${this.pick(["0", "1", "2", "3", "6"])};`,
          () => `${list}.length = ${this.pick(["0", "1", "2", "3", "6"])};`,
          () => `${list}.pop();`,
          () => `${list}.shift();`,
          () => `${list}.push(${full()});`,
          () => `${list}.unshift(${full()});`,
          () => `${list}[${list}.length + ${this.pick(["1", "2"])}] = ${full()};`,
          () => `${list}.splice(${place()}, 1);`,
          () => `${list}.reverse();`,
          () => `${list}.copyWithin(0, 1);`,
          () => `${list}.sort();`,
          ...(keepsItsType
            ? []
            : [
                () => `${list}.push(${held()});`,
                () => `${list}[${place()}] = ${held()};`,
                () => `${list}[${place()}] = ${held()};`,
                () => `${list}[${place()}] = ${this.pick(["0.5", '"text"', "{ a: 1 }", "1", "null"])};`,
                () => `${list}[${place()}] = ${this.pick(["0.5", '"text"', "{ a: 1 }", "1", "null"])};`,
                () => `${list}.fill(${held()}, 1, 2);`,
              ]),
        ])();
      const walk = (list: string, keepsItsType: boolean) => {
        const bound = this.pick([`${list}.length`, `${list}.length`, `${list}.length + 1`, "4", "6"]);
        const up = `for (let i = 0; i < ${bound}; i++)`;
        const read = `${list}[i]`;
        const use = this.pick([
          `sum += ${read};`,
          `sum += ${read};`,
          `sum += ${read};`,
          `note(${read});`,
          `note(${read});`,
          `text += ${read};`,
          `met++;`,
          `note(typeof ${read});`,
        ]);
        const inside = (at: string) =>
          this.chance(35) ? `if (${at} === ${this.pick(["0", "1", "1", "2"])}) { ${step(list, keepsItsType)} } ` : "";
        return this.pick([
          () => `${up} { if (i in ${list}) { ${use} } else absent++; }`,
          () => `${up} { if (i in ${list}) { ${use} } else absent++; }`,
          () => `${up} { if (i in ${list}) { ${use} } else absent++; }`,
          () => `${up} { if (i in ${list}) ${use} else absent++; }`,
          () => `${up} { if (i in ${list}) { ${use} ${inside("i")}} else absent++; }`,
          () => `${up} { ${inside("i")}if (i in ${list}) { ${use} } else absent++; }`,
          () => `${up} { if (!(i in ${list})) { absent++; continue; } ${use} }`,
          () => `${up} note(i in ${list} ? ${read} : "absent");`,
          () => `${up} i in ${list} && note(${read});`,
          () => `${up} { const has = i in ${list}; const value = ${read}; note(has ? value : "absent"); }`,
          () => `${up} note((i in ${list}) === Object.hasOwn(${list}, i));`,
          () => `for (let i = ${list}.length - 1; i >= 0; i--) { if (i in ${list}) { ${use} } else absent++; }`,
          () => `for (const key in ${list}) note(key + "=" + ${list}[key]);`,
          () => `${list}.forEach(${turn} => { note(at + ":" + each); ${inside("at")}});`,
          () => `${list}.forEach(${turn} => { note(at + ":" + each); ${inside("at")}});`,
          () => `${list}.forEach(() => { met++; });`,
          () => `note(${list}.map(${turn} => { ${inside("at")}return each === undefined ? "u" : each; }));`,
          () => `note(${list}.map(${turn} => at));`,
          () => `note(${list}.filter(${turn} => { ${inside("at")}return true; }));`,
          () => `note(${list}.filter(${turn} => each === undefined).length);`,
          () => `note(${list}.some(${turn} => { met++; ${inside("at")}return each === undefined; }));`,
          () => `note(${list}.every(${turn} => { met++; ${inside("at")}return each !== undefined; }));`,
          () =>
            `note(${list}.reduce((all${any}, each${any}, at${any}) => { ${inside("at")}return all + "|" + at + ":" + each; }, ""));`,
          () => `note(${list}.reduce((all${any}, each${any}) => all + each));`,
          () => `note(${list}.reduceRight((all${any}, each${any}, at${any}) => all + "|" + at + ":" + each, ""));`,
          () =>
            `note(${list}.find(${turn} => { met++; return each === undefined; })); note(${list}.findIndex(${turn} => each === undefined));`,
          () =>
            `note(${list}.findLast(${turn} => { met++; return each === undefined; })); note(${list}.findLastIndex(${turn} => each === undefined));`,
          () =>
            `note(${list}.indexOf(undefined)); note(${list}.includes(undefined)); note(${list}.lastIndexOf(undefined));`,
          () => `note(${list}.flatMap(${turn} => [at, each]));`,
          () =>
            `for (const each of ${list}) { note(each); ${this.chance(25) ? step(list, keepsItsType) + " if (++met > 12) break; " : ""}}`,
          () => `for (const [at, each] of ${list}.entries()) note(at + ":" + each);`,
          () => `note(${list}.join("-")); note(Object.keys(${list}).join());`,
        ])();
      };
      const counters = `let sum${any} = 0, text = "", met = 0, absent = 0;`;
      const answers = `note(sum); note(text); note(met); note(absent);`;
      this.emit(
        1,
        `function ofParameters${id}(first${this.isTypeScript ? "?: any" : ""}, second${this.isTypeScript ? "?: any" : ""})${any} { return [first, second, ${full()}]; }`,
        `function ofTheRest${id}(...all${this.typed("any[]")})${any} { return all; }`,
      );
      for (let block = this.pick([1, 2, 2, 3]); block > 0; block--) {
        const list = `list${id}_${block}`;
        const keepsItsType = this.isTypeScript && kind !== "record" && kind !== "mixed" && this.chance(35);
        const type = keepsItsType
          ? `: ${kind === "text" ? "string" : "number"}[]`
          : this.isTypeScript && this.chance(40)
            ? ": any[]"
            : "";
        const inAFunction = this.chance(50);
        this.lines.push(inAFunction ? `    function block${id}_${block}()${this.typed("void")} {` : "    {");
        this.emit(
          2,
          `${this.pick(["const", "const", "let"])} ${list}${type} = ${keepsItsType ? literal(0) : made()};`,
          counters,
        );
        for (let turns = this.pick([1, 2, 3, 4]); turns > 0; turns--) {
          if (keepsItsType || this.chance(45)) this.emit(2, `try { ${step(list, keepsItsType)} } ${caught}`);
          this.emit(2, `try { ${walk(list, keepsItsType)} } ${caught}`);
        }
        this.emit(2, answers, `note(${list});`);
        this.lines.push("    }");
        if (inAFunction)
          for (let calls = this.pick([1, 1, 2]); calls > 0; calls--) this.emit(1, `block${id}_${block}();`);
      }
      for (let walker = this.pick([0, 1, 1, 2]); walker > 0; walker--) {
        const name = `walk${id}_${walker}`;
        this.lines.push(`    function ${name}(list${any})${this.typed("void")} {`);
        this.emit(2, counters);
        for (let turns = this.pick([1, 1, 2]); turns > 0; turns--)
          this.emit(2, `try { ${walk("list", false)} } ${caught}`);
        this.emit(2, answers);
        this.lines.push("    }");
        for (let calls = this.pick([2, 3, 4, 5]); calls > 0; calls--) this.emit(1, `${name}(${made()});`);
      }
    }
    this.emit(1, `printValue("lists with empty places ${number}", out);`);
    this.lines.push("}");
  }

  briefFunctionWithAValueOutsideItsType(id: string, shape: string, link: string) {
    const outside = () =>
      this.pick([
        "1073741824",
        "1073741824",
        "0.5",
        '"text"',
        '"text"',
        "{ other: 1 }",
        "{ other: 1 }",
        '{ inner: "text" }',
        "[1]",
        "() => 1",
        "null",
        "undefined",
        "{ inner: -3 }",
      ]);
    const arrives = this.pick([
      () => [
        `const held: ${shape}[] = [{ inner: -3 }];`,
        `(held as any)[0] = ${outside()};`,
        `const arrived = held[0];`,
      ],
      () => [
        `const held: ${shape}[] = [{ inner: -3 }];`,
        `(held as any)[0] = ${outside()};`,
        `const arrived = held[0];`,
      ],
      () => [
        `const held: ${shape}[] = [{ inner: -3 }];`,
        `(held as any)[0] = ${outside()};`,
        `const arrived = held[0];`,
      ],
      () => [
        `const held: { first: ${shape} } = { first: { inner: -3 } };`,
        `(held as any).first = ${outside()};`,
        `const arrived = held.first;`,
      ],
      () => [
        `const held = new Map<string, ${shape}>();`,
        `(held as any).set("k", ${outside()});`,
        `const arrived = held.get("k")!;`,
      ],
      () => [`const arrived = (${outside()}) as unknown as ${shape};`],
      () => [
        `const arrived: ${shape} = JSON.parse(${this.pick([`"5"`, `'"text"'`, `'{"other":1}'`, `"null"`, `"[1]"`])});`,
      ],
      () => [`const held: ${shape}[] = [];`, `const arrived = held[start];`],
    ])();
    const writes = this.pick([
      "[1, 2].forEach(step => { tally += step; });",
      "[1, 2].forEach(step => { tally += step; });",
      "[1, 2].map(step => { tally += step; return step; });",
      "[1, 2].reduce((all, step) => { tally += step; return all; }, 0);",
      "[1, 2].some(step => { tally += step; return false; });",
      "[1, 2].filter(step => { tally += step; return true; });",
      "new Set([1, 2]).forEach(step => { tally += step; });",
      "for (const step of [1, 2]) tally += step;",
    ]);
    const holds = this.pick([
      `const link: ${link} = { value: arrived, next: { value: arrived, next: null } };`,
      `const link: ${link} = { value: arrived, next: { value: arrived, next: null } };`,
      `const link: ${link} = { value: arrived, next: null };`,
      `const link: ${link} = { value: arrived, next: null };`,
      `const link: { value: ${shape}; count: number } = { value: arrived, count: tally };`,
      `const link: [${shape}, number] = [arrived, 1];`,
      `const link: ${shape}[] = [arrived, arrived];`,
    ]);
    const reads = this.pick([
      "tally += 3; arrived;",
      "tally += 3; arrived;",
      "tally += 3; arrived;",
      "tally += 3; return arrived;",
      'tally += typeof arrived === "object" ? 3 : 5;',
      "tally += 3; link;",
      "tally += arrived === undefined ? 3 : 5;",
    ]);
    const later = this.pick([
      `const later = () => { ${reads} };`,
      `const later = () => { ${reads} };`,
      `function later() { ${reads} }`,
    ]);
    const uses = this.pick([
      `{ ${later} const before = tally; later(); tally += before; }`,
      `{ ${later} const before = tally; later(); tally += before; }`,
      `{ ${later} const before = tally; later(); tally += before; }`,
      `{ ${later} const before = tally; later(); later(); tally += before; }`,
      `{ ${later} const before = tally; for (let again = 0; again < 2; again++) later(); tally += before; }`,
      `{ ${later} const before = tally; if (before >= 0) later(); tally += before; }`,
      `{ ${later} later(); const behind = tally; tally += behind; }`,
      `{ ${later} later(); }`,
    ]);
    this.lines.push(`    function brief${id}(start: number): number {`);
    this.emit(
      2,
      "let tally = start;",
      ...arrives,
      ...(this.chance(80) ? [writes, holds] : [holds, writes]),
      uses,
      ...(this.chance(25) ? ["note(typeof arrived);"] : []),
      "return tally;",
    );
    this.lines.push("    }");
    this.emit(
      1,
      `for (let turn = 0; turn < ${this.pick([1, 2, 2, 3])}; turn++) try { note(brief${id}(${this.pick(["0", "0", "turn"])})); } catch (error) { note("threw " + (error as any)?.constructor?.name); }`,
    );
  }

  /**
   * A function walks a list with methods whose callbacks write variables of the function: a sum, counts, the last element, a text. Every variable is printed behind every walk.
   * The function is called with lists of one kind, then with others: whole numbers among fractions, empty places, an element of another kind.
   * Callbacks change the list, throw, walk again, write a variable that is declared further down, and share variables with closures that are made later.
   * In TypeScript some functions are brief: one variable that a callback writes, and a constant whose value is not of its written type, held by a literal and read in a closure that is called at once.
   */
  sceneOfVariablesThatCallbacksWrite() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "number" && Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)) + ";"; }`,
    );
    if (this.isTypeScript)
      this.emit(
        1,
        `interface Shape${number} { inner: number }`,
        `type Link${number}<T> = { value: T; next: Link${number}<T> | null };`,
      );
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      if (this.isTypeScript && this.chance(40)) {
        this.briefFunctionWithAValueOutsideItsType(id, `Shape${number}`, `Link${number}<Shape${number}>`);
        continue;
      }
      const kind = this.pick(["fraction", "fraction", "fraction", "whole", "whole", "text", "record"]);
      const usual = () =>
        this.pick(
          kind === "fraction"
            ? ["0.5", "1.5", "2.5", "-0.25"]
            : kind === "whole"
              ? ["1", "2", "3", "7"]
              : kind === "text"
                ? ['"a"', '"b"', '"cd"']
                : ["{ a: 1 }", "{ a: 2 }"],
        );
      const other = () =>
        this.pick([
          "1",
          "2",
          "0.5",
          '"a"',
          "{ a: 1 }",
          "null",
          "undefined",
          "(() => {})()",
          "true",
          "NaN",
          "-0",
          "[1]",
        ]);
      const usualList = () => `[${this.several(1, 5, usual).join(", ")}]`;
      const rareList = () =>
        this.pick([
          () => `[${usual()}, ${other()}, ${usual()}]`,
          () => `[${usual()}, ${other()}, ${usual()}]`,
          () => `[${usual()}, ${usual()}, ${usual()}, ${other()}]`,
          () => `[${other()}, ${usual()}]`,
          () => `[${usual()}, , ${usual()}]`,
          () => `[${usual()}, , ${usual()}]`,
          () => `[, ${usual()}]`,
          () => `[1, 2, 3]`,
          () => `[]`,
          () => `new Array(3)`,
          () => `Array.from({ length: 4 }, (_${any}, at${any}) => at / 2)`,
          () => `Object.setPrototypeOf([${usual()}, , ${usual()}], { __proto__: Array.prototype, 1: "inherited" })`,
          () => `Object.freeze(${usualList()})`,
        ])();
      const variables = `let sum${any} = 0, count = 0, last${any} = "none", before${any} = "none", text = "", odd = 0, gaps = 0, most${any} = -Infinity, places = 0;`;
      const print = `note([sum, count, last, before, text, odd, gaps, most, places].map(String).join());`;
      const place = () => this.pick(["0", "1", "1", "2", "3"]);
      const write = () =>
        this.pick([
          "sum += each;",
          "sum += each;",
          "sum += each;",
          "count++;",
          "count++;",
          "last = each;",
          "last = each;",
          'text += each + "|";',
          `if (typeof each !== ${JSON.stringify(kind === "text" ? "string" : kind === "record" ? "object" : "number")}) odd++;`,
          "if (each === undefined) gaps++;",
          "most = each > most ? each : most;",
          "[before, last] = [last, each];",
          "sum = sum + count;",
          "places += at;",
        ]);
      const step = (list: string) =>
        this.pick([
          `${list}[${place()}] = ${other()};`,
          `${list}[${place()}] = ${other()};`,
          `${list}[${place()}] = ${other()};`,
          `${list}.length = ${this.pick(["0", "1", "2"])};`,
          `${list}.push(${usual()});`,
          `${list}.push(${other()});`,
          `${list}.pop();`,
          `${list}.shift();`,
          `delete ${list}[${place()}];`,
          `${list}[${list}.length + 1] = ${usual()};`,
        ]);
      const turn = `(each${any}, at${any})`;
      const laterClosures: string[] = [];
      const body = (list: string, mayThrow: boolean) =>
        [
          ...this.several(1, 4, write),
          ...(this.chance(35) ? [`if (at === ${place()}) { ${step(list)} }`] : []),
          ...(mayThrow ? [`if (at === ${place()}) throw new Error("stop");`] : []),
          ...(laterClosures.length && this.chance(50) ? [`${this.pick(laterClosures)}();`] : []),
          ...(this.chance(25) ? [write()] : []),
        ].join(" ");
      const walk = (list: string, mayThrow: boolean): string =>
        this.pick([
          () => `${list}.forEach(${turn} => { ${body(list, mayThrow)} });`,
          () => `${list}.forEach(${turn} => { ${body(list, mayThrow)} });`,
          () => `${list}.forEach(${turn} => { ${body(list, mayThrow)} });`,
          () => `note(${list}.map(${turn} => { ${body(list, mayThrow)} return count; }).length);`,
          () => `note(${list}.filter(${turn} => { ${body(list, mayThrow)} return at % 2 === 0; }).length);`,
          () => `note(${list}.some(${turn} => { ${body(list, mayThrow)} return at === ${place()}; }));`,
          () => `note(${list}.every(${turn} => { ${body(list, mayThrow)} return at !== ${place()}; }));`,
          () =>
            `note(${list}.reduce((all${any}, each${any}, at${any}) => { ${body(list, mayThrow)} return all + count; }, 0));`,
          () =>
            `note(${list}.reduceRight((all${any}, each${any}, at${any}) => { ${body(list, mayThrow)} return all + count; }, 0));`,
          () => `note(${list}.find(${turn} => { ${body(list, mayThrow)} return false; }));`,
          () => `note(${list}.findIndex(${turn} => { ${body(list, mayThrow)} return at === ${place()}; }));`,
          () => `note(${list}.flatMap(${turn} => { ${body(list, mayThrow)} return [at]; }).length);`,
          () =>
            `[${list}, ${list}.slice(), ${rareList()}].forEach((row${any}) => { row.forEach(${turn} => { ${body("row", mayThrow)} }); sum = sum + 1; });`,
          () =>
            `${list}.forEach((outer${any}) => { ${list}.forEach(${turn} => { ${body(list, false)} }); count += 10; });`,
        ])();
      const type = this.isTypeScript
        ? this.chance(50) && kind !== "record"
          ? `: ${kind === "text" ? "string" : "number"}[]`
          : ": any[]"
        : "";
      this.lines.push(`    function around${id}(list${type})${this.typed("void")} {`);
      this.emit(2, variables);
      for (let turns = this.pick([1, 2, 2, 3, 4]); turns > 0; turns--) {
        const form = this.below(100);
        if (form < 55) this.emit(2, walk("list", false), print);
        else if (form < 80)
          this.emit(
            2,
            `try { ${walk("list", true)} count += 1000; } catch (error) { note("caught"); ${print} } finally { places += 100; }`,
            print,
          );
        else if (form < 90) {
          const late = `late${id}_${turns}`;
          this.emit(
            2,
            `try { list.forEach(${turn} => { ${late} += each; count++; }); } catch (error) { note((error${asAny})?.constructor?.name); }`,
            print,
            `let ${late}${any} = 0;`,
            `list.forEach(${turn} => { ${late} += each; });`,
            `note(${late});`,
          );
        } else {
          const later = `later${id}_${turns}`;
          this.emit(
            2,
            `const ${later} = () => ${this.pick(["++count", "(sum += 1)", '(text += "!")', "(last = count)"])};`,
            `note(${later}());`,
          );
          laterClosures.push(later);
        }
        if (this.chance(30))
          this.emit(2, this.pick(["sum = 0;", "count *= 2;", 'text = "";', "last = sum;", "most = 0;"]));
      }
      this.emit(2, print);
      this.lines.push("    }");
      const call = (list: string) =>
        `try { around${id}(${list}${asAny}); } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
      this.emit(
        1,
        ...this.several(1, 4, () => call(usualList())),
        ...this.several(1, 4, () => call(rareList())),
        ...this.several(0, 2, () => call(usualList())),
      );
    }
    this.emit(1, `printValue("variables that callbacks write ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * Lists whose type lists their texts: a union of literals, the elements of an `as const` list, or an enum of texts.
   * `at`, an index, `pop`, `shift` and `for-of` take elements out of the same list side by side. Each result is compared with the others, switched over, used as a key, joined, measured, and put into a Set and a Map.
   */
  sceneOfListsWhoseTypeListsTheirTexts() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value)) + ";"; }`,
    );
    const caught = `catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`;
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const pool = ["a", "b", "cd", "", "length", "0", "é", "A", "ab", "constructor", "10", " "];
      const texts = [...new Set(this.several(2, 5, () => this.pick(pool)))];
      // The files are written byte for character: a character outside ASCII is written as an escape.
      const quoted = (text: string) =>
        JSON.stringify(text).replace(/[^ -~]/g, each => "\\u" + each.charCodeAt(0).toString(16).padStart(4, "0"));
      const [W, all, table, nameOf, ask] = [`Word${id}`, `all${id}`, `table${id}`, `nameOf${id}`, `ask${id}`];
      const form = this.pick(["union", "union", "const", "enum"]);
      const written = (text: string) => (form === "enum" ? `${W}.M${texts.indexOf(text)}` : quoted(text));
      const key = (text: string) => (form === "enum" ? `[${written(text)}]` : quoted(text));
      if (form === "enum")
        this.emit(
          1,
          this.isTypeScript
            ? `enum ${W} { ${texts.map((text, at) => `M${at} = ${quoted(text)}`).join(", ")} }`
            : `const ${W} = Object.freeze({ ${texts.map((text, at) => `M${at}: ${quoted(text)}`).join(", ")} });`,
        );
      else if (form === "const") {
        this.emit(1, `const ${all} = [${texts.map(written).join(", ")}]${this.isTypeScript ? " as const" : ""};`);
        if (this.isTypeScript) this.emit(1, `type ${W} = (typeof ${all})[number];`);
      } else if (this.isTypeScript) this.emit(1, `type ${W} = ${texts.map(written).join(" | ")};`);
      this.emit(
        1,
        `const ${table}${this.typed(`Record<${W}, number>`)} = { ${texts.map((text, at) => `${key(text)}: ${at + 1}`).join(", ")} };`,
        `function ${nameOf}(word${this.typed(`${W} | undefined`)})${this.typed("string")} { switch (word) { ${texts.map((text, at) => `case ${written(text)}: return "is ${at}";`).join(" ")} default: return "none"; } }`,
      );
      const one = () => written(this.pick(texts));
      const use = (value: string) =>
        this.several(1, 3, () =>
          this.pick([
            `note(${value});`,
            `note(${value});`,
            `note(${value} === ${one()});`,
            `note(${value} == ${one()});`,
            `note(${nameOf}(${value}));`,
            `note(${nameOf}(${value}));`,
            `note(${table}[${value}${this.isTypeScript ? "!" : ""}]);`,
            `note({ [String(${value})]: 1 });`,
            `note(${value} + "!");`,
            `note(\`<\${${value}}>\`);`,
            `note([${value}, ${one()}].join());`,
            `note(${value}?.length);`,
            `note(typeof ${value});`,
            `note(new Set([${value}, ${one()}]).size);`,
            `note(new Map([[${value}, 1]]).get(${one()}));`,
            `note(${value}?.charCodeAt(0));`,
            `note((${value}${asAny}) < ${one()});`,
            `note(JSON.stringify(${value}));`,
            `note(${value}?.toUpperCase());`,
            `note(list.indexOf(${value}${asAny}));`,
            `note(list.includes(${value}${asAny}));`,
            `note(${value} ? 1 : 0);`,
            `note(${value} ?? "nothing");`,
          ]),
        ).join(" ");
      const statement = () =>
        this.pick([
          () =>
            `for (let k = -1; k <= list.length; k++) { const byAt = list.at(k), byIndex = list[k < 0 ? list.length + k : k]; note(byAt === byIndex); ${use("byAt")} ${use("byIndex")} }`,
          () =>
            `for (let k = -1; k <= list.length; k++) { const byAt = list.at(k), byIndex = list[k < 0 ? list.length + k : k]; note(byAt === byIndex); ${use("byAt")} ${use("byIndex")} }`,
          () =>
            `{ const first = list.at(0), last = list.at(-1), beyond = list.at(9); note(first === list[0]); note(last === list[list.length - 1]); ${use("first")} ${use("last")} ${use("beyond")} }`,
          () =>
            `{ const copy = list.slice(), last = list[list.length - 1], popped = copy.pop(); note(popped === last); ${use("popped")} ${use("last")} note(copy.length); }`,
          () =>
            `{ const copy = list.slice(), last = list[list.length - 1], popped = copy.pop(); note(popped === last); ${use("popped")} ${use("last")} note(copy.length); }`,
          () =>
            `{ const copy = list.slice(), first = list[0], shifted = copy.shift(); note(shifted === first); ${use("shifted")} ${use("first")} note(copy.length); }`,
          () =>
            `{ const copy = list.slice(), first = list[0], shifted = copy.shift(); note(shifted === first); ${use("shifted")} ${use("first")} note(copy.length); }`,
          () =>
            `{ let k = 0; for (const each of list) { note(each === list.at(k)); note(each === list[k]); ${use("each")} k++; } }`,
          () =>
            `{ const copy = list.slice(); let joined = ""; while (copy.length) joined += copy.pop() + "," + (copy.shift() ?? "-") + ";"; note(joined); }`,
          () => `note(list.map((each${any}, k${any}) => each === list.at(k)).join());`,
          () =>
            `{ const copy = list.slice(), taken = []; while (copy.length) taken.push(${this.pick(["copy.pop()", "copy.shift()", "copy.at(-1), copy.pop()", "copy.at(0), copy.shift()"])}); note(taken); note(taken.map(${nameOf}${asAny}).join()); }`,
        ])();
      this.lines.push(`    function ${ask}(list${this.typed(`${W}[]`)})${this.typed("void")} {`);
      for (let turns = this.pick([2, 3, 4, 5]); turns > 0; turns--) this.emit(2, `try { ${statement()} } ${caught}`);
      this.lines.push("    }");
      const list = () => `[${this.several(1, 6, one).join(", ")}]`;
      this.emit(
        1,
        ...this.several(2, 4, () => `${ask}(${list()});`),
        ...(this.chance(60) ? [`${ask}([]);`] : []),
        ...(form === "const" && this.chance(60) ? [`${ask}([...${all}]);`] : []),
        ...(this.chance(25)
          ? [`${ask}([${one()}, ${this.pick(['"zz"', "undefined", "1", "null", ""])}, ${one()}]${asAny});`]
          : []),
        ...this.several(0, 1, () => `${ask}(${list()});`),
      );
    }
    this.emit(1, `printValue("lists whose type lists their texts ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A function makes small objects, lists and closures and hands them to callees that only look at them, but for one path in many, on which a callee keeps what it was handed:
   * in a list, a Set or a Map of the module, in a field, in a variable that a closure holds, by returning, throwing or yielding it, through `this`, `arguments`, a rest parameter, a callback or a setter,
   * behind an await, as the result of an async function, or on a list while a throw passes. The function that makes them may be async and use them on both sides of an await, hand them to a call in tail
   * position, or hold the one of the turn before. The path is taken in a few of the turns of a loop. Behind the loop, when the function that made them has returned, what was kept is read, written,
   * called and printed, and once more behind ten awaits where something waits.
   */
  sceneOfValuesThatACalleeKeepsOnOnePath() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "function" ? "function" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)) + ";"; }`,
    );
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [kept, table, bag, holder, last, look, keep, make] = [
        "kept",
        "table",
        "bag",
        "holder",
        "last",
        "look",
        "keep",
        "make",
      ].map(name => name + id);
      const turns = this.pick([3, 5, 8, 12]);
      const promised = this.typed("Promise<any>");
      const ofAll = `(globalThis${asAny}).${kept}`;
      let waits = false;
      const rare = () =>
        this.pick([
          `turn === ${this.below(turns)}`,
          `turn === ${this.below(turns)}`,
          `turn === ${turns - 1}`,
          `turn % ${this.pick([3, 4, 5])} === ${this.pick([0, 1, 2])}`,
          `turn > ${turns - 2}`,
          `value.mark === ${this.below(turns)}`,
        ]);
      this.emit(
        1,
        `const ${kept}${this.typed("any[]")} = [];`,
        `const ${table} = new Map${this.isTypeScript ? "<any, any>" : ""}();`,
        `const ${bag} = new Set${this.isTypeScript ? "<any>" : ""}();`,
        `const ${holder}${any} = { field: null, set taken(value${any}) { this.field = value; } };`,
        `let ${last}${any} = null;`,
        `function ${look}(value${any})${this.typed("number")} { return typeof value === "function" ? value() : Array.isArray(value) ? value.length + value[0] : value.mark + 1; }`,
      );
      const keeper = (name: string) =>
        this.pick([
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${kept}.push(value); return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${kept}.push(value); return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${table}.set(turn, value); return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${holder}.field = value; return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${holder}.taken = value; return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${last} = value; return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${kept}.push(() => value); return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${kept}.push({ inner: value }); return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${kept}.push([value]); return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { return ${rare()} ? value : ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) throw value; return ${look}(value); }`,
          () =>
            `function ${name}(${this.isTypeScript ? "this: any, " : ""}value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${kept}.push(arguments[0]); return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")}, ...more${this.typed("any[]")})${any} { if (${rare()}) ${kept}.push(...more, value); return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { const later = () => ${kept}.push(value); if (${rare()}) later(); return ${look}(value); }`,
          () => (
            (waits = true),
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) Promise.resolve(value).then(given => { ${last} = given; }); return ${look}(value); }`
          ),
          () => (
            (waits = true),
            `async function ${name}Later(value${any}, turn${this.typed("number")})${promised} { await null; if (${rare()}) ${kept}.push(value); } function ${name}(value${any}, turn${this.typed("number")})${any} { ${name}Later(value, turn); return ${look}(value); }`
          ),
          () => (
            (waits = true),
            `async function ${name}Later(value${any}, turn${this.typed("number")})${promised} { return ${rare()} ? value : null; } function ${name}(value${any}, turn${this.typed("number")})${any} { ${name}Later(value, turn).then(given => { if (given !== null) ${kept}.push(given); }); return ${look}(value); }`
          ),
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${bag}.add(value); return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${ofAll} = value; return ${look}(value); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { ${kept}.push(value); if (${rare()}) throw new Error("left"); ${kept}.pop(); return ${look}(value); }`,
          () =>
            `function ${name}Inner(value${any}, turn${this.typed("number")})${any} { if (${rare()}) ${kept}.push(value); return ${look}(value); } function ${name}(value${any}, turn${this.typed("number")})${any} { return ${name}Inner(value, turn); }`,
          () =>
            `function ${name}(value${any}, turn${this.typed("number")})${any} { if (${rare()}) Object.assign(${holder}, { field: value }); return ${look}(value); }`,
          () =>
            `function* ${name}Steps(value${any}, turn${this.typed("number")})${any} { if (${rare()}) yield value; yield ${look}(value); } function ${name}(value${any}, turn${this.typed("number")})${any} { return [...${name}Steps(value, turn)][0]; }`,
        ])();
      const keepers = this.several(1, 3, () => 0).map((_, at) => `${keep}_${at}`);
      for (const name of keepers) this.emit(1, keeper(name));
      const made = () =>
        this.pick([
          "{ mark: turn }",
          "{ mark: turn }",
          "{ mark: turn, more: [turn] }",
          "{ mark: turn, inner: { mark: turn + 1 } }",
          "[turn, turn + 1]",
          "[turn]",
          "() => turn",
          "() => turn + base",
          "() => ++base",
          `new (class { mark = turn; })()`,
          "Object.assign(() => turn, { mark: turn })",
        ]);
      const taken = `taken${id}`;
      const isAsync = this.chance(30);
      waits ||= isAsync;
      const holdsTheLast = this.chance(25);
      const helpers: string[] = [];
      this.lines.push(
        `    ${isAsync ? "async " : ""}function ${make}(base${this.typed("number")})${isAsync ? promised : any} {`,
      );
      this.emit(2, `let sum${any} = 0;`);
      if (holdsTheLast) this.emit(2, `let before${any} = null;`);
      this.lines.push(`        for (let turn = 0; turn < ${turns}; turn++) {`);
      for (let values = this.pick([1, 1, 2, 3]); values > 0; values--) {
        const name = `value${values}`;
        const handsOn = this.chance(20);
        let call = `${this.pick(keepers)}(${name}, turn${this.chance(20) ? `, ${made()}` : ""})`;
        if (handsOn) {
          helpers.push(
            `function hands${id}_${values}(turn${this.typed("number")}, base${this.typed("number")})${any} { const ${name}${any} = ${made()}; return ${call}; }`,
          );
          call = `hands${id}_${values}(turn, base)`;
        } else if (isAsync && this.chance(30)) {
          helpers.push(
            `async function gives${id}_${values}(turn${this.typed("number")}, base${this.typed("number")})${promised} { return ${made()}; }`,
          );
          this.emit(3, `const ${name}${any} = await gives${id}_${values}(turn, base);`);
        } else this.emit(3, `const ${name}${any} = ${made()};`);
        if (isAsync && !handsOn && this.chance(50)) this.emit(3, `sum += ${look}(${name}); await null;`);
        this.emit(
          3,
          this.pick([
            `try { const ${taken}${any} = ${call}; if (typeof ${taken} === "number") sum += ${taken}; else ${kept}.push(${taken}); } catch (thrown) { ${kept}.push(thrown); }`,
            `try { const ${taken}${any} = ${call}; if (typeof ${taken} === "number") sum += ${taken}; else ${kept}.push(${taken}); } catch (thrown) { ${kept}.push(thrown); }`,
            `try { const ${taken}${any} = ${call}; sum += typeof ${taken} === "number" ? ${taken} : 1000; } catch (thrown) { ${last} = thrown; }`,
          ]),
        );
        if (handsOn) continue;
        if (this.chance(30))
          this.emit(3, `if (typeof ${name} === "object" && !Array.isArray(${name})) ${name}.mark += 100;`);
        if (isAsync && this.chance(50)) this.emit(3, `await null; sum += ${look}(${name});`);
        if (holdsTheLast) this.emit(3, `if (before !== null) sum += ${look}(before); before = ${name};`);
      }
      this.lines.push("        }");
      if (holdsTheLast) this.emit(2, `if (before !== null) sum += ${look}(before);`);
      this.emit(2, "return sum;");
      this.lines.push("    }");
      this.emit(1, ...helpers);
      const show = `(value${any})${any} => typeof value === "function" ? "f" + value() : typeof value === "object" && value !== null ? JSON.stringify(value) : value`;
      this.emit(
        1,
        ...this.several(1, 3, () => `note(${isAsync ? "await " : ""}${make}(${this.pick(["0", "1", "10"])}));`),
        `function churn${id}()${this.typed("number")} { let total = 0; for (let i = 0; i < 200; i++) { const filler${any} = { mark: i, more: [i, i + 1], call: () => i }; total += filler.mark + filler.more[1] + filler.call(); } return total; }`,
      );
      const tells = [
        `note(churn${id}());`,
        `note(${kept}.length);`,
        `for (const value of ${kept}) { note((${show})(value)); if (typeof value === "object" && value !== null && !Array.isArray(value) && "mark" in value) { value.mark++; note(value.mark); } if (typeof value === "object" && value !== null && "inner" in value) note((${show})(value.inner)); if (Array.isArray(value)) { value.push(1); note((${show})(value[0])); } }`,
        `note([...${table}].map(([turn, value]) => turn + ":" + (${show})(value)${this.isTypeScript ? "" : ""}).map(String).join());`,
        `note([...${bag}].map(${show}).map(String).join());`,
        `note((${show})(${holder}.field)); note((${show})(${last})); note((${show})(${ofAll}));`,
      ];
      this.emit(1, ...tells);
      if (waits) this.emit(1, `for (let tick = 0; tick < 10; tick++) await null;`, ...tells);
    }
    this.emit(1, `printValue("values that a callee keeps on one path ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * Objects made by a constructor function, a class or a function that returns a literal hold numbers, texts, closures and what the language brings under a name.
   * Some members are stored on one path only, so that an object may lack what others of its kind have. The objects, or what makes them, go alone or inside another object to a function of
   * the language that takes any value or a bag of options. Some are changed behind that: a member is stored late, deleted, redefined. While it is made, before and behind each change and at
   * the end each is asked for its members by their written names, in every way the language has. No helper asks by a name that it is handed.
   */
  sceneOfObjectsHandedToTheLanguage() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += String(value) + ";"; }`,
      `const given${any} = Date.now() > 0 ? ${this.below(9)} : "other";`,
    );
    const names = ["a", "b", "c", "size", "kind"];
    const brought = [
      ...["Map", "Set", "WeakMap", "Promise", "Date", "RegExp", "Error", "TypeError", "Symbol", "Object", "Array"],
      ...[
        "Function",
        "ArrayBuffer",
        "Uint8Array",
        "Float64Array",
        "DataView",
        "Proxy",
        "Reflect",
        "JSON",
        "Math",
        "Intl",
      ],
      ...["Number", "String", "Boolean", "BigInt", "URL", "TextEncoder", "Math.max", "JSON.parse", "Array.prototype"],
      ...["Object.prototype", "Symbol.iterator", "parseInt", "isNaN", "structuredClone", "queueMicrotask"],
    ];
    const held = () =>
      this.chance(50)
        ? this.pick(brought)
        : this.pick([
            "given",
            "given",
            "1",
            `"text"`,
            "null",
            "undefined",
            "[given]",
            "{ inner: given }",
            "() => given",
            "new Map()",
          ]);
    const asks = (o: string, field: string, least: number, most: number) =>
      this.several(least, most, () =>
        this.pick([
          `note(${o}.hasOwnProperty("${field}"));`,
          `note(${o}.hasOwnProperty("${field}"));`,
          `note(Object.hasOwn(${o}, "${field}"));`,
          `note(Object.hasOwn(${o}, "${field}"));`,
          `note(Object.prototype.hasOwnProperty.call(${o}, "${field}"));`,
          `note("${field}" in ${o});`,
          `note(Reflect.has(${o}, "${field}"));`,
          `note(typeof ${o}.${field});`,
          `note(${o}.${field} === undefined);`,
          `note(${o}.propertyIsEnumerable("${field}"));`,
          `note(Object.getOwnPropertyDescriptor(${o}, "${field}")?.enumerable);`,
          `note(Object.getOwnPropertyDescriptor(${o}, "${field}")?.writable);`,
        ]),
      ).join(" ");
    const stores = (field: string) =>
      `${this.chance(15) ? asks("this", field, 1, 2) + " " : ""}${this.chance(25) ? this.pick(["if (given > 100) ", "if (given > 100) ", "if (given >= 0) "]) : ""}this.${field} = ${held()};${this.chance(15) ? " " + asks("this", field, 1, 2) : ""}`;
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [Made, made, next, bag] = ["Made", "made", "next", "bag"].map(name => name + id);
      const start = this.below(names.length);
      const fields = this.several(1, 3, () => 0).map((_, at) => names[(start + at) % names.length]);
      const kind = this.pick(["function", "function", "function", "constructor", "fields", "literal"]);
      this.emit(
        1,
        kind === "function"
          ? `function ${Made}(${this.isTypeScript ? "this: any" : ""}) { ${fields.map(stores).join(" ")} }`
          : kind === "constructor"
            ? `class ${Made} { ${this.isTypeScript ? fields.map(field => `${field}: any;`).join(" ") + " " : ""}constructor() { ${fields.map(stores).join(" ")} } }`
            : kind === "fields"
              ? `class ${Made} { ${fields.map(field => `${field}${any} = ${held()};`).join(" ")} }`
              : `function ${Made}()${any} { return { ${fields.map(field => `${field}: ${held()}`).join(", ")} }; }`,
      );
      const create =
        kind === "literal" ? `${Made}()` : kind === "function" ? `new (${Made}${asAny})()` : `new ${Made}()`;
      this.emit(1, `const ${made}${any} = ${create};`);
      const it = this.isTypeScript ? `(${this.pick([Made, Made, made])} as any)` : this.pick([Made, Made, made]);
      this.emit(
        1,
        `const ${bag}${any} = ${this.pick([
          it,
          `{ k: ${it} }`,
          `{ [${it}]: ${it} }`,
          `{ [${it}]: ${it} }`,
          `{ [${it}]() { return ${it}; } }`,
          `{ [${it}]() { return ${it}; } }`,
          `{ ["k" + ${it}]: ${it} }`,
          `{ ["k" + ${it}]() { return ${it}; } }`,
          `{ [${it}]: 1, k: ${it} }`,
          `{ [Symbol.for("k")]: ${it} }`,
          `{ get k() { return ${it}; } }`,
          `{ m() { return ${it}; } }`,
          `[${it}]`,
          `new Map([["k", ${it}]])`,
          `() => ${it}`,
          `Object.assign(Object.create(null), { k: ${it} })`,
          `{ cause: ${it} }`,
          `{ maxByteLength: 64, k: ${it} }`,
          `{ ...${made}, k: ${it} }`,
          `{ ...${made}, [${it}]: ${it} }`,
        ])};`,
      );
      const handsOver = () =>
        this.chance(50)
          ? this.pick([
              `new ArrayBuffer(8, ${bag})`,
              `new SharedArrayBuffer(8, ${bag})`,
              `new Error("x", ${bag})`,
              `new TypeError("x", ${bag})`,
              `new AggregateError([], "x", ${bag})`,
              `[1].toLocaleString("en", ${bag})`,
              `(1).toLocaleString("en", ${bag})`,
              `new Date(0).toLocaleString("en", ${bag})`,
              `new Intl.NumberFormat("en", ${bag})`,
              `new Intl.DateTimeFormat("en", ${bag})`,
              `new Intl.Collator("en", ${bag})`,
              `"a".localeCompare("b", "en", ${bag})`,
              `new TextDecoder("utf-8", ${bag})`,
              `new Blob([], ${bag})`,
              `new Event("x", ${bag})`,
              `new Response("", ${bag})`,
              `new EventTarget().addEventListener("x", () => {}, ${bag})`,
              `Object.defineProperty({}, "k", ${bag})`,
              `Object.create(null, ${bag})`,
              `new Proxy({}, ${bag}).k`,
            ])
          : this.pick([
              `JSON.stringify(${bag})`,
              `JSON.stringify(1, ${bag})`,
              `JSON.parse("1", ${bag})`,
              `Object.assign({}, ${bag})`,
              `Object.entries(${bag})`,
              `Reflect.ownKeys(${bag})`,
              `Array.from(${bag})`,
              `new Proxy(${bag}, {})`,
              `Promise.resolve(${bag})`,
              `Object.freeze(${bag})`,
              `Object.create(${bag})`,
              `Object.defineProperties({}, ${bag})`,
              `new Uint8Array(${bag})`,
              `new Set([${bag}])`,
              `new WeakRef(${bag})`,
              `String(${bag})`,
              `Number(${bag})`,
              `[${bag}].join()`,
              `[${bag}].flat()`,
              `[].concat(${bag})`,
              `structuredClone(${bag})`,
              `new URLSearchParams(${bag})`,
              `Reflect.apply(Math.max, ${bag}, [])`,
              `[1].map(Math.abs, ${bag})`,
              `new Promise(() => {}).then(${bag})`,
              `Symbol(${bag})`,
              `new RegExp("a", ${bag})`,
              `AbortSignal.abort(${bag})`,
              `(globalThis${asAny}).seen${id} = ${bag}`,
            ]);
      this.emit(1, ...this.several(1, 2, () => `try { ${handsOver()}; } catch {}`));
      const asked = [made];
      if (this.chance(40)) {
        this.emit(1, `const ${next}${any} = ${create};`);
        asked.push(next);
      }
      for (let changes = this.pick([0, 0, 1, 1, 2]); changes > 0; changes--) {
        const [changed, field] = [this.pick(asked), this.pick(fields)];
        if (this.chance(50)) this.emit(1, asks(changed, field, 1, 3));
        this.emit(
          1,
          `try { ${this.pick([
            `delete ${changed}.${field}`,
            `${changed}.extra = 1`,
            `${changed}.${field} = "again"`,
            `${changed}.${field} = ${held()}`,
            `${changed}.${field} = ${held()}`,
            `${changed}["${field}"] = ${held()}`,
            `((o${any}) => { o.${field} = ${held()}; })(${changed})`,
            `[${asked.join(", ")}].forEach((o${any}) => { o.${field} = ${held()}; })`,
            `Reflect.set(${changed}, "${field}", ${held()})`,
            `Object.assign(${changed}, { ${field}: ${held()} })`,
            `Object.defineProperty(${changed}, "${field}", { value: ${held()}, writable: true, enumerable: true, configurable: true })`,
            `delete ${changed}.${field}; ${changed}.${field} = ${held()}`,
            `Object.defineProperty(${changed}, "${field}", { enumerable: false })`,
            `Object.defineProperty(${changed}, "extra", { value: 1 })`,
            `Object.assign(${changed}, { extra: 2 })`,
            `Object.freeze(${changed})`,
            `Object.setPrototypeOf(${changed}, { up: 1 })`,
          ])}; } catch {}`,
        );
      }
      for (const o of asked) {
        for (const field of [...fields, "extra", "absent"]) this.emit(1, asks(o, field, 2, 5));
        this.emit(
          1,
          ...this.several(2, 5, () =>
            this.pick([
              `note(Object.keys(${o}).join());`,
              `note(Object.getOwnPropertyNames(${o}).join());`,
              `{ let seen = ""; for (const key in ${o}) seen += key + ","; note(seen); }`,
              `note(Object.keys({ ...${o} }).join());`,
              `note(Object.entries(${o}).length);`,
              `note(Object.isExtensible(${o})); note(Object.isFrozen(${o}));`,
              `note(${o} instanceof ${Made});`,
              `note(Object.getPrototypeOf(${o}) === ${Made}.prototype);`,
              `note(${o}.constructor === ${Made});`,
            ]),
          ),
        );
      }
    }
    this.emit(1, `printValue("objects handed to the language ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A function makes a list: a literal of one kind of element or of several, a spread, or what a function of the language returns. It changes the list once or twice in a way that
   * may move the elements to another kind of storage: a store far behind the end, a large or a small length, an element of another kind, a deleted element, an accessor at an index,
   * a freeze, a key that only looks like an index. Then it reads the list in several ways. The functions are called by name, out of a list of functions, as callbacks, and many times.
   */
  sceneOfListsThatChangeTheirStorage() {
    const number = ++this.count;
    const any = this.typed("any");
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { let text; try { text = JSON.stringify(value) ?? String(value); } catch (error) { text = "threw"; } out += text + ";"; }`,
    );
    const cases: string[] = [];
    for (let index = this.pick([2, 3, 4, 6]); index > 0; index--) {
      const name = `list${number}_${index}`;
      cases.push(name);
      const [maker, type] = this.pick<[string, string]>([
        ["[1, 2, 3]", "number[]"],
        ["[1, 2, 3]", "number[]"],
        ["[1.5, 2.5]", "number[]"],
        [`["a", "b"]`, "string[]"],
        [`[{ k: 1 }, 1, "a"]`, "unknown[]"],
        ["[]", "number[]"],
        ["[1, , 3]", "(number | undefined)[]"],
        ["[...[8, 9]]", "number[]"],
        [`[..."abc"]`, "string[]"],
        ["Object.keys({ k: 1, l: 2 })", "string[]"],
        ["Object.keys({ k: 1, l: 2 })", "string[]"],
        ["Object.keys({ k: 1 })", "string[]"],
        ["Object.values({ k: 1, l: 2 })", "number[]"],
        ["Object.entries({ k: 1 })", "[string, number][]"],
        ["Object.getOwnPropertyNames({ k: 1, l: 2 })", "string[]"],
        ["Reflect.ownKeys({ k: 1 })", "(string | symbol)[]"],
        [`"a,b,c".split(",")`, "string[]"],
        [`"abc".match(/b/)`, "any"],
        ["Array.from({ length: 3 }, (_, at) => at)", "number[]"],
        ["Array.of(1, 2)", "number[]"],
        ["new Array(3)", "number[]"],
        ["new Array(3).fill(0)", "number[]"],
        ["[1, 2, 3].map(x => x * 2)", "number[]"],
        ["[1, 2, 3].filter(x => x > 1)", "number[]"],
        ["[1, 2, 3].slice()", "number[]"],
        ["[1, 2].concat([4])", "number[]"],
        [`JSON.parse("[1,2,3]")`, "number[]"],
        [`((...rest${this.typed("number[]")}) => rest)(1, 2)`, "number[]"],
        ["structuredClone([1, 2])", "number[]"],
      ]);
      const change = () =>
        this.pick([
          `a[5000] = "far";`,
          `a[5000] = "far";`,
          `a[5000] = 7;`,
          `a[100000] = 1;`,
          `a.length = 200000;`,
          `a.length = 200000;`,
          `a.length = 20000;`,
          `a.length = 0;`,
          `a.length = 1;`,
          `a[a.length + 5] = 4;`,
          `a[a.length] = 4;`,
          `a[1] = 1.5;`,
          `a[1] = "text";`,
          `a[0] = { k: 2 };`,
          `a[0] = undefined;`,
          `delete a[0];`,
          `a.push(1.5);`,
          `a.push("x");`,
          `a.unshift(0);`,
          `a.shift();`,
          `a.pop();`,
          `a.splice(1, 0, "in");`,
          `a.reverse();`,
          `a.sort();`,
          `a.fill(0.5);`,
          `a.copyWithin(0, 1);`,
          `Object.defineProperty(a, 0, { get() { return "got"; }, configurable: true });`,
          `Object.defineProperty(a, 1, { value: "fixed", writable: false });`,
          `Object.defineProperty(a, "length", { writable: false });`,
          `Object.freeze(a);`,
          `Object.seal(a);`,
          `Object.preventExtensions(a);`,
          `a[-1] = 1;`,
          `a["01"] = 1;`,
          `a.extra = 1;`,
          `a[4294967295] = 1;`,
        ]);
      const read = () =>
        this.pick([
          "a[0]",
          "a[0]",
          "a[1]",
          "a[2]",
          "a[a.length - 1]",
          "a.at(0)",
          "a.at(0)",
          "a.at(-1)",
          "a.length",
          "a.length",
          "a.includes(undefined)",
          "a.indexOf(2)",
          "a.lastIndexOf(2)",
          "a.join().length",
          "a.slice(0, 3)",
          "[...a].length",
          "(([first, second]) => [first, second])(a)",
          "a.map(x => x).length",
          "(() => { let seen = 0; a.forEach(() => seen++); return seen; })()",
          "(() => { const seen = []; for (const x of a) { if (seen.length < 3) seen.push(x); } return seen; })()",
          "(() => { let sum = 0; for (let at = 0; at < a.length; at++) if (a[at] !== undefined) sum++; return sum; })()",
          "Object.keys(a).length",
          "0 in a",
          "a.hasOwnProperty(1)",
          "a.findLast(x => x !== undefined)",
          "a.reduce(count => count + 1, 0)",
          "a.flat().length",
          "a.concat([1]).length",
          "a.entries().next().value",
          "a.toString().length",
        ]);
      const typeOfList = this.isTypeScript ? this.pick([": any", ": any", `: ${type}`, ""]) : "";
      this.emit(
        1,
        `function ${name}()${any} { const a${typeOfList} = ${maker}; ${this.several(1, 2, () => `try { ${change()} } catch {}`).join(" ")} return [${this.several(4, 8, read).join(", ")}]; }`,
      );
    }
    for (const name of cases)
      if (this.chance(40))
        this.emit(
          1,
          this.pick([
            `try { note(${name}()); } catch (error) { note("threw"); }`,
            `for (let turn = 0; turn < ${this.pick([2, 3, 12])}; turn++) try { const got = ${name}(); if (turn === 0) note(got); } catch (error) { note("threw"); }`,
            `try { note([1].map(() => ${name}())); } catch (error) { note("threw"); }`,
          ]),
        );
    this.emit(
      1,
      `for (const made of [${cases.join(", ")}]) try { note(made()); } catch (error) { note("threw"); }`,
      `printValue("lists that change their storage ${number}", out);`,
    );
    this.lines.push("}");
  }

  /**
   * A function makes function expressions, arrows, methods, classes and bound functions in a loop and uses them as more than callees: as new.target, as a constructor, on the right of
   * instanceof, as a prototype, below `extends`, through call, apply, bind and Reflect.apply, as callbacks of the language. It asks them for prototype, name, length and their own names,
   * gives them members, renames and freezes them. Most uses keep nothing. What each use gives is printed as a primitive.
   */
  sceneOfFunctionsUsedAsMoreThanCallees() {
    const number = ++this.count;
    const any = this.typed("any");
    this.lines.push("{");
    this.emit(1, `let out = "";`, `function note(value${any})${this.typed("void")} { out += String(value) + ";"; }`);
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [Base, Derived, Plain, make] = ["Base", "Derived", "Plain", "make"].map(name => name + id);
      this.emit(
        1,
        `function ${Base}(${this.isTypeScript ? "this: any" : ""}) { ${this.pick(["if (new.target) {}", "if (new.target) {}", "this.made = typeof new.target;", ""])} }`,
        `class ${Derived} extends (${Base}${this.isTypeScript ? " as any" : ""}) {}`,
        `class ${Plain} { ${this.isTypeScript ? "made: any; " : ""}constructor() { this.made = new.target === ${Plain}; } }`,
      );
      const made = () =>
        this.pick([
          "function () { return turn; }",
          "function () { return turn; }",
          "function () {}",
          "function named() { return turn + base; }",
          "() => turn",
          "() => turn + base",
          "class { get mark() { return turn; } }",
          "class { static mark = turn; }",
          `class extends ${Derived} {}`,
          `class extends ${Plain} {}`,
          "{ method() { return turn; } }.method",
          "async function () { return turn; }",
          "function* () { yield turn; }",
          "function () { return turn; }.bind(null)",
          "(() => turn).bind(null)",
        ]);
      const use = () =>
        this.pick([
          `typeof Reflect.construct(${Derived}, [], f)`,
          `typeof Reflect.construct(${Derived}, [], f)`,
          `typeof Reflect.construct(${Base}, [], f)`,
          `typeof Reflect.construct(${Base}, [], f)`,
          `Reflect.construct(${Plain}, [], f).made`,
          "typeof Reflect.construct(Object, [], f)",
          "typeof Reflect.construct(Array, [], f)",
          "typeof Reflect.construct(Map, [], f)",
          "typeof Reflect.construct(f, [])",
          `typeof Reflect.construct(f, [], ${Base})`,
          "typeof new f()",
          "{} instanceof f",
          `new ${Derived}() instanceof f`,
          "f instanceof Function",
          "Object.getPrototypeOf(Object.create(f)) === f",
          "typeof Object.setPrototypeOf({}, f)",
          "typeof f.prototype",
          "f === f.prototype?.constructor",
          "f.name",
          "f.length",
          "(f.extra = turn, f.extra)",
          "Object.keys(f).length",
          "Object.getOwnPropertyNames(f).join()",
          `f.hasOwnProperty("prototype")`,
          `"prototype" in f`,
          "typeof f.bind(null)",
          "typeof new (f.bind(null))()",
          "typeof f.call(null)",
          "typeof f.apply(null, [])",
          "typeof Reflect.apply(f, null, [])",
          "typeof class extends f {}",
          "typeof new (class extends f {})()",
          "[1].map(f).length",
          "Array.from({ length: 1 }, f).length",
          "[2, 1].sort(f).length",
          "typeof new Proxy(f, {})",
          "String(f).length > 0",
          "Object.isFrozen(Object.freeze(f))",
          `(Object.defineProperty(f, "name", { value: "renamed" }), f.name)`,
          `(Object.defineProperty(f, "prototype", { value: { up: turn } }), typeof f.prototype)`,
          "(f.prototype = { up: turn }, typeof new f())",
          "typeof new Promise(f).catch(() => {})",
          "typeof Promise.resolve(1).then(f).catch(() => {})",
          "JSON.stringify({ k: 1 }, f)",
          `"ab".replace("a", f).length`,
          "typeof new WeakRef(f)",
          "typeof f[Symbol.hasInstance]",
        ]);
      const turns = this.pick([1, 2, 3, 5]);
      this.lines.push(`    function ${make}(base${this.typed("number")})${this.typed("void")} {`);
      this.lines.push(`        for (let turn = 0; turn < ${turns}; turn++) {`);
      for (let functions = this.pick([1, 1, 2, 3]); functions > 0; functions--) {
        this.lines.push("            {");
        this.emit(
          4,
          `const f${any} = ${made()};`,
          ...this.several(1, 4, () => `try { note(${use()}); } catch (error) { note("threw"); }`),
        );
        this.lines.push("            }");
      }
      this.lines.push("        }");
      this.lines.push("    }");
      this.emit(
        1,
        ...this.several(1, 2, () => `${make}(${this.pick(["0", "1", "10"])});`),
        `{ let total = 0; for (let i = 0; i < 200; i++) { const filler${any} = { mark: i, more: [i, i + 1], call: function () { return i; } }; total += filler.mark + filler.more[1] + filler.call(); } note(total); }`,
      );
    }
    this.emit(
      1,
      `for (let tick = 0; tick < 5; tick++) await null;`,
      `printValue("functions used as more than callees ${number}", out);`,
    );
    this.lines.push("}");
  }

  /**
   * A function, a method of a literal or a method of a class uses `this` by the kinds of its members. It is called at home, for the one object that it was written for, and then in odd ways
   * that hand it another `this`: through a Proxy, as a tagged template, detached from its object, for undefined, null, a number, a text or an object whose members are of other kinds, as a
   * constructor, as an accessor or a conversion hook of another object, out of a list, and as a callback of the language with and without a `this` for it. Then it is called at home again.
   */
  sceneOfFunctionsCalledWithAnotherThis() {
    const number = ++this.count;
    const any = this.typed("any");
    const thisAny = this.isTypeScript ? "this: any, " : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { let text; try { text = typeof value === "function" ? "function" : typeof value === "object" && value !== null ? "object " + Object.keys(value).join() : String(value); } catch (error) { text = "cannot be shown"; } out += text + ";"; }`,
    );
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [self, other, target] = ["self", "other", "target"].map(name => name + id);
      const body = this.pick([
        "return this.n + a;",
        "return this.n + a;",
        "return this.n * 2;",
        "return this.name + typeof a;",
        "return this.name.length;",
        `return this === ${self} ? "self" : this === undefined ? "undefined" : this === ${other} ? "other" : typeof this;`,
        `return this === ${self} ? "self" : this === undefined ? "undefined" : this === ${other} ? "other" : typeof this;`,
        "return typeof this;",
        "return this.list[0];",
        "return this.list.length;",
        "return this.inner.k;",
        "return this?.n;",
        "this.count = (this.count ?? 0) + 1; return this.count;",
        "return Object.keys(this ?? {}).length;",
      ]);
      const members = `name: "self", n: 1.5, list: [1], inner: { k: 1 }`;
      const kind = this.pick(["function", "function", "literal", "class"]);
      if (kind === "function")
        this.emit(
          1,
          `function ${target}(${thisAny}a${any})${any} { ${body} }`,
          `const ${self}${any} = { ${members}, m: ${target} };`,
        );
      else if (kind === "literal")
        this.emit(
          1,
          `const ${self}${any} = { ${members}, m(${thisAny}a${any})${any} { ${body} } };`,
          `const ${target}${any} = ${self}.m;`,
        );
      else
        this.emit(
          1,
          `class Home${id} { name${any} = "self"; n${any} = 1.5; list${any} = [1]; inner${any} = { k: 1 }; count${any}; m(${thisAny}a${any})${any} { ${body} } }`,
          `const ${self}${any} = new Home${id}();`,
          `const ${target}${any} = ${self}.m;`,
        );
      this.emit(
        1,
        `const ${other}${any} = ${this.pick([
          `{ name: "other", n: "text", list: "no list", inner: null }`,
          `{ name: 7, n: { valueOf() { return 2; } }, list: { 0: "zero", length: 1 }, inner: { k: "text" } }`,
          `{ n: 1 }`,
          "{}",
          `Object.create(${self})`,
          "[1.5]",
        ])};`,
      );
      const atHome = () =>
        this.pick([
          `${target}.call(${self}, 1)`,
          `${target}.call(${self}, 1)`,
          `${self}.m(1)`,
          `${self}.m(1)`,
          `${target}.apply(${self}, [1])`,
          `${target}.bind(${self})(1)`,
          `Reflect.apply(${target}, ${self}, [1])`,
        ]);
      const oddly = () =>
        this.pick([
          `new Proxy(${target}, {})(10)`,
          `new Proxy(${target}, {})(10)`,
          `new Proxy(${target}, {})(10)`,
          `new Proxy(${target}, {})\`x\``,
          `new Proxy(${target}, {}).call(${other}, 1)`,
          `new Proxy(${self}, {}).m(1)`,
          `new Proxy(${other}, { get: (held, key) => (key === "m" ? ${target} : held[key]) }).m(1)`,
          `${target}\`x\``,
          `(0, ${self}.m)(1)`,
          `(({ m }) => m(1))(${self})`,
          `(${self}.m || 0)(1)`,
          `(${self} ? ${self}.m : 0)(1)`,
          `${self}.m?.(1)`,
          `${target}(1)`,
          `${target}.call(undefined, 1)`,
          `${target}.call(null, 1)`,
          `${target}.call(5, 1)`,
          `${target}.call("text", 1)`,
          `${target}.call(${other}, 1)`,
          `${target}.call(${other}, 1)`,
          `${target}.apply(${other}, [1])`,
          `${target}.bind(${other})(1)`,
          `${target}.bind(undefined)(1)`,
          `Reflect.apply(${target}, ${other}, [1])`,
          `Reflect.apply(${target}, undefined, [1])`,
          `new ${target}(1)`,
          `Reflect.construct(${target}, [1])`,
          `(${other}.m = ${target}, ${other}.m(1))`,
          `Object.create(${self}).m(1)`,
          `({ __proto__: ${self} }).m(1)`,
          `(list => list[0](1))([${target}])`,
          `({ ${target} }).${target}(1)`,
          `Object.defineProperty({ n: 3 }, "g", { get: ${target} }).g`,
          `(Object.defineProperty({ n: 3 }, "s", { set: ${target} }).s = 1)`,
          `JSON.stringify({ n: 4, toJSON: ${target} })`,
          `+{ n: 4, valueOf: ${target} }`,
          `\`\${{ n: 4, name: "hook", [Symbol.toPrimitive]: ${target} }}\``,
          `[1].map(${target})`,
          `[1].map(${target}, ${other})`,
          `[1].map(${self}.m, ${self})`,
          `Array.from([1], ${target})`,
          `Array.from([1], ${target}, ${other})`,
          `"a".replace("a", ${target})`,
          `[2, 1].sort(${target}).length`,
          `JSON.stringify({ k: 1 }, ${target})`,
          `JSON.parse("[1]", ${target})`,
          `typeof new Promise(${target}).catch(() => {})`,
          `typeof Promise.resolve(1).then(${target}).catch(() => {})`,
        ]);
      const noted = (call: string) =>
        `try { note(${call}); } catch (error) { note((error${this.isTypeScript ? " as any" : ""})?.constructor?.name); }`;
      this.emit(
        1,
        ...this.several(1, 3, () =>
          this.chance(25)
            ? `for (let turn = 0; turn < ${this.pick([3, 20])}; turn++) ${noted(atHome())}`
            : noted(atHome()),
        ),
        ...this.several(1, 4, () => noted(oddly())),
        noted(atHome()),
      );
    }
    this.emit(
      1,
      `for (let tick = 0; tick < 5; tick++) await null;`,
      `printValue("functions called with another this ${number}", out);`,
    );
    this.lines.push("}");
  }

  /**
   * A member of a literal first holds a value of one kind: a function, an object, a list, a number, a text. Something is asked of it, a value of another kind is written over it,
   * and the object is copied: by Object.assign, a spread or a rest pattern. The copy tells the kind of the member, its value, whether it is there, and the keys in their order.
   * Each function has names of its own and runs once or a few times. In TypeScript the object is `any`, of a declared type, or of the type of its literal.
   */
  sceneOfMembersWrittenOverByAnotherKind() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += String(value) + ";"; }`,
      `const seen = 7;`,
    );
    for (let index = this.pick([1, 1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [m, n] = [`m${id}`, `n${id}`];
      const [first, type] = this.pick<[string, string]>([
        [`${n}: () => 1`, "() => number"],
        [`${n}: () => 1`, "() => number"],
        [`${n}: () => 1`, "() => number"],
        [`${n}: () => seen`, "() => number"],
        [`${n}: function () { return 1; }`, "() => number"],
        [`${n}: function named() { return 1; }`, "() => number"],
        [`${n}() { return 1; }`, "() => number"],
        [`${n}() { return 1; }`, "() => number"],
        [`${n}: async () => 1`, "() => Promise<number>"],
        [`${n}: function* () {}`, "() => Generator"],
        [`${n}: class {}`, "new () => object"],
        [`${n}: { k: 1 }`, "{ k: number }"],
        [`${n}: [1]`, "number[]"],
        [`${n}: 1`, "number"],
        [`${n}: 0.5`, "number"],
        [`${n}: "t"`, "string"],
        [`${n}: null`, "null"],
        [`${n}: true`, "boolean"],
      ]);
      const isNumber = type === "number";
      const other = () =>
        this.pick([
          "5",
          "5",
          "5",
          "0.5",
          "-0",
          "NaN",
          '"t"',
          "null",
          "undefined",
          "true",
          "() => 2",
          "{ k: 2 }",
          "[2]",
          "7n",
        ]);
      const over = this.pick([
        () => `o.${n} = ${other()};`,
        () => `o.${n} = ${other()};`,
        () => `o.${n} = ${other()};`,
        () => `o.${n} = ${other()};`,
        () => `o.${n}++;`,
        () => `o.${n}++;`,
        () => `--o.${n};`,
        () => (isNumber ? `o.${n} += 1;` : `o.${n} = +o.${n};`),
        () => `o.${n} &&= ${other()};`,
        () => `o.${n} ||= ${other()};`,
        () => `o.${n} ??= ${other()};`,
        () => `[o.${n}] = [${other()}];`,
        () => `({ k: o.${n} } = { k: ${other()} });`,
        () => `o["${n}"] = ${other()};`,
        () => `o[key] = ${other()};`,
        () => `Object.assign(o, { ${n}: ${other()} });`,
        () => `Reflect.set(o, "${n}", ${other()});`,
        () =>
          `Object.defineProperty(o, "${n}", { value: ${other()}, writable: true, enumerable: true, configurable: true });`,
        () => `delete o.${n};`,
        () => `delete o.${n}; o.${n} = ${other()};`,
        () => `const same = o; same.${n} = ${other()};`,
        () => `((given${any}) => { given.${n} = ${other()}; })(o);`,
        () => `if (seen > 0) o.${n} = ${other()};`,
        () => `for (let turn = 0; turn < 2; turn++) o.${n} = turn === 0 ? ${other()} : ${other()};`,
      ])();
      const front = () =>
        this.pick([
          `note("${n}" in o);`,
          `note("${n}" in o);`,
          `note("${n}" in o ? typeof o.${n} : "lost");`,
          `note("${n}" in o ? typeof o.${n} : "lost");`,
          `note(key in o);`,
          `note(Object.hasOwn(o, "${n}"));`,
          `note(typeof o.${n});`,
          `note(typeof o.${n}?.name);`,
          `note(o.${n} ? 1 : 0);`,
          `note(typeof o.${n} === "function" ? typeof o.${n}() : "no call");`,
          `note(Object.keys(o).length);`,
          `note(o.${m});`,
        ]);
      const copy = this.pick([
        "o = Object.assign({}, o); const r = o;",
        "o = Object.assign({}, o); const r = o;",
        "const r = Object.assign({}, o);",
        "const r = Object.assign({ z: 1 }, o);",
        `const r = Object.assign({ ${n}: 0 }, o);`,
        "o = { ...o }; const r = o;",
        "const r = { ...o };",
        "const r = { ...o, z: 1 };",
        "const r = { z: 1, ...o };",
        `const { ${m}: taken, ...r } = o;`,
        `const { ${m}: taken, ...r } = o;`,
        "const { nobody, ...r } = o;",
        "const r = { ...{ ...o } };",
        "const r = Object.fromEntries(Object.entries(o));",
        "const r = o;",
      ]);
      const fields = this.pick([
        [`${m}: 1`, first],
        [`${m}: 1`, first],
        [first, `${m}: 1`],
        [`${m}: 1`, first, `l${id}: "x"`],
        [`${m}: () => 0`, first],
      ]);
      const declared = this.isTypeScript
        ? this.pick([
            ": any",
            ": any",
            ": any",
            `: { ${m}: any; ${n}: ${type}; l${id}?: string }`,
            `: { ${m}: any; ${n}: ${type}; l${id}?: string }`,
            "",
          ])
        : "";
      this.lines.push(`    function over${id}()${this.typed("void")} {`);
      this.emit(
        2,
        `const key = "${n}";`,
        `let o${declared} = { ${fields.join(", ")} };`,
        ...this.several(0, 2, front),
        over,
        ...(this.chance(30) ? [front()] : []),
        ...copy.split(/(?<=;) /),
        `note(typeof r.${n});`,
        `note(typeof r.${n} === "function" ? "a function" : typeof r.${n} === "object" ? JSON.stringify(r.${n}) : Object.is(r.${n}, -0) ? "-0" : String(r.${n}));`,
        `note("${n}" in r);`,
        `note(Object.keys(r).join());`,
        ...(this.chance(30) ? [`note(typeof o.${n});`, `note(Object.keys(o).join());`] : []),
      );
      this.lines.push("    }");
      this.emit(
        1,
        `${this.pick(["", "", "for (let turn = 0; turn < 2; turn++) ", "for (let turn = 0; turn < 5; turn++) "])}try { over${id}(); } catch (error) { note("threw " + (error${asAny})?.constructor?.name); }`,
      );
    }
    this.emit(1, `printValue("members written over ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * Loops carry a variable from turn to turn that does not stay: it flips between two values, walks round three, swaps with a second variable, lags a turn behind, or changes once, late.
   * The values are constants and reads that stay the same through the loop (a member, an element, a parameter, a length). Every turn also makes something (a text through a small helper,
   * a list, a literal, a closure); many loops have a second counter, a second way to end and a path that is seldom taken. Plain functions and generators; what the variable held is told
   * turn by turn and once more behind the loop.
   */
  sceneOfVariablesThatChangeFromTurnToTurn() {
    const number = ++this.count;
    this.lines.push("{");
    this.emit(
      1,
      `let told = "";`,
      `function show(value${this.typed("unknown")})${this.typed("string")} { return typeof value === "object" && value !== null ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value); }`,
      `function num(value${this.typed("number")})${this.typed("string")} { return Object.is(value, -0) ? "-0" : String(value); }`,
      `const first = { k: 1 };`,
      `const second = { k: 2 };`,
      `const third = { k: 3 };`,
    );
    for (let index = this.pick([1, 1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [type, constants, outside] = this.pick<[string, string[], string]>([
        ["number", ["9", "3", "5"], "7"],
        ["number", ["9", "3", "5"], "7"],
        ["number", ["9", "3", "5"], "7"],
        ["number", ["1", "0", "2"], "4"],
        ["number", ["0.5", "2", "-0"], "7"],
        ["number", ["2147483647", "-1", "4294967296"], "0"],
        ["string", ['"on"', '"off"', '"idle"'], '"?"'],
        ["boolean", ["true", "false", "true"], "false"],
        ["number | string", ["9", '"3"', "5"], "7"],
        ["number | undefined", ["9", "undefined", "3"], "7"],
        ["{ k: number } | null", ["first", "null", "second"], "third"],
        ["{ k: number }", ["first", "second", "third"], "{ k: 4 }"],
      ]);
      const isNumber = type === "number";
      const way = this.pick(["constants", "constants", "constants", "members", "elements", "parameters", "lengths"]);
      const areLengths = way === "lengths" && constants.every(constant => /^\d$/.test(constant));
      const [p, q, r] =
        way === "members"
          ? ["box.p", "box.q", "box.r"]
          : way === "elements"
            ? ["values[0]", "values[1]", "values[2]"]
            : way === "parameters"
              ? ["p", "q", "r"]
              : areLengths
                ? ["listP.length", "listQ.length", "listR.length"]
                : constants;
      const turns = this.pick([3, 3, 3, 4, 5, 8, 20, 100]);
      const most = this.pick([turns * 2, turns * 2, turns * 2, turns, turns - 1]);
      const late = this.pick([1, 2, turns - 1, turns >> 1]);
      const [before, head, tail] = this.pick<[string[], string, string]>([
        [[], `for (let turn = 0; turn < ${turns} && spent++ < ${most}; turn++) {`, "}"],
        [[], `for (let turn = 0; turn < ${turns} && spent++ < ${most}; turn++) {`, "}"],
        [[], `for (let turn = 0; turn < ${turns} && spent++ < ${most}; turn++) {`, "}"],
        [[], `for (let turn = 0; turn < ${turns} && spent++ < ${most}; turn++) {`, "}"],
        [[], `for (let turn = 0; turn < ${turns}; turn++) {`, "}"],
        [[], `for (let turn = ${turns - 1}; turn >= 0 && spent++ < ${most}; turn--) {`, "}"],
        [[`const walked = Array.from({ length: ${turns} }, (_, at) => at);`], `for (const turn of walked) {`, "}"],
        [[`let turn = -1;`], `while (++turn < ${turns} && spent++ < ${most}) {`, "}"],
        [[`let turn = -1;`], `while (++turn < ${turns}) {`, "}"],
        [[`let turn = 0;`], `do {`, `} while (++turn < ${turns});`],
      ]);
      const step = this.pick<string[]>([
        [`a = a === ${p} ? ${q} : ${p};`],
        [`a = a === ${p} ? ${q} : ${p};`],
        [`a = a === ${p} ? ${q} : ${p};`],
        [`a = a === ${p} ? ${q} : ${p};`],
        [`if (a === ${p}) a = ${q}; else a = ${p};`],
        [`if (a === ${p}) a = ${q}; else a = ${p};`],
        [`a = a !== ${p} ? ${p} : ${q};`],
        [`a = ${p};`, `if (turn === ${late}) a = ${q};`],
        [`a = turn === ${late} ? ${q} : ${p};`],
        [`a = a === ${p} ? ${q} : a === ${q} ? ${r} : ${p};`],
        [`a = a === ${p} ? ${q} : a === ${q} ? ${r} : ${p};`],
        [`switch (a) { case ${p}: a = ${q}; break; case ${q}: a = ${r}; break; default: a = ${p}; }`],
        [`[a, b] = [b, a];`],
        [`const held = a;`, `a = b;`, `b = held;`],
        [`b = a;`, `a = a === ${p} ? ${q} : ${p};`],
        [`b = a === ${p} ? ${q} : ${p};`, `a = b;`],
        [`a = flip(a);`],
        [`a = turn % 2 === 0 ? ${p} : ${q};`],
        [`if (turn === ${late}) a = ${q};`],
        [`a = ${p};`],
        ...(isNumber ? [[`a = ${p} + ${q} - a;`], [`a = -a;`], [`a ^= 1;`]] : []),
      ]);
      const use = this.pick([
        ...(isNumber
          ? [
              `out += num((a + a) >>> 0) + " ";`,
              `out += num((a + a) >>> 0) + " ";`,
              `out += num(a) + " ";`,
              `out += num(a) + " ";`,
              `out += num(a) + " ";`,
              `out += num(a + 1) + " ";`,
            ]
          : []),
        `out += show(a) + " ";`,
        `out += show(a) + " ";`,
        `out += show(a) + " ";`,
        `out += String(a) + " ";`,
        `out += a + " ";`,
        "out += `${a} `;",
        `seen.push(a);`,
        `seen.push([a]);`,
        `seen.push({ held: a });`,
        `seen.push(() => a);`,
        `seen.push(show(a));`,
      ]);
      const seldom = this.pick([
        `if (turn === ${late}) a = ${r};`,
        `if (turn === ${late}) a = ${r};`,
        `if (turn === ${late}) a = ${r};`,
        `if ((turn & 7) === 7) a = ${r};`,
        `if (typeof a === "symbol") a = ${r};`,
        `if (spent++ >= ${most}) break;`,
        `if (spent++ >= ${most}) break;`,
        `if (turn === ${late}) continue;`,
        `if (turn === ${late}) out += "!";`,
        `if (turn === ${late}) seen.push("late");`,
        `try { if (turn === ${late}) throw new Error("late"); } catch { a = ${r}; }`,
      ]);
      const isGenerator = this.chance(35);
      const body = this.pick([
        [...step, use],
        [...step, use],
        [...step, use],
        [seldom, ...step, use],
        [...step, seldom, use],
        [...step, use, seldom],
      ]);
      if (isGenerator && this.chance(35)) body.push(`yield turn;`);
      const uses = (name: string) => [head, tail, ...body].some(line => new RegExp(`\\b${name}\\b`).test(line));
      const declared = this.isTypeScript ? this.pick([`: ${type}`, `: ${type}`, `: ${type}`, ": any", ""]) : "";
      const parameter = (name: string) => (this.isTypeScript ? `${name}: ${type}` : name);
      this.emit(
        1,
        `function orStart${id}(${this.isTypeScript ? `value?: ${type}` : "value"})${this.typed(type)} { return value === undefined ? ${outside} : value; }`,
        `function${isGenerator ? "*" : ""} turns${id}(${["given", "p", "q", "r"].map(parameter).join(", ")})${this.typed(isGenerator ? "Generator<number, string, unknown>" : "string")} {`,
      );
      this.emit(
        2,
        `let out = "";`,
        ...(uses("spent") ? [`let spent = 0;`] : []),
        ...(uses("seen") ? [`const seen${this.typed("any[]")} = [];`] : []),
        ...(way === "members" ? [`const box = { p: ${constants[0]}, q: ${constants[1]}, r: ${constants[2]} };`] : []),
        ...(way === "elements" ? [`const values = [${constants.join(", ")}];`] : []),
        ...(areLengths
          ? ["P", "Q", "R"].map((name, at) => `const list${name} = new Array(${constants[at]}).fill(0);`)
          : []),
        ...(uses("flip") ? [`const flip = (value${this.typed("any")}) => (value === ${p} ? ${q} : ${p});`] : []),
        `let a${declared} = ${this.pick([`orStart${id}()`, `orStart${id}()`, `orStart${id}(given)`, "given", outside, constants[0]])};`,
        ...(uses("b") ? [`let b${declared} = ${this.pick([q, q, p, outside])};`] : []),
        ...before,
        head,
      );
      this.emit(3, ...body);
      this.emit(
        2,
        tail,
        ...(uses("seen")
          ? [`for (const kept of seen) out += (typeof kept === "function" ? show(kept()) : show(kept)) + ",";`]
          : []),
        uses("b")
          ? `return out + show(a) + " " + show(b);`
          : this.pick([`return out + show(a);`, `return out + show(a);`, `return out + a;`]),
      );
      this.emit(1, "}");
      const given = `${this.pick([outside, outside, constants[0], constants[1]])}, ${constants.join(", ")}`;
      if (isGenerator)
        this.emit(
          1,
          `const steps${id} = turns${id}(${given});`,
          `let result${id} = steps${id}.next();`,
          `for (let more = 0; more < 300 && !result${id}.done; more++) result${id} = steps${id}.next(result${id}.value);`,
          `told += result${id}.value + "|";`,
        );
      else
        this.emit(
          1,
          `${this.pick(["", "", "for (let again = 0; again < 2; again++) ", "for (let again = 0; again < 5; again++) "])}told += turns${id}(${given}) + "|";`,
        );
    }
    this.emit(1, `printValue("variables from turn to turn ${number}", told);`);
    this.lines.push("}");
  }

  /**
   * A literal comes back under a second name: a built-in hands back its receiver, an argument or an element; or it calls a member, a getter, a trap or a callback of the program and hands on what
   * that returned; or it hands the literal to a function of the program as `this`. The literal is changed through the second name (a member is added, deleted, redefined or given a value of
   * another kind; the object is frozen, sealed or given another prototype) and then read through the first: its keys in order, its members by name, whether it is frozen. Half the time another
   * function takes another literal the same way, and its callee hands back something else.
   */
  sceneOfLiteralsChangedThroughASecondName() {
    const number = ++this.count;
    const any = this.typed("any");
    const self = "Object.prototype.valueOf";
    const like = "{ length: 1, 0: made }";
    const handsOn = "{ next() { return { done: false, value: made }; } }";
    const plain = [
      "made.valueOf()",
      `${self}.call(made)`,
      `${self}.apply(made, [])`,
      `${self}.bind(made)()`,
      `Reflect.apply(${self}, made, [])`,
      `Function.prototype.call.bind(${self})(made)`,
      `Function.prototype.call.call(${self}, made)`,
      "Object(made)",
      "new Object(made)",
      "Reflect.construct(Object, [made])",
      "Reflect.apply(Object, undefined, [made])",
      "Object.assign(made)",
      "Object.assign(made, {})",
      "Object.defineProperties(made, {})",
      "Object.setPrototypeOf(made, Object.prototype)",
      `[0].map(${self}, made)[0]`,
      `[0].flatMap(${self}, made)[0]`,
      `Array.from([0], ${self}, made)[0]`,
      "[made].map(Object)[0]",
      "Array.from([made], Object)[0]",
      "[made].values().map(Object).next().value",
      "[made].find(Boolean)",
      "[made].findLast(Boolean)",
      "[made].at(0)",
      "[made].pop()",
      "[made].shift()",
      "[[made]].flat()[0]",
      "[].concat([made])[0]",
      "[made].slice()[0]",
      "[...[made]][0]",
      "[made].splice(0, 1)[0]",
      "[made].values().next().value",
      "[made].entries().next().value[1]",
      "Array.of(made)[0]",
      "Array.from([made])[0]",
      `Array.from(${like})[0]`,
      `Array.prototype.at.call(${like}, 0)`,
      `Array.prototype.find.call(${like}, Boolean)`,
      `Array.prototype.slice.call(${like})[0]`,
      "Array.prototype.concat.call(made)[0]",
      "Object.values({ a: made })[0]",
      "Object.entries({ a: made })[0][1]",
      'Object.fromEntries([["a", made]]).a',
      "Object.assign({}, { a: made }).a",
      "({ ...{ a: made } }).a",
      "new Map([[1, made]]).get(1)",
      "[...new Map([[made, 1]]).keys()][0]",
      "[...new Set([made])][0]",
      "new WeakRef(made).deref()",
      "new WeakMap([[made, made]]).get(made)",
      "[made].reduce((a, b) => b, null)",
      "[made].sort()[0]",
      "[made].reverse()[0]",
      "[made].toSorted()[0]",
      "[made].toReversed()[0]",
      "[0].with(0, made)[0]",
      "new Array(1).fill(made)[0]",
      "[made].filter(Boolean)[0]",
      "[made].flatMap(x => [x])[0]",
      'Object.groupBy([made], () => "a").a[0]',
      "Map.groupBy([made], () => 1).get(1)[0]",
      "[made].values().map(x => x).toArray()[0]",
      "[made].values().find(Boolean)",
      `Iterator.from(${handsOn}).next().value`,
      `Iterator.from(${handsOn}).take(1).toArray()[0]`,
      'Reflect.get({ a: made }, "a")',
      `Reflect.get(Object.defineProperty({}, "g", { get: ${self} }), "g", made)`,
      'Object.getOwnPropertyDescriptor({ a: made }, "a").value',
      "Object.getOwnPropertyDescriptors({ a: made }).a.value",
      "new Proxy({ a: made }, {}).a",
      "new Proxy(made, {})",
      "new Proxy(made, Reflect)",
      "new (class { constructor() { return made; } })()",
      "new (function () { return made; })()",
      "(function* () { yield made; })().next().value",
      "((...all) => all[0]).apply(null, [made])",
      "(function () { return arguments[0]; })(made)",
      "(x => x).bind(null, made)()",
      "((texts, x) => x)`${made}`",
      "(({ a }) => a)({ a: made })",
      "(([a]) => a)([made])",
      "({ get me() { return made; } }).me",
      'JSON.parse("[0]", (key, value) => (key === "0" ? made : value))[0]',
      "Object.getPrototypeOf(Object.create(made))",
      "Reflect.getPrototypeOf(Object.create(made))",
      "Object.create(made).__proto__",
      "({ __proto__: made }).__proto__",
      'new Error("x", { cause: made }).cause',
      "new AggregateError([made]).errors[0]",
      "(() => { try { throw made; } catch (caught) { return caught; } })()",
      "new DisposableStack().adopt(made, () => {})",
      "(class extends Array { static get [Symbol.species]() { return function () { return made; }; } }).from([]).map(x => x)",
    ].map((expression): [string, string[], string] => ["", [], expression]);
    const bySymbol = (
      [
        ["Symbol.search", '"a-b".search(made)'],
        ["Symbol.match", '"a-b".match(made)'],
        ["Symbol.matchAll", '"a-b".matchAll(made)'],
        ["Symbol.replace", '"a-b".replace(made, "x")'],
        ["Symbol.replace", '"a-b".replaceAll(made, "x")'],
        ["Symbol.split", '"a-b".split(made)'],
      ] as const
    ).flatMap(([symbol, call]): [string, string[], string][] => [
      [`[${symbol}]: ${self}`, [], call],
      [`[${symbol}]: function () { return this; }`, [], call],
      [`[${symbol}]() { return this; }`, [], call],
    ]);
    const throughTheProgram: [string, string[], string][] = [
      [`get: ${self}`, ["const proxy = new Proxy({}, made);"], "proxy.anything"],
      ["", [`Object.defineProperty(made, "self", { get: ${self}, configurable: true });`], "made.self"],
      ["", [`made.__defineGetter__("self", ${self});`], "made.self"],
      ["", [`Object.setPrototypeOf(made, Object.defineProperty({}, "self", { get: ${self} }));`], "made.self"],
      [`toISOString: ${self}, [Symbol.toPrimitive]: () => 1`, [], "Date.prototype.toJSON.call(made)"],
      ["toISOString() { return this; }, [Symbol.toPrimitive]: () => 1", [], "Date.prototype.toJSON.call(made)"],
      [`exec: ${self}, flags: ""`, [], 'RegExp.prototype[Symbol.match].call(made, "a")'],
      [`join: ${self}`, [], "Array.prototype.toString.call(made)"],
      ["join() { return this; }", [], "Array.prototype.toString.call(made)"],
      [`toString: ${self}`, [], "Object.prototype.toLocaleString.call(made)"],
      [`toString: ${self}`, [], "made.toLocaleString()"],
      ["[Symbol.dispose]() {}", [], "new DisposableStack().use(made)"],
      [
        `[Symbol.iterator]: ${self}, next() { return { done: true, value: undefined }; }`,
        [],
        "made[Symbol.iterator]()",
      ],
      [`same: ${self}`, [], "made.same()"],
      [`same: ${self}`, [], "made.same?.()"],
      [`same: ${self}`, ['const name = "same";'], "made[name]()"],
      [`same: ${self}`, ["const bound = made.same.bind(made);"], "bound()"],
      ["same: Object", [], "made.same(made)"],
      ["get me() { return this; }", [], "made.me"],
      ["me() { return this; }", [], "made.me()"],
      ['toString() { seen = this; return "x"; }', ["`${made}`;"], "seen"],
      ["valueOf() { seen = this; return 1; }", ["+made;"], "seen"],
      ["[Symbol.toPrimitive]() { seen = this; return 1; }", ["+made;"], "seen"],
      ["toJSON() { seen = this; return 1; }", ["JSON.stringify(made);"], "seen"],
      ["[Symbol.search]() { seen = this; return 0; }", ['"a".search(made);'], "seen"],
      ["[Symbol.iterator]() { seen = this; return [][Symbol.iterator](); }", ["[...made];"], "seen"],
      [
        "",
        ["const judge = { [Symbol.hasInstance](value) { seen = value; return true; } };", "made instanceof judge;"],
        "seen",
      ],
      ["", ["[made, {}].sort((a, b) => { seen = a === made ? a : b; return 0; });"], "seen"],
      ["", ["new Proxy(made, { get(target) { seen = target; return 1; } }).x;"], "seen"],
      [
        "",
        [
          "Object.setPrototypeOf(made, new Proxy({}, { get(target, key, receiver) { seen = receiver; return undefined; } }));",
          "made.nobody;",
        ],
        "seen",
      ],
      ["", ["Object.setPrototypeOf(made, { set taken(value) { seen = this; } });", "made.taken = 1;"], "seen"],
      [
        "",
        ['JSON.stringify(made, function (key, value) { if (key === "count") seen = this; return value; });'],
        "seen",
      ],
      ["", ["[0].forEach(function () { seen = this; }, made);"], "seen"],
      ["", ['"a".replace("a", () => { seen = made; return ""; });'], "seen"],
    ];
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += (typeof value === "function" ? "a function" : typeof value === "object" && value !== null ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)) + ";"; }`,
    );
    for (let index = this.pick([1, 2, 2, 3, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [more, front, expression] = this.pick(
        this.pick([plain, plain, bySymbol, throughTheProgram, throughTheProgram]),
      );
      const [value, same, other] = this.pick([
        ["1", "5", '"a text"'],
        ["1", "5", '"a text"'],
        ["1", "5", "0.5"],
        ["0.5", "2.5", "null"],
        ['"text"', '"more"', "7"],
        ["{ deep: 1 }", "{ deep: 2 }", "3"],
        ["[1]", "[2, 3]", '"none"'],
        ["true", "false", "0"],
        ["() => 1", "() => 2", "4"],
      ]);
      const tries = (statement: string) => `try { ${statement} } catch (error) { note("refused"); }`;
      const write = this.pick<string[]>([
        ["again.added = 1;"],
        ["again.added = 1;"],
        [`again.count = ${other};`],
        [`again.count = ${other};`],
        [`again.count = ${other};`],
        [`again.count = ${same};`],
        ["delete again.count;"],
        ["delete again.count;"],
        ["delete again.count;", `again.count = ${same};`],
        ['Object.defineProperty(again, "count", { get() { return 7; }, enumerable: true, configurable: true });'],
        ['Object.defineProperty(again, "count", { get() { return 7; }, enumerable: true, configurable: true });'],
        [
          `Object.defineProperty(again, "count", { value: ${other}, enumerable: false, writable: true, configurable: true });`,
        ],
        [
          `Object.defineProperty(again, "count", { value: ${same}, writable: false });`,
          tries(`made.count = ${other};`),
        ],
        ["Object.freeze(again);", tries(`made.count = ${same};`)],
        ["Object.freeze(again);", tries(`made.count = ${same};`)],
        ["Object.seal(again);", tries("made.added = 1;"), tries("delete made.count;")],
        ["Object.preventExtensions(again);", tries("made.added = 1;")],
        ["Object.setPrototypeOf(again, { inherited: 1 });"],
        ["Object.setPrototypeOf(again, { inherited: 1 });"],
        [`Object.assign(again, { count: ${other}, added: 2 });`],
        [`Reflect.set(again, "count", ${other});`],
        ['Reflect.deleteProperty(again, "count");'],
        [`again["count"] = ${other};`],
        ['const key = "count";', `again[key] = ${other};`],
        ["again.count++;"],
        [`[again.count] = [${other}];`],
        [`for (const each in again) again[each] = ${other};`],
      ]);
      const asked = () =>
        this.pick([
          "note(made.count);",
          "note(made.count);",
          "note(typeof made.count);",
          "note(Object.keys(made).join());",
          'note("count" in made);',
          "note(made.label);",
        ]);
      const literal = `{ count: ${value}${more ? `, ${more}` : ""}, label: "two" }`;
      const isMadeElsewhere = this.chance(25);
      const uses = (name: string) => [more, expression, ...front].some(text => new RegExp(`\\b${name}\\b`).test(text));
      if (isMadeElsewhere && !uses("seen")) this.emit(1, `function make${id}()${any} { return ${literal}; }`);
      // A second site of the built-in, where the callee hands back something else, makes the compiler merge both answers.
      if (this.chance(50)) {
        const answer = this.pick(['"x"', '"x"', "1", "{ other: 1 }"]);
        const member = more.replace(
          /^(\[[\w.]+\]|\w+)(: Object\.prototype\.valueOf|: function \(\) \{ return this; \}|\(\) \{ return this; \})/,
          `$1() { return ${answer}; }`,
        );
        const fields = this.pick([`z: "x"`, `count: ${value}`, `count: ${other}`]);
        this.emit(1, `function other${id}()${any} {`);
        this.emit(
          2,
          ...(uses("seen") ? [`let seen${any};`] : []),
          `const made${any} = { ${fields}${member ? `, ${member}` : ""} };`,
          ...front,
          `return ${expression};`,
        );
        this.emit(1, "}");
        this.emit(
          1,
          this.pick([
            `if (process.argv.length > 5) note(typeof other${id}());`,
            `if (process.argv.length > 5) note(typeof other${id}());`,
            `try { note(typeof other${id}()); } catch (error) { note("refused"); }`,
          ]),
        );
      }
      this.emit(1, `function second${id}()${this.typed("void")} {`);
      this.emit(
        2,
        ...(uses("seen") ? [`let seen${any};`] : []),
        `const made${this.isTypeScript ? this.pick([": any", ": any", ""]) : ""} = ${isMadeElsewhere && !uses("seen") ? `make${id}()` : literal};`,
        ...this.several(0, 1, asked),
        ...front,
        `const again${this.isTypeScript ? this.pick([": any", ""]) : ""} = ${expression};`,
        ...this.several(0, 1, asked),
        ...write,
        "note(again === made);",
        "note(Object.keys(made).join());",
        "note(made.count);",
        "note(typeof made.count);",
        "note(made.label);",
        "note(made.inherited);",
        "note(made.added);",
        "note(Object.isFrozen(made));",
        "note(Object.isExtensible(made));",
      );
      this.emit(1, "}");
      this.emit(
        1,
        `${this.pick(["", "", "for (let turn = 0; turn < 2; turn++) ", "for (let turn = 0; turn < 5; turn++) "])}try { second${id}(); } catch (error) { note("threw " + (error${this.isTypeScript ? " as any" : ""})?.constructor?.name); }`,
      );
    }
    this.emit(1, `printValue("literals under a second name ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * A built-in object reaches a write under a key out of a list, after a value the compiler cannot follow: through getters, the global object, a list, a callback, an instance's prototype. The
   * member is then called at a site of its own kind, before and after the write, also in a loop. A compiled program may refuse the write, so it prints whether the write and the member agree:
   * refused and unchanged, or accepted and changed.
   */
  sceneOfBuiltInsWrittenUnderAHiddenKey() {
    const number = ++this.count;
    const any = this.typed("any");
    const objects: [string, string, [string, string[]][]][] = [
      [
        "Date.prototype",
        "new Date(0)",
        [
          ["toString", ["new Date(0).toString()", "String(new Date(0))", "`${new Date(0)}`", 'new Date(0) + ""']],
          ["toJSON", ["new Date(0).toJSON()", "JSON.stringify(new Date(0))", "JSON.stringify({ d: new Date(0) })"]],
          ["valueOf", ["new Date(0).valueOf()", "+new Date(0)", "new Date(0) - 0"]],
          ["getTime", ["new Date(0).getTime()", "new Date(0).getTime() + 1"]],
          ["toISOString", ["new Date(0).toISOString()", "new Date(0).toJSON()"]],
        ],
      ],
      [
        "Function.prototype",
        "function () {}",
        [
          [
            "toString",
            [
              "(function f() {}).toString()",
              "String(function f() {})",
              "(() => 1).toString()",
              "(class C {}).toString()",
            ],
          ],
          ["call", ["(function () { return 1; }).call(null)"]],
          ["apply", ["(function () { return 1; }).apply(null, [])"]],
          ["bind", ["(function () { return 1; }).bind(null)"]],
        ],
      ],
      [
        "Error.prototype",
        'new Error("x")',
        [["toString", ['new Error("x").toString()', 'String(new Error("x"))', 'new TypeError("x").toString()']]],
      ],
    ];
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { out += String(value) + ";"; }`,
      `const hide${number} = (value${any})${any} => new CustomEvent("x", { detail: value }).detail;`,
    );
    for (let index = this.pick([1, 1, 2]); index > 0; index--) {
      const id = `${number}_${index}`;
      const [object, instance, members] = this.pick(objects);
      const [member, sites] = this.pick(members);
      const site = this.pick(sites);
      // A new Function.prototype.call changes what the sites of other units do, under plain Bun too.
      if (object === "Function.prototype" && member !== "toString") index = 0;
      const write = this.pick([
        "object[key] = value; return true;",
        "object[key] = value; return true;",
        "Object.defineProperty(object, key, { value, writable: true, configurable: true }); return true;",
        "return Reflect.set(object, key, value);",
        "Object.assign(object, { [key]: value }); return true;",
        "Object.defineProperty(object, key, { get() { return value; }, configurable: true }); return true;",
      ]);
      const arrival = this.pick<string[]>([
        [
          `const first${id} = { get: () => ${object} };`,
          `const second${id} = { get: () => first${id}.get() };`,
          `const arrive${id} = () => second${id}.get();`,
        ],
        [
          `(globalThis${this.isTypeScript ? " as any" : ""}).kept${id} = ${object};`,
          `const arrive${id} = () => (globalThis${this.isTypeScript ? " as any" : ""}).kept${id};`,
        ],
        [`const held${id} = hide${number}(${object});`, `const arrive${id} = () => held${id};`],
        [`const list${id}${any} = [{ a: 1 }, ${object}];`, `const arrive${id} = () => list${id}[hide${number}(1)];`],
        [
          `let seen${id}${any};`,
          `[${object}].forEach(each => { seen${id} = each; });`,
          `const arrive${id} = () => seen${id};`,
        ],
        [`const arrive${id} = () => Object.getPrototypeOf(${instance});`],
      ]);
      const key = this.pick([`hide${number}("${member}")`, `hide${number}("${member}")`, `"${member}"`]);
      const asAny = this.isTypeScript ? " as any" : "";
      this.emit(1, `function write${id}(object${any}, key${any}, value${any})${any} { ${write} }`);
      if (this.chance(70)) this.emit(1, `write${id}(hide${number}({ a: 1 }), hide${number}("a"), 1);`);
      // What a plain run stores would change the answers of the other scenes of the program.
      this.emit(1, `const original${id} = Object.getOwnPropertyDescriptor(${object}, "${member}");`);
      this.emit(
        1,
        ...arrival,
        `const turn${id} = ()${any} => { try { return String((${site})${asAny}); } catch (error) { return (error${asAny}).name; } };`,
        `const change${id} = ()${any} => { try { return write${id}(arrive${id}(), ${key}, function () { return "mine ${id}"; }); } catch (error) { return false; } };`,
        ...this.pick<string[]>([
          [`const before${id} = turn${id}();`, `const accepted${id} = change${id}();`],
          [
            `let before${id}${any};`,
            `for (let turn = 0; turn < 40; turn++) before${id} = turn${id}();`,
            `const accepted${id} = change${id}();`,
          ],
          [
            `const before${id} = turn${id}();`,
            `let accepted${id}${any};`,
            `[1].forEach(() => { accepted${id} = change${id}(); });`,
          ],
        ]),
        `const verdict${id} = accepted${id} === (turn${id}() !== before${id}) ? "agrees" : "accepted " + accepted${id};`,
        `Reflect.defineProperty(hide${number}(${object}), hide${number}("${member}"), original${id}${asAny});`,
        `note(verdict${id});`,
      );
    }
    this.emit(1, `printValue("built-ins under a hidden key ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * The members of Date.prototype, Function.prototype and Error.prototype that a compiled program can replace reach a writer through a chain of getters, long after a value the compiler cannot
   * follow. Each store prints what it returned or threw and what the member is then, so a refusal where plain Bun stores is a difference. It depends on what else the executable holds.
   */
  sceneOfReplaceableMembersWrittenThroughAChain() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    const [object, members] = this.pick<[string, string[]]>([
      ["Date.prototype", ["toString", "toLocaleString", "toLocaleDateString", "toLocaleTimeString"]],
      ["Date.prototype", ["toString", "toLocaleString", "toLocaleDateString", "toLocaleTimeString"]],
      ["Function.prototype", ["toString"]],
      ["Error.prototype", ["toString"]],
    ]);
    const ways: [string, string][] = [
      ["store", "object[key] = value;"],
      ["define", "Object.defineProperty(object, key, { value, writable: true, configurable: true });"],
      ["set", "return Reflect.set(object, key, value);"],
      ["assign", "Object.assign(object, { [key]: value });"],
      ["remove", "delete object[key];"],
    ];
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `const hide${number} = (value${any})${any} => new CustomEvent("x", { detail: value }).detail;`,
      `const ways${number}${any} = {`,
      ...ways.map(([name, body]) => `  ${name}(object${any}, key${any}, value${any})${any} { ${body} },`),
      `};`,
      `for (const way in ways${number}) ways${number}[way](hide${number}({ a: 1 }), hide${number}("a"), 1);`,
    );
    const links = this.pick([2, 5, 10]);
    this.emit(1, `const link${number}_0 = { get: () => ${object} };`);
    for (let link = 1; link < links; link++)
      this.emit(1, `const link${number}_${link} = { get: () => link${number}_${link - 1}.get() };`);
    for (let index = this.pick([1, 2, 3]); index > 0; index--) {
      const [way] = this.pick(ways);
      const member = this.pick(members);
      this.emit(
        1,
        `const original${number}_${index} = Object.getOwnPropertyDescriptor(${object}, "${member}");`,
        `try { out += "${way} ${member} " + String(ways${number}.${way}(link${number}_${links - 1}.get(), "${member}", function () { return "${way}"; })) + " " + typeof (${object}${asAny}).${member} + ";"; } catch (error) { out += "${way} ${member} " + (error${asAny}).name + ";"; }`,
        `try { ways${number}.define(link${number}_${links - 1}.get(), "${member}", original${number}_${index}${this.isTypeScript ? "!" : ""}.value); } catch (error) {}`,
      );
    }
    this.emit(1, `printValue("replaceable members ${number}", out);`);
    this.lines.push("}");
  }

  /**
   * Two classes of one shape, whose typed methods read and store `this.y`. An instance goes through a value the compiler cannot follow (a JSON.parse reviver), and on a rare path, in a catch, the
   * variable comes to hold another object: one that inherits from the instance with its own field of another type, a getter, no such field, a swapped prototype, a proxy or a frozen copy.
   */
  sceneOfObjectsBelowAnInstanceOnARarePath() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    const num = this.typed("number");
    const [one, two, flat] = [`Point${number}`, `Other${number}`, `Flat${number}`];
    const asFlat = this.isTypeScript ? ` as ${flat}` : "";
    const fields = this.isTypeScript
      ? ["x: number;", "y: number;", "link: unknown = null;"]
      : ["x;", "y;", "link = null;"];
    const methods = [
      `times()${num} { return this.y * 2; }`,
      `fixed()${this.typed("string")} { return this.y.toFixed(1); }`,
      `shown()${this.typed("string")} { return typeof this.y + String(this.y); }`,
      `added()${num} { return this.y + 1; }`,
      `linked()${this.typed("unknown")} { return this.link; }`,
      `compared()${this.typed("boolean")} { return this.y === 0; }`,
      `bump()${num} { this.y += 1; return this.y; }`,
      `inLoop()${num} { let sum = 0; for (let i = 0; i < 3; i++) sum += this.y; return sum; }`,
      `storeY()${this.typed("string")} { this.y = 9; return Object.keys(this).join("+") + this.y; }`,
    ];
    const names = ["times", "fixed", "shown", "added", "linked", "compared", "bump", "inLoop", "storeY"];
    const makeClass = (name: string, more: string[]) => [
      `class ${name} {`,
      ...fields.map(line => `  ${line}`),
      ...more,
      `  constructor(x${num}, y${num}) { this.x = x; this.y = y; }`,
      ...methods.map(line => `  ${line}`),
      `  sum(other${this.typed(name === one ? one : flat)})${num} { return this.x * ${name === one ? 100 : 1000} + other.x; }`,
      `}`,
    ];
    const below = `Object.create(value)${asFlat}`;
    const onValue = `(value${asAny})`;
    const kinds: string[][] = [
      [`value = ${below};`, `${onValue}.y = "text";`],
      [`value = ${below};`, `${onValue}.y = { valueOf() { return 4; }, toFixed() { return "object"; } };`],
      [`value = ${below};`, `${onValue}.y = null;`],
      [`value = ${below};`, `${onValue}.y = 2 ** 53;`],
      [
        `value = ${below};`,
        `Object.defineProperty(value, "y", { get() { return "got"; }, set(v${any}) {}, configurable: true });`,
      ],
      [
        `const middle = Object.create(value);`,
        `Object.defineProperty(middle, "y", { get() { return 7.5; }, configurable: true });`,
        `value = Object.create(middle)${asFlat};`,
      ],
      [
        `const holder${any} = Object.create(null);`,
        `for (const name of ${JSON.stringify([...names, "sum"])}) holder[name] = ${onValue}[name];`,
        `value = holder${asFlat};`,
      ],
      [`value = Object.setPrototypeOf({ x: 1, y: "text", link: 5 }, Object.getPrototypeOf(value))${asFlat};`],
      [
        `value = new Proxy(value, { get: (target${any}, key${any}) => (key === "y" ? "trapped" : Reflect.get(target, key)) })${asFlat};`,
      ],
      [`value = Object.freeze(${below})${asFlat};`],
      [`value = ${below};`],
    ];
    const kind = this.pick(kinds);
    const rare = this.pick([1, 3, 5]);
    const called = this.several(2, 5, () => this.pick(names));
    const failed = `throw new Error("no");`;
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      ...(this.isTypeScript ? [`type ${flat} = ${one} | ${two};`] : []),
      ...makeClass(one, []),
      ...makeClass(two, [`  tag = "other";`]),
      `const given${number}${this.typed("number[]")} = JSON.parse("[0.5, 1, 2, 3]");`,
      `function revived${number}(value${this.typed(flat)})${this.typed(flat)} { return JSON.parse("[0]", (key${any}, each${any}) => (key === "0" ? value : each))[0]; }`,
      `function fail${number}(when${this.typed("boolean")})${this.typed("void")} { if (when) ${failed} }`,
      `function other${number}(round${num})${this.typed("string")} {`,
      `  let value${this.typed(flat)} = revived${number}(new ${one}(round * 2, given${number}[2]));`,
      `  const put = (each${this.typed(flat)}) => void (value = each);`,
      `  const first = value;`,
      `  try { fail${number}(given${number}[0] > round); } catch (error) { put(new ${two}(value.x + 1, value.y)); }`,
      `  value.link = first;`,
      `  return String(value.link === value) + String(first.x);`,
      `}`,
      `function run${number}(round${num})${this.typed("void")} {`,
      `  let value${this.typed(flat)} = revived${number}(new ${this.pick([one, one, two])}(given${number}[0], ${this.pick(["0", "given" + number + "[2]"])}));`,
      `  const first = value;`,
      `  try { fail${number}(round === ${rare}); out += first.x; } catch (error) {`,
      ...kind.map(line => `    ${line}`),
      `  }`,
      ...called.map(
        name =>
          `  try { out += " " + String(value.${name}()); } catch (error) { out += " threw " + (error${asAny}).constructor.name; }`,
      ),
      `  try { out += " " + String(${one}.prototype.${this.pick(names)}.call(value${this.isTypeScript ? " as " + one : ""})); } catch (error) { out += " threw " + (error${asAny}).constructor.name; }`,
      `  try { out += " " + value.sum(first${this.isTypeScript ? " as " + one : ""}) + "," + first.sum(value${this.isTypeScript ? " as " + one : ""}); } catch (error) { out += " threw " + (error${asAny}).constructor.name; }`,
      `  out += "|";`,
      `}`,
      `for (let round = 0; round < 12; round++) out += other${number}(round);`,
      `for (let round = 0; round < 12; round++) run${number}(round);`,
      `printValue("below an instance ${number}", out);`,
    );
    this.lines.push("}");
  }

  /**
   * A function answers with one of two shapes, and only one of them holds another new object, with a field that is the result of a built-in method. Closures that wait in a queue call it, and
   * one of them makes answers of the same shapes through a list of makers. It says most where the compiler does not see every caller (run-batch.ts --hands-a-callback-to-native-code): there the
   * result of the built-in method can be anything.
   */
  sceneOfResultsOfBuiltInsHeldUnderOneShape() {
    const number = ++this.count;
    const typed = (text: string) => (this.isTypeScript ? text : "");
    const sure = typed("!");
    const answer = `Answer${number}`;
    const [source, type, calls] = this.pick<[string, string, string[]]>([
      [
        "Buffer.alloc(15, 1)",
        "Buffer",
        [
          "source.readUInt32BE(0)",
          "source.readUInt8(1)",
          "source.indexOf(1)",
          "source.lastIndexOf(1)",
          "source.length",
        ],
      ],
      [
        "[15, 2, 3]",
        "number[]",
        [`source.at(0)${sure}`, "source.indexOf(2)", "source.length", "source.findIndex(each => each === 2)"],
      ],
      ["new Map([[1, 15]])", "Map<number, number>", [`source.get(1)${sure}`, "source.size"]],
      ["new Set([15])", "Set<number>", ["source.size"]],
      [
        '"fifteen letters"',
        "string",
        ["source.length", 'source.indexOf("t")', "source.charCodeAt(0)", `source.codePointAt(0)${sure}`],
      ],
      [
        "new Uint8Array(15).fill(1)",
        "Uint8Array",
        ["source.length", "source.byteLength", "source.indexOf(1)", `source.at(0)${sure}`],
      ],
      ["new Date(15)", "Date", ["source.getTime()", "source.valueOf()", "source.getMilliseconds()"]],
    ]);
    const call = this.pick(calls);
    const holds = this.pick([
      "{ step, count }",
      "{ step, count }",
      "{ count, step }",
      "{ count }",
      "{ step, count, size }",
    ]);
    const held = holds.includes("size")
      ? "{ step: number; count: number; size: number }"
      : holds.includes("step")
        ? "{ step: number; count: number }"
        : "{ count: number }";
    const test = this.pick([
      "(size - count * step) % 8 === 0",
      "(size - count * step) % 8 === 0",
      "size < 0",
      "count > size",
      "size > 0",
    ]);
    const asked = this.pick([
      'answer.tag === "some"',
      'answer.tag === "some"',
      'answer.tag === "some" && answer.value.count > 0',
      'answer.tag === "some" ? typeof answer.value.count + answer.value.count : answer.why',
    ]);
    // Inlining decides what the compiler sees together, so whether a step is a call and what the closures hand their answer to count as much as the answer.
    const isStepCalled = this.chance(75);
    const looks = this.pick([
      `if (ArrayBuffer.isView(value)) { seen${number} += String(value.buffer.byteLength) + ";"; }`,
      `if (ArrayBuffer.isView(value)) { seen${number} += String(value.buffer.byteLength) + ";"; }`,
      `if (ArrayBuffer.isView(value)) { seen${number} = String(value.buffer.byteLength); }`,
      `if (value instanceof Uint8Array) { seen${number} += String(value.length) + ";"; }`,
      `if (Array.isArray(value)) { seen${number} += String(value.length) + ";"; }`,
      `seen${number} += (typeof value === "object" && value !== null ? "object" : String(value)) + ";";`,
    ]);
    this.lines.push("{");
    this.emit(
      1,
      ...(this.isTypeScript
        ? [
            `type ${answer}<T> = { readonly tag: "some"; readonly value: T } | { readonly tag: "none"; readonly why: string };`,
          ]
        : []),
      ...(isStepCalled
        ? [`function stepOf${number}(wide${typed(": boolean")})${typed(": number")} { return wide ? 32 : 20; }`]
        : []),
      `function read${number}(source${typed(": " + type)}, size${typed(": number")}, wide${typed(": boolean")})${typed(`: ${answer}<${held}>`)} {`,
      `  const step = ${isStepCalled ? `stepOf${number}(wide)` : "wide ? 32 : 20"};`,
      `  const count = ${call};`,
      `  return ${test} ? { tag: "some", value: ${holds} } : { tag: "none", why: "odd" };`,
      `}`,
      `function ask${number}(source${typed(": " + type)}, wide${typed(": boolean")})${typed(": unknown")} {`,
      `  const answer = read${number}(source, 15, wide);`,
      `  return ${asked};`,
      `}`,
      `const queue${number}${typed(": Array<() => unknown>")} = [];`,
      `const later${number} = (f${typed(": () => unknown")})${typed(": void")} => { queue${number}.push(f); };`,
      `let seen${number} = "";`,
      `function look${number}(value${typed(": unknown")})${typed(": void")} { ${looks} }`,
      `function some${number}(value${typed(": string[]")})${typed(`: ${answer}<string[]>`)} { return { tag: "some", value }; }`,
      `function none${number}(why${typed(": string")})${typed(`: ${answer}<never>`)} { return { tag: "none", why }; }`,
      `const held${number} = ${source};`,
      ...this.several(1, 2, () =>
        this.pick([
          `later${number}(() => { look${number}(ask${number}(held${number}, false) ? held${number} : undefined); });`,
          `later${number}(() => { look${number}(ask${number}(held${number}, ${this.pick(["true", "false"])})); });`,
        ]),
      ),
      `later${number}(() => {`,
      `  const makers${typed(`: ReadonlyArray<() => ${answer}<string[]>>`)} = [() => some${number}([]), () => none${number}("empty")];`,
      `  const taken${typed(": string[]")} = [];`,
      `  ${this.pick(["makers[taken.length]();", "makers[taken.length]();", `look${number}(makers[taken.length]().tag);`, `for (const make of makers) look${number}(make().tag);`])}`,
      `  look${number}(taken);`,
      `});`,
      this.pick([
        `for (const f of queue${number}) f();`,
        `for (const f of queue${number}) f();`,
        `queue${number}.forEach(f => f());`,
        `while (queue${number}.length) queue${number}.shift()${sure}();`,
      ]),
      this.pick([
        `printValue("held under one shape ${number}", seen${number});`,
        `printValue("held under one shape ${number}", seen${number}, String(ask${number}(held${number}, true)));`,
      ]),
    );
    this.lines.push("}");
  }

  /**
   * Functions take what they were called with as the arguments object, as a rest list or as a copy of either. Something else comes to hold it: a closure kept on the global object, in a
   * variable, a list or a Map of the module, a literal, a list, a callee. The function walks it, has the holder change it (an element, the length, a deleted element, its iterator, a push,
   * a sort), and walks it again. Several such functions stand side by side and are called with none to four arguments, through apply and through a spread.
   */
  sceneOfArgumentsChangedBetweenTwoWalks() {
    const number = ++this.count;
    const any = this.typed("any");
    const asAny = this.isTypeScript ? " as any" : "";
    this.lines.push("{");
    this.emit(
      1,
      `let out = "";`,
      `function note(value${any})${this.typed("void")} { let text; try { text = JSON.stringify(value) ?? String(value); } catch (error) { text = "threw"; } out += text + ";"; }`,
      `const world${any} = globalThis;`,
      `let kept${number}${any} = null;`,
      `const shelf${number}${this.typed("any[]")} = [];`,
      `const table${number} = new Map${this.isTypeScript ? "<any, any>" : ""}();`,
      `function keeps${number}(value${any})${this.typed("void")} { kept${number} = value; }`,
    );
    const names: string[] = [];
    for (let index = this.pick([2, 2, 3, 4]); index > 0; index--) {
      const name = `taker${number}_${index}`;
      names.push(name);
      const source = this.pick(["arguments", "arguments", "arguments", "rest", "rest"]);
      const taken = this.pick([source, source, source, `[...${source}]`, `Array.from(${source})`]);
      const change = this.pick([
        `held[0] = "handed";`,
        `held[0] = "handed";`,
        `held[1] = 1.5;`,
        `held[held.length] = "more";`,
        `held.length = 1;`,
        `held.length = 0;`,
        `held.length = 6;`,
        `delete held[0];`,
        `held[Symbol.iterator] = function* () { yield "other"; };`,
        `held[Symbol.iterator] = [7, 8][Symbol.iterator].bind([7, 8]);`,
        `Array.prototype.push.call(held, "pushed");`,
        `Array.prototype.reverse.call(held);`,
        `Array.prototype.sort.call(held);`,
        `Array.prototype.fill.call(held, 0);`,
        `Object.defineProperty(held, 0, { get() { return "got"; }, configurable: true });`,
        `Object.freeze(held);`,
        `held[5000] = "far";`,
      ]);
      const [keep, call] = this.pick<[string, string]>([
        [`world.g${number} = () => { ${change} };`, `world.g${number}();`],
        [`world.g${number} = () => { ${change} };`, `world.g${number}();`],
        [`world.g${number} = () => { ${change} };`, `world.g${number}();`],
        [`kept${number} = () => { ${change} };`, `kept${number}();`],
        [`shelf${number}.push(() => { ${change} });`, `shelf${number}.at(-1)();`],
        [`table${number}.set("k", () => { ${change} });`, `table${number}.get("k")();`],
        [`world.h${number} = { held };`, `{ const { held } = world.h${number}; ${change} }`],
        [`kept${number} = { held };`, `{ const { held } = kept${number}; ${change} }`],
        [`shelf${number}.push([held]);`, `{ const [held] = shelf${number}.at(-1); ${change} }`],
        [`keeps${number}(held);`, `{ const held = kept${number}; ${change} }`],
        [`const later = () => { ${change} };`, "later();"],
        [`const later = () => { ${change} };`, "[1].forEach(later);"],
      ]);
      const walk = () =>
        this.pick([
          "[0, ...held]",
          "[0, ...held]",
          "[...held]",
          "[...held]",
          "Math.max(0, ...held)",
          "((...all) => all.length)(...held)",
          "(() => { const seen = []; for (const each of held) seen.push(each); return seen; })()",
          "(([first, second]) => [first, second])(held)",
          "(([first, ...others]) => others)(held)",
          "Array.from(held)",
          "[held[0], held[1], held.length]",
          "[held[0], held[1], held.length]",
          "(function () { return arguments.length; }).apply(null, held)",
          "[...(function* () { yield* held; })()]",
          "Array.prototype.slice.call(held)",
          "Array.prototype.join.call(held)",
          "Object.keys(held)",
          "new Set(held).size",
        ]);
      const [first, second] = this.chance(60) ? [walk(), ""] : [walk(), walk()];
      this.emit(
        1,
        `function ${name}(${source === "rest" ? `...rest${this.typed("any[]")}` : this.isTypeScript ? "...unused: any[]" : ""})${any} { const held${any} = ${taken}; ${keep} let before${any}, behind${any}; try { before = ${first}; } catch (error) { before = "threw"; } try { ${call} } catch (error) {} try { behind = ${second || first}; } catch (error) { behind = "threw"; } return [before, behind]; }`,
      );
    }
    this.emit(
      1,
      `for (const taker of [${names.join(", ")}]) { note(taker("x", "y", 3)); note(taker("x")); note(taker()); note(taker.apply(null, ["x", undefined])); note(taker(...[1, 2, 3, 4])); }`,
      ...names
        .filter(() => this.chance(40))
        .map(name => `note(${name}(${this.pick([`"x", "y"`, "1, 2, 3", "1.5", `{ k: 1 }, [2]`])}));`),
      `delete (world${asAny}).g${number}; delete (world${asAny}).h${number};`,
      `printValue("arguments changed between two walks ${number}", out);`,
    );
    this.lines.push("}");
  }

  /**
   * Loops whose counters are stepped inside the test: `++turn < n && spent++ < m`, `while (left--)`, `for (; left-- > 0; )`. One to three counters, joined by `&&`, `||`, `&` or a comma. Most
   * start where such loops start (-1 in front of `++turn < n`, 0 in front of `turn++ < n`, the count in front of `left--`); some start further below zero, at a fraction or at an edge of
   * int32, and some bounds are fractions or NaN. Starts and bounds are written out or come as parameters, members and lengths. A body reads a list at a counter, steps a counter once more,
   * leaves early, catches what a call throws, pauses, or keeps a closure over a counter; a few loops run for more than 2 ** 20 turns. Every counter steps toward its bound, so every loop ends. The functions are
   * expressions: split-into-files.ts calls declarations with arguments of its own, and with those a loop need not end.
   */
  sceneOfCountersSteppedInsideTheirTests() {
    const number = ++this.count;
    this.lines.push("{");
    this.emit(
      1,
      `const show = (value${this.typed("unknown")}) => (Object.is(value, -0) ? "-0" : String(value));`,
      `const list = [1, 2, 3, 4];`,
      `let seen = "";`,
    );
    for (let index = this.pick([1, 1, 2]); index > 0; index--) {
      const id = `${number}_${index}`;
      const kind = this.pick([
        "function",
        "function",
        "generator",
        "generator",
        "async",
        "arrow",
        "method",
        "block",
        "block",
      ]);
      const isLong = kind !== "async" && this.chance(5);
      const given: string[][] = this.several(1, 4, () => []);
      const names = ["turn", "spent", "left"].slice(0, this.pick([1, 2, 2, 2, 2, 3, 3]));
      const joined = names.length === 1 ? "&&" : this.plainly(75, "&&", () => this.pick(["||", "&", ","]));
      const parameters: string[] = [];
      const outside: string[] = [];
      const turns = () => (isLong ? 1048576 + this.pick([-1, 0, 1, 2]) : this.pick([0, 1, 2, 3, 3, 4, 6, 8]));
      const counters = names.map((name, at) => {
        const isUp = this.chance(80);
        const toward = isUp ? 1 : -1;
        // Behind zero a counter is true again, so under `||` such a loop need not end.
        const isTruthy = !isUp && joined !== "||" && this.chance(40);
        const step = isTruthy
          ? this.pick(["pre", "post"])
          : this.pick(["pre", "pre", "pre", "pre", "post", "post", "post", "post", "by"]);
        const sign = isUp ? "+" : "-";
        const stepped =
          step === "pre" ? `${sign}${sign}${name}` : step === "post" ? `${name}${sign}${sign}` : `(${name} ${sign}= 2)`;
        const past = (isPlain: boolean) => (isPlain ? 0 : this.pick([0, 0, 0.5, 0.5, -0.5, 0.25]));
        const startUp = () => (step === "post" ? this.pick([0, 0, 0, 1, -1]) : this.pick([-1, -1, -1, -1, 0, -2, -3]));
        const startAndBound = (isPlain: boolean): [number, number] => {
          if (isTruthy) return [turns() + (step === "pre" ? 1 : 0), 0];
          if (isPlain && isUp) {
            const start = startUp();
            return [start, start + turns()];
          }
          if (isPlain) {
            const bound = this.pick([0, 0, 0, -1, 1]);
            return [bound + turns(), bound];
          }
          const start = toward * this.pick([-1, -2, 5, -0.5, 0.5, 2147483644, 2147483646, 4294967294, -2147483650]);
          return [start, start + toward * turns() + past(false)];
        };
        const startIs = this.pick(["literal", "literal", "parameter"]);
        const drawn = this.pick(["literal", "literal", "parameter", "parameter", "member", "length"]);
        const boundIs = isLong && drawn === "length" ? "literal" : drawn;
        const isLength = !isTruthy && boundIs === "length";
        const fixed = startAndBound(isLong || this.chance(80));
        if (isLength) {
          fixed[1] = this.below(7);
          fixed[0] = isUp ? startUp() : fixed[1] + turns();
        }
        for (const [call, list] of given.entries()) {
          const isPlain = isLong || call === 0 || this.chance(65);
          const [start, bound] = startAndBound(isPlain);
          const isBoundGiven = !isTruthy && boundIs === "parameter";
          if (startIs === "parameter")
            list.push(String(isTruthy || isBoundGiven ? start : Math.floor(fixed[1]) - toward * turns()));
          if (isBoundGiven)
            list.push(
              !isPlain && this.chance(8)
                ? "NaN"
                : String(startIs === "parameter" ? bound : fixed[0] + toward * turns() + past(isPlain)),
            );
        }
        if (startIs === "parameter") parameters.push(`${name}From`);
        if (!isTruthy && boundIs === "parameter") parameters.push(`${name}To`);
        if (!isTruthy && boundIs === "member") outside.push(`const ${name}Limit${id} = { to: ${fixed[1]} };`);
        if (isLength) outside.push(`const ${name}Held${id} = [${Array(fixed[1]).fill(0).join(", ")}];`);
        const bound =
          boundIs === "parameter"
            ? `${name}To`
            : boundIs === "member"
              ? `${name}Limit${id}.to`
              : boundIs === "length"
                ? `${name}Held${id}.length`
                : String(fixed[1]);
        // The first counter ends the loop by itself; `!==` need not.
        const relation =
          at > 0 && joined === "&&" && this.chance(10)
            ? "!=="
            : isUp
              ? this.pick(["<", "<", "<", "<="])
              : this.pick([">", ">", ">="]);
        const mirrored = relation === "!==" ? relation : (relation[0] === "<" ? ">" : "<") + relation.slice(1);
        return {
          name,
          sign,
          isTruthy,
          stepped,
          start: startIs === "parameter" ? `${name}From` : String(fixed[0]),
          test: isTruthy
            ? stepped
            : this.chance(10)
              ? `${bound} ${mirrored} ${stepped}`
              : `${stepped} ${relation} ${bound}`,
        };
      });
      const tests = counters.map(counter => counter.test);
      if (this.chance(50)) tests.reverse();
      const test =
        joined === ","
          ? `(${[...counters.slice(1).map(counter => counter.stepped), counters[0].test].join(", ")})`
          : joined === "&"
            ? tests.map(each => `Number(${each})`).join(" & ")
            : tests.join(` ${joined} `);
      const first = this.pick(names);
      const second = this.pick(names);
      const pieces = this.several(0, this.pick([0, 1, 1, 2]), () =>
        this.pick([
          `sum += ${first} * 10 + ${second};`,
          `sum += list[${first}] ?? -1;`,
          `sum += list[${first} + 1] ?? -1;`,
          `sum += list[${second} & 3];`,
          `if (${second} === ${this.pick([1, 2, 3])}) continue;`,
          ...counters
            .filter(counter => !counter.isTruthy)
            .map(counter => `${counter.name}${counter.sign}${counter.sign};`),
          ...(isLong
            ? [`if ((${first} & 1023) === 1000) sum++;`]
            : [
                `told += show(${first}) + ",";`,
                `told += show(${first}) + ",";`,
                `told += show(${second}) + ",";`,
                `if (${second} === ${this.pick([1, 2, 3])}) break;`,
                `try { sum += ${first}; } catch {}`,
                `try { told += show(${first}) + ","; } catch {}`,
                `try { filled.push(${second}); } catch {}`,
                `try { list.missing(); } catch { sum += 100; }`,
                `try { if (${first} === 2) throw ${first}; sum++; } catch { sum += 100; }`,
                `takers.push(() => ${first});`,
                `filled.push(${second});`,
                `filled[${first} + 1] = ${second};`,
                `for (let inner = 0; inner++ < 2; ) sum += inner;`,
                ...(kind === "generator" ? [`yield ${first};`, `yield ${second};`] : []),
                ...(kind === "async" ? ["await null;", "await null;"] : []),
              ]),
        ]),
      );
      const body = pieces.join(" ");
      const loop = this.pick([
        `while (${test}) { ${body} }`,
        `while (${test}) { ${body} }`,
        `while (${test}) { ${body} }`,
        `while (${test}) { ${body} }`,
        `for (; ${test}; ) { ${body} }`,
        `for (; ${test}; ) { ${body} }`,
        `do { ${body} } while (${test});`,
        `for (let extra = 0; ${test}; extra++) { sum += extra; ${body} }`,
      ]);
      const typedParameters = parameters.map(parameter => parameter + this.typed("number")).join(", ");
      const isBlock = kind === "block";
      const [head, end] = isBlock
        ? parameters.length
          ? [
              `for (const [${parameters.join(", ")}] of [${given.map(each => `[${each.join(", ")}]`).join(", ")}]) {`,
              "}",
            ]
          : ["{", "}"]
        : kind === "method"
          ? [`const holder${id} = { run(${typedParameters}) {`, "} };"]
          : kind === "arrow"
            ? [`const run${id} = (${typedParameters}) => {`, "};"]
            : [
                `const run${id} = ${kind === "async" ? "async " : ""}function${kind === "generator" ? "*" : ""} (${typedParameters}) {`,
                "};",
              ];
      this.emit(1, ...outside, head);
      this.emit(
        2,
        `let told = "";`,
        `let sum = 0;`,
        `const takers${this.typed("(() => number)[]")} = [];`,
        `const filled${this.typed("number[]")} = [];`,
        ...counters.map(counter => `let ${counter.name} = ${counter.start};`),
        loop,
        `told += [${names.join(", ")}, sum, ...takers.map(take => take()), ...Object.entries(filled).flat()].map(show).join(" ");`,
        `printValue("counters stepped inside their tests ${id}", told);`,
      );
      this.emit(1, end);
      if (!isBlock)
        this.emit(
          1,
          ...given.map(each =>
            kind === "generator"
              ? `for (const each of run${id}(${each.join(", ")})) seen += show(each) + ";";`
              : `${kind === "method" ? `holder${id}.run` : `run${id}`}(${each.join(", ")});`,
          ),
        );
    }
    this.emit(1, `printValue("counters stepped inside their tests ${number}", seen);`);
    this.lines.push("}");
  }

  /**
   * An async function, async generator, async arrow function or async method holds one to seven values across sixteen to forty awaits and yields; a few hold some three hundred across two to
   * five. Past sixteen suspensions crossed, or 256 values across one, the compiler keeps a value in a word of a cell, not in the frame that every suspension saves. Values of every kind are
   * made at the start, late, on one branch only, or anew between two suspensions; they are read in between, in `catch` and `finally`, through a closure and at the end. Full and eden
   * collections run in between, and two or three calls run at once or one behind the other. No plain generators: they keep their values in a cell anyway. The functions and the class are
   * expressions, so that split-into-files.ts leaves them alone.
   */
  sceneOfValuesHeldAcrossManySuspensions() {
    const number = ++this.count;
    const any = this.typed("any");
    this.imports.push(
      `${this.isTypeScript ? "// @ts-ignore\n" : ""}import { edenGC as collectTheYoung${number} } from "bun:jsc";`,
    );
    const kind = this.pick(["function", "function", "function", "generator", "generator", "arrow", "method"]);
    const isWide = this.chance(6);
    const late = this.pick([0, 0, 2, 4, 6]);
    const last = late + (isWide ? this.pick([2, 3, 5]) : this.pick([16, 17, 17, 18, 18, 20, 24, 33, 40]));
    const around = this.pick(["", "", "", "try-catch", "try-finally", "loop", "if", "try-catch-finally"]);
    const from = this.below(Math.floor(last / 3) + 1);
    const least = Math.min(last, from + 2);
    const to = around ? least + this.below(last - least + 1) : last;
    const isInside = (at: number) => around !== "" && from <= at && at < to;
    const throwsAt = around.startsWith("try") && this.chance(70) ? from + this.below(to - from) : -1;
    const makers: ((salt: number) => string)[] = [
      salt => `seed * 3 + ${salt}`,
      salt => `seed + 0.25 + ${salt}`,
      salt => `seed * 4294967296 + ${salt}`,
      salt => `text + "-" + seed + "-${salt}"`,
      salt => `{ seed, k: ${salt} }`,
      salt => `[seed, text, ${salt}]`,
      salt => `BigInt(seed) * 12345678901234567890n + ${salt}n`,
      salt => `Symbol(text + "${salt}")`,
      salt => `(seed + ${salt}) % 2 === 1`,
      salt => `seed > 1e9 ? ${salt} : undefined`,
      salt => `() => seed + ${salt}`,
      salt => `new Map([[seed, text + ${salt}]])`,
      salt => `new Point(seed, ${salt})`,
      salt => `new Float64Array([seed, ${salt} + 0.5])`,
      salt => `{ in: { in: [seed, { k: ${salt} }] } }`,
      salt => `seed > 1e9 ? ${salt} : -0`,
    ];
    const values = Array.from(
      { length: isWide ? this.pick([255, 256, 257, 258, 300]) : 1 + this.below(7) },
      (_, index) => {
        const at = this.chance(50) ? 0 : this.below(Math.min(late + 2, last - 1) + 1);
        const again = this.several(0, this.pick([0, 0, 0, 1, 2]), () => at + 1 + this.below(last - at));
        const isOnOneBranch = this.chance(20);
        return {
          name: `v${index}`,
          make: this.pick(makers),
          at,
          again,
          reads: this.several(0, this.pick([0, 0, 1, 2]), () => at + this.below(last - at + 1)),
          isOnOneBranch,
          comesBehindASuspension: this.chance(12),
          isCaptured: this.chance(12),
          isDeclaredFirst: isOnOneBranch || again.length > 0 || isInside(at) || this.chance(20),
        };
      },
    );
    const suspension = (label: number) =>
      kind === "generator" && this.chance(50)
        ? `yield ${label};`
        : this.pick([
            `await tick(${label});`,
            `await tick(${label});`,
            "await null;",
            "sum += await tick(1);",
            "await Promise.all([tick(1), tick(2)]);",
          ]);
    const body = [
      "let sum = 0;",
      ...values.filter(value => value.isDeclaredFirst).map(value => `let ${value.name}${any};`),
    ];
    for (let at = 0; at <= last; at++) {
      if (around && at === from)
        body.push(
          around === "loop"
            ? "for (let turn = 0; turn < 2; turn++) {"
            : around === "if"
              ? "if (seed % 2 === 1) {"
              : "try {",
        );
      for (const [index, value] of values.entries()) {
        if (value.at === at) {
          const made = value.comesBehindASuspension ? `(await tick(0), ${value.make(index)})` : value.make(index);
          body.push(
            value.isOnOneBranch
              ? `if (seed !== 2) ${value.name} = ${made};`
              : `${value.isDeclaredFirst ? "" : "const "}${value.name} = ${made};`,
          );
          if (value.isCaptured)
            body.push(
              isInside(at) ? `note("now", (() => ${value.name})());` : `const read${index} = () => ${value.name};`,
            );
        }
        if (at > value.at && value.again.includes(at)) body.push(`${value.name} = ${value.make(100 + at)};`);
        if (at < last && value.reads.includes(at)) body.push(`note("at ${at}", ${value.name});`);
      }
      if (at === throwsAt) body.push(`if (seed === ${this.pick([1, 2, 3])}) throw new Error("thrown at ${at}");`);
      const between = this.below(100);
      if (between < 5) body.push("Bun.gc(true);");
      else if (between < 15) body.push("young();");
      else if (between < 21) body.push("churn(2000);");
      if (around && at === to) {
        const seen = values
          .filter(value => value.isDeclaredFirst || value.at < from)
          .map(value => `, ${value.name}`)
          .join("");
        body.push(
          around === "loop"
            ? "}"
            : around === "if"
              ? `} else { ${suspension(900)} ${suspension(901)} }`
              : around === "try-catch"
                ? `} catch (error${any}) { note("caught", error.message${seen}); ${suspension(902)} }`
                : around === "try-finally"
                  ? `} finally { note("finally"${seen}); }`
                  : `} catch (error${any}) { note("caught", error.message${seen}); } finally { ${suspension(903)} note("finally"${seen}); }`,
        );
      }
      if (at < last) body.push(suspension(at));
    }
    const isVisible = (value: (typeof values)[number]) => value.isDeclaredFirst || !isInside(value.at);
    body.push(
      `note("end", seed, text, sum${values
        .filter(isVisible)
        .map(value => `, ${value.name}`)
        .join("")});`,
      ...values.flatMap((value, index) =>
        value.isCaptured && !isInside(value.at) ? [`note("read", read${index}());`] : [],
      ),
      "return sum;",
    );
    const parameters = `seed${this.typed("number")}, text${this.typed("string")}`;
    const [head, end] =
      kind === "method"
        ? [`const holder = { async run(${parameters})${any} {`, "} };"]
        : kind === "arrow"
          ? [`const run = async (${parameters})${any} => {`, "};"]
          : [`const run = async function${kind === "generator" ? "*" : ""} (${parameters})${any} {`, "};"];
    this.lines.push("{");
    this.emit(
      1,
      `const lines${this.typed("string[]")} = [];`,
      `const Point = class { x${any}; y${any}; constructor(x${any}, y${any}) { this.x = x; this.y = y; } };`,
      `const show = (v${any})${any} => typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? "sym:" + v.description : typeof v === "function" ? "fn:" + v() : Object.is(v, -0) ? "-0" : v instanceof Map ? "map:" + JSON.stringify([...v]) : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);`,
      `const note = (...all${this.typed("any[]")}) => { lines.push(all.map(show).join(" ")); };`,
      `const tick = (value${this.isTypeScript ? "?: any" : ""})${any} => new Promise(resolve => queueMicrotask(() => resolve(value)));`,
      `const junk${this.typed("any[]")} = [];`,
      `const churn = (count${this.typed("number")}) => { for (let i = 0; i < count; i++) junk[i & 1023] = i & 1 ? { a: i, b: "t" + i } : i & 2 ? [i, i + 0.5, "x"] : { seed: i, k: i, list: [i] }; };`,
      `const young = () => { collectTheYoung${number}(); churn(2000); };`,
      head,
    );
    this.emit(2, ...body);
    this.emit(1, end);
    const endsAt = this.chance(33) ? 1 + this.below(last) : -1;
    if (kind === "generator")
      this.emit(
        1,
        `const walk = async (${parameters}) => { let count = 0; try { for await (const each of run(seed, text)) { if (++count === ${endsAt}) break; if (count % 5 === 0) young(); } } catch (error${any}) { note("escaped", error.message); } note("walked", seed, count); };`,
      );
    const calls = [`1, "a"`, `2, "bb"`, `3, "c"`]
      .slice(0, this.pick([2, 3, 3]))
      .map(given =>
        kind === "generator"
          ? `walk(${given})`
          : `${kind === "method" ? "holder.run" : "run"}(${given}).then((value${any}) => note("done", value), (error${any}) => note("escaped", error.message))`,
      );
    const told = `printValue("values held across many suspensions ${number}", lines.join(" | "));`;
    this.emit(
      1,
      this.chance(60)
        ? `Promise.all([${calls.join(", ")}]).then(() => { ${told} });`
        : `(async () => { ${calls.map(call => `await ${call};`).join(" ")} ${told} })();`,
    );
    this.lines.push("}");
  }

  /**
   * Lists that a function makes anew in each call: a literal with elements behind conditional spreads, a rest array handed on to another rest parameter, to `apply` or to a function out of a
   * table, `arguments` spread into a call, a literal that is only searched. Where nobody can tell, the compiler writes such a list in place, hands it over without a copy or keeps it as a
   * constant. Each function is called several times; every list is kept and printed, and a few are also compared by identity, changed behind the calls or made once more: a list that
   * two calls share shows. A few of the functions are so large that the escape analysis gives up in them. The functions are expressions, so that split-into-files.ts leaves them alone.
   */
  sceneOfListsMadeAnewInEachCall() {
    const number = ++this.count;
    const any = this.typed("any");
    this.lines.push("{");
    this.emit(1, `const told${this.typed("string[]")} = [];`);
    for (let index = this.pick([1, 2, 2, 3]); index > 0; index--) {
      const id = `${number}_${index}`;
      const constants = this.pick([
        ['"run"', '"--verbose"', '"--file"', '"end"'],
        ['"run"', '"--verbose"', '"--file"', '"end"'],
        ['"a"', '"b"', '"c"', '"d"'],
        ["1", "2", "3", "4"],
        ["0.5", "1.5", "2.5", "3.5"],
        ['"a"', "2", "null", "true"],
        ["{ k: 1 }", '"b"', "[3]", "undefined"],
      ]);
      // Two thousand objects in one list and as many reads of it: more work than the escape analysis does for one function.
      const padding = this.chance(3)
        ? [
            `const all${this.typed("{ k: number }[]")} = []; let sum = 0;`,
            Array.from({ length: 2000 }, (_, at) => `all.push({ k: ${at} });`).join(" "),
            Array.from({ length: 2000 }, (_, at) => `sum += all[${at}].k;`).join(" "),
          ]
        : [];
      const given = this.several(
        3,
        4,
        () =>
          `${this.pick(["true", "false"])}, ${this.pick(['"f"', '""', "undefined", '"g"', "0", "7"])}, ${this.pick(['"n"', "5", '"m"'])}`,
      );
      const inner = this.pick([
        `(...all${this.typed("any[]")}) => all`,
        `(...all${this.typed("any[]")}) => { all[0] = "changed"; return all; }`,
        `(...all${this.typed("any[]")}) => { all.push("pushed"); return all; }`,
        `function (...all${this.typed("any[]")}) { all.length = Math.min(all.length, 2); return all; }`,
        `(first${any}, ...others${this.typed("any[]")}) => { others.unshift(first); return others; }`,
      ]);
      const parameters = `on${any}, more${any}, x${any}`;
      const [name, before, made, outside = []] = this.pick<() => [string, string[], string, string[]?]>([
        () => [
          "a literal",
          [],
          `[${constants[0]}, ...(on ? [${constants[1]}] : []), x, ...(more ? [${constants[2]}, more] : [])]`,
        ],
        () => [
          "a literal",
          [],
          `[${constants[0]}, ...(on ? [${constants[1]}] : []), x, ...(more ? [${constants[2]}, more] : [])]`,
        ],
        () => ["a literal", [], `[...(on ? [${constants[0]}, ${constants[1]}] : [${constants[2]}]), ${constants[3]}]`],
        () => [
          "a nested literal",
          [],
          `[${constants[0]}, ...(on ? [${constants[1]}, ...(more ? [${constants[2]}] : [x, x]), ${constants[3]}] : []), x]`,
        ],
        () => [
          "arguments behind a spread",
          [`const collect = (...values${this.typed("any[]")}) => values;`],
          `collect(${constants[0]}, ...(on ? [${constants[1]}] : []), x, ...(more ? [${constants[2]}, more] : []))`,
        ],
        () => [
          "arguments behind a spread",
          [`const collect = (first${any}, ...values${this.typed("any[]")}) => values;`],
          `collect(x, ${constants[0]}, ...(on ? [${constants[1]}] : []), ${constants[3]})`,
        ],
        () => [
          "arguments out of a list",
          [
            `const list = ()${any} => [${constants[1]}, ${constants[2]}];`,
            `const collect = (...values${this.typed("any[]")}) => values.join(" ");`,
          ],
          `collect(${constants[0]}, ...list(), list().pop(), list().at(-1), x)`,
        ],
        () => ["a literal", [], `[${constants[0]}, ${constants[1]}, ...(more ? [more] : []), x]`],
        () => [
          "a nested literal",
          [],
          `[${constants[0]}, ...(more ? [${constants[1]}, ...(on ? [x] : [])] : [${constants[2]}])]`,
        ],
        // The callee is known and takes what stands in front of the spread by name: the caller's rest array can be handed over as the callee's.
        ...[
          ["a rest array behind named parameters", "keeps(1, 2, ...args)"],
          ["a rest array behind named parameters", "keeps(1, 2, ...args)"],
          [
            "a rest array read again",
            "((got) => [got.length, args.length, args[0], got === args])(keeps(1, 2, ...args))",
          ],
          ["a rest array handed over twice", "[keeps(1, 2, ...args), keeps(3, 4, ...args), args]"],
          ["a rest array stored and handed over", "(stored.push(args), [keeps(1, 2, ...args), stored.length])"],
          ["a rest array that is only read", "reads(1, 2, ...args)"],
        ].map(([name, body]): (() => [string, string[], string, string[]]) => () => [
          name,
          [],
          `forwards${id}(on, more, x)`,
          [
            `const stored${id}${this.typed("any[]")} = [];`,
            `const keeps${id} = function (a${any}, b${any}, ...rest${this.typed("any[]")}) { rest.push(a + b); rest[0] = "changed"; return rest; };`,
            `const reads${id} = function (a${any}, b${any}, ...rest${this.typed("any[]")}) { let sum = a + b; for (let i = 0; i < rest.length; i++) sum += String(rest[i]).length; return sum; };`,
            `const forwards${id} = function (...args${this.typed("any[]")})${any} { return ${body.replace(/\b(keeps|reads|stored)\b/g, `$1${id}`).replace("(got)", `(got${any})`)}; };`,
          ],
        ]),
        () => ["a constant literal", [], `[${constants.join(", ")}]`],
        () => ["a copy", [], `[...[${constants.slice(0, 3).join(", ")}], ...(on ? [x] : [])]`],
        () => [
          "a filled list",
          [
            `const out${this.typed("any[]")} = [];`,
            `out.push([${constants.join(", ")}].indexOf(x), [${constants.join(", ")}].at(-1), [${constants.join(", ")}].includes(more), [${constants.slice(0, 2).join(", ")}].length);`,
          ],
          "out",
        ],
        () => ["a rest array", [`const inner${any} = ${inner};`], "inner(on, more, x)"],
        () => [
          "a rest array handed on",
          [
            `const inner${any} = ${inner};`,
            `const outer = (...args${this.typed("any[]")}) => inner(${constants[0]}, ...args);`,
          ],
          "outer(on, more, x)",
        ],
        () => [
          "a rest array handed on alone",
          [`const inner${any} = ${inner};`, `const outer = (...args${this.typed("any[]")}) => inner(...args);`],
          "outer(on, more, x)",
        ],
        () => [
          "a rest array applied",
          [
            `const inner${any} = ${inner};`,
            `const outer = (...args${this.typed("any[]")}) => ${this.pick(["inner.apply(null, args)", "Reflect.apply(inner, null, args)", "inner.call(null, ...args)"])};`,
          ],
          "outer(on, more, x)",
        ],
        () => [
          "a rest array and what was made of it",
          [`const inner${any} = ${inner};`, `const outer = (...args${this.typed("any[]")}) => [inner(...args), args];`],
          "outer(on, more, x)",
        ],
        () => [
          "a rest array for a function out of a table",
          [
            `const table${this.typed("any[]")} = [${inner}, (...all${this.typed("any[]")}) => all.slice()];`,
            `const outer = (...args${this.typed("any[]")}) => table[args.length % 2 ? 0 : 1](...args);`,
          ],
          "outer(on, more, x)",
        ],
        () => [
          "arguments",
          [
            `const inner${any} = ${inner};`,
            `const outer${any} = function () { const got = inner(...arguments); arguments[0] = "late"; return got; };`,
          ],
          "outer(on, more, x)",
        ],
      ])();
      this.emit(1, ...outside, `const make${id} = function (${parameters})${any} {`);
      this.emit(2, ...padding, ...before, `return ${made};`);
      this.emit(1, "};");
      const calls = given.map(each => `make${id}(${each})`);
      // Most lists are only printed. A write, a comparison or one more caller anywhere in the program tells the compiler more about the list, and it then leaves the list alone.
      const behind = this.plainly(70, "", () =>
        this.pick([
          ` told.push(kept${id}.map((each${any}, at${any}) => kept${id}.indexOf(each) === at).join());`,
          ` for (const each of kept${id}) if (Array.isArray(each)) each.push("behind"); told.push(JSON.stringify(kept${id}));`,
          ` told.push(JSON.stringify((() => ${calls[0]})()));`,
          ` told.push(kept${id}.map((each${any}) => (Array.isArray(each) ? each.length + ":" + each.join() : String(each))).join(";"));`,
        ]),
      );
      this.emit(
        1,
        this.chance(25)
          ? `const kept${id}${this.typed("any[]")} = []; for (let turn = 0; turn < ${this.pick([2, 3, 300])}; turn++) { const made = make${id}(${given[0]}); if (turn < 3) kept${id}.push(made); }`
          : `const kept${id}${this.typed("any[]")} = [${calls.join(", ")}];`,
        `told.push("${name} ${id} " + JSON.stringify(kept${id}));${behind}`,
      );
    }
    this.emit(1, `printValue("lists made anew in each call ${number}", told.join(" | "));`);
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
        () => scenes.sceneOfValuesThatACalleeKeepsOnOnePath(),
        () => scenes.sceneOfValuesThatACalleeKeepsOnOnePath(),
        () => scenes.sceneOfValuesThatACalleeKeepsOnOnePath(),
        () => scenes.sceneOfValuesThatACalleeKeepsOnOnePath(),
        () => scenes.sceneOfValuesThatACalleeKeepsOnOnePath(),
        () => scenes.sceneOfObjectsHandedToTheLanguage(),
        () => scenes.sceneOfObjectsHandedToTheLanguage(),
        () => scenes.sceneOfObjectsHandedToTheLanguage(),
        () => scenes.sceneOfObjectsHandedToTheLanguage(),
        () => scenes.sceneOfObjectsHandedToTheLanguage(),
        () => scenes.sceneOfListsThatChangeTheirStorage(),
        () => scenes.sceneOfListsThatChangeTheirStorage(),
        () => scenes.sceneOfListsThatChangeTheirStorage(),
        () => scenes.sceneOfListsThatChangeTheirStorage(),
        () => scenes.sceneOfListsThatChangeTheirStorage(),
        () => scenes.sceneOfFunctionsUsedAsMoreThanCallees(),
        () => scenes.sceneOfFunctionsUsedAsMoreThanCallees(),
        () => scenes.sceneOfFunctionsUsedAsMoreThanCallees(),
        () => scenes.sceneOfFunctionsUsedAsMoreThanCallees(),
        () => scenes.sceneOfFunctionsUsedAsMoreThanCallees(),
        () => scenes.sceneOfFunctionsCalledWithAnotherThis(),
        () => scenes.sceneOfFunctionsCalledWithAnotherThis(),
        () => scenes.sceneOfFunctionsCalledWithAnotherThis(),
        () => scenes.sceneOfFunctionsCalledWithAnotherThis(),
        () => scenes.sceneOfFunctionsCalledWithAnotherThis(),
        () => scenes.sceneOfArgumentsChangedBetweenTwoWalks(),
        () => scenes.sceneOfArgumentsChangedBetweenTwoWalks(),
        () => scenes.sceneOfArgumentsChangedBetweenTwoWalks(),
        () => scenes.sceneOfArgumentsChangedBetweenTwoWalks(),
        () => scenes.sceneOfArgumentsChangedBetweenTwoWalks(),
        () => scenes.sceneOfMembersWrittenOverByAnotherKind(),
        () => scenes.sceneOfMembersWrittenOverByAnotherKind(),
        () => scenes.sceneOfMembersWrittenOverByAnotherKind(),
        () => scenes.sceneOfMembersWrittenOverByAnotherKind(),
        () => scenes.sceneOfMembersWrittenOverByAnotherKind(),
        () => scenes.sceneOfVariablesThatChangeFromTurnToTurn(),
        () => scenes.sceneOfVariablesThatChangeFromTurnToTurn(),
        () => scenes.sceneOfVariablesThatChangeFromTurnToTurn(),
        () => scenes.sceneOfVariablesThatChangeFromTurnToTurn(),
        () => scenes.sceneOfVariablesThatChangeFromTurnToTurn(),
        () => scenes.sceneOfLiteralsChangedThroughASecondName(),
        () => scenes.sceneOfLiteralsChangedThroughASecondName(),
        () => scenes.sceneOfBuiltInsWrittenUnderAHiddenKey(),
        () => scenes.sceneOfBuiltInsWrittenUnderAHiddenKey(),
        () => scenes.sceneOfReplaceableMembersWrittenThroughAChain(),
        () => scenes.sceneOfReplaceableMembersWrittenThroughAChain(),
        () => scenes.sceneOfObjectsBelowAnInstanceOnARarePath(),
        () => scenes.sceneOfObjectsBelowAnInstanceOnARarePath(),
        () => scenes.sceneOfResultsOfBuiltInsHeldUnderOneShape(),
        () => scenes.sceneOfResultsOfBuiltInsHeldUnderOneShape(),
        () => scenes.sceneOfCountersSteppedInsideTheirTests(),
        () => scenes.sceneOfCountersSteppedInsideTheirTests(),
        () => scenes.sceneOfValuesHeldAcrossManySuspensions(),
        () => scenes.sceneOfValuesHeldAcrossManySuspensions(),
        () => scenes.sceneOfListsMadeAnewInEachCall(),
        () => scenes.sceneOfListsMadeAnewInEachCall(),
        () => scenes.sceneOfLiteralsChangedThroughASecondName(),
        () => scenes.sceneOfLiteralsChangedThroughASecondName(),
        () => scenes.sceneOfLiteralsChangedThroughASecondName(),
        () => scenes.sceneOfListsWhoseTypeListsTheirTexts(),
        () => scenes.sceneOfListsWhoseTypeListsTheirTexts(),
        () => scenes.sceneOfListsWhoseTypeListsTheirTexts(),
        () => scenes.sceneOfListsWhoseTypeListsTheirTexts(),
        () => scenes.sceneOfListsWhoseTypeListsTheirTexts(),
        () => scenes.sceneOfVariablesThatCallbacksWrite(),
        () => scenes.sceneOfVariablesThatCallbacksWrite(),
        () => scenes.sceneOfVariablesThatCallbacksWrite(),
        () => scenes.sceneOfVariablesThatCallbacksWrite(),
        () => scenes.sceneOfVariablesThatCallbacksWrite(),
        () => scenes.sceneOfListsWithEmptyPlaces(),
        () => scenes.sceneOfListsWithEmptyPlaces(),
        () => scenes.sceneOfListsWithEmptyPlaces(),
        () => scenes.sceneOfListsWithEmptyPlaces(),
        () => scenes.sceneOfListsWithEmptyPlaces(),
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
