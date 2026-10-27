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
          ...declarations,
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
    this.files.push([file, [...declarations, ""].join("\n")]);
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
}

/**
 * `text` with one to three scenes of ordinary code. In six programs of ten they are the whole program: what the compiler knows about a function of the library depends on all its callers.
 * What is drawn depends on `text` alone.
 */
export function writeOrdinaryScenes(text: string, isTypeScript: boolean) {
  const [program, ...otherFiles] = text.split(/^(?=\/\/ @filename: )/m);
  const first = "const printValue = console.log;\n";
  if (!program.startsWith(first)) return text;
  const random = randomFrom("ordinary" + text);
  const scenes = new Scenes(random, isTypeScript);
  for (let count = scenes.pick([1, 1, 1, 2, 2, 3]); count > 0; count--)
    scenes.pick([
      () => scenes.sceneOfParsedData(),
      () => scenes.sceneOfParsedData(),
      () => scenes.sceneOfWalks(),
      () => scenes.sceneOfWalks(),
      () => scenes.sceneOfIdioms(),
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
