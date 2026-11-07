// One function with one loop, or one loop in another, put together from tables that do not know of each other: what is walked, how the head counts, where each variable lives, what the body does,
// what kind of function it is, with what it is called. A compiler decides most about a loop at its head, for all turns at once: which kind a variable has, how far an index goes, what a call can change.
// A fault shows where two things meet that its author did not think of together: a variable of the file and a second loop, a closure of the turn before and a sum, one place ahead and the end of a view.
//
// The body is a motif: two or three statements that act on one variable together, such as a test of it and a store of another kind into it. Statements drawn one by one would hardly ever meet.
// The scenes of write-single-deeds.ts each vary one known shape. Here every motif meets every home, head, function and thing to walk.

type Walked = {
  /** Lines in front of everything. */
  setup?: string[];
  /** Lines that make a new one, named `made`, in front of each call. */
  fresh: string[];
  /** An expression that makes another one inside the function. */
  again?: string;
  type: string;
  isIndexed: boolean;
  canStore: boolean;
  holds: "numbers" | "records" | "anything";
  /** What can happen to it in one turn of the loop. */
  events: string[];
  show: string;
  /** What a turn of an outer loop reads off it behind the inner loop, where each outer turn makes a new one. */
  leaves?: string;
};
/** `enters` and `ends` stand at the start and at the end of each turn of an outer loop. */
type Motif = {
  outside?: string[];
  front?: string[];
  enters?: string[];
  body: string[];
  ends?: string[];
  behind?: string[];
};

export function writeSceneOfALoop(random: () => number, n: number, isTypeScript: boolean): string[] {
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const chance = (percent: number) => random() * 100 < percent;
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const any = typed("any");
  const number = typed("number");
  const otherKind = () => pick(['"x"', '"x"', '"head"', '""', "null", "undefined", "0.5", "2.5", "-0", "{}", "[7]", "true", "{ length: 4 }", "4294967296", "NaN"]); // prettier-ignore
  const unseen = (value: string) =>
    value === "undefined" || value === "-0" || value === "NaN"
      ? value
      : `JSON.parse(${JSON.stringify(value.replace(/(\w+):/g, '"$1":'))})`;

  // What is walked. Most of it is made in plain sight, so that the compiler knows what comes in.
  const View = pick(["Int32Array", "Int32Array", "Uint8Array", "Float64Array", "Uint16Array", "Float32Array"]);
  const outside = otherKind();
  const yielded = pick(["i", "i", "i", "i * 0.5", "String(i)", "[i]"]);
  const overAnother = chance(40);
  const listEvents = [
    "c.push(9);",
    "c.pop();",
    "c.length = 1;",
    "c[6] = 1;",
    "c.shift();",
    "c.unshift(0);",
    "c.reverse();",
    "c[i + 1] = 7;",
  ];
  const list = (fresh: string, more: Partial<Walked> = {}): Walked => ({
    fresh: [`const made = ${fresh};`],
    again: fresh,
    type: "number[]",
    isIndexed: true,
    canStore: true,
    holds: "numbers",
    events: listEvents,
    show: "made.map(String).join()",
    ...more,
  });
  const views = (): Walked => ({
    fresh: [
      `const room = new ArrayBuffer(12 * ${View}.BYTES_PER_ELEMENT);`,
      `const front = new ${View}(room, 0, 4), made = new ${View}(room, 4 * ${View}.BYTES_PER_ELEMENT, 4), behind = new ${View}(room, 8 * ${View}.BYTES_PER_ELEMENT, 4);`,
      `for (let at = 0; at < 4; at++) { front[at] = 100 + at; made[at] = at + 1; behind[at] = 70 + at; }`,
    ],
    type: View,
    isIndexed: true,
    canStore: true,
    holds: "numbers",
    events: ["c.fill(1);", "c[i + 1] = 9;", "c.set([8], 0);", "c.reverse();"],
    show: `front.join() + "/" + made.join() + "/" + behind.join()`,
  });
  const walked = pick<() => Walked>([
    () =>
      list(
        pick([
          "[1, 2, 3, 4]",
          "[1, 2, 3, 4]",
          'JSON.parse("[1,2,3,4]")',
          "[1, 2, 3, 4].slice()",
          "Array.of(1, 2, 3, 4)",
        ]),
      ),
    () => list(pick(["[1, 2, 3, 4]", "[0.5, 1.5, 2.5, 3.5]", "[1, 2, 3, 4.5]", "new Array(4).fill(2)"])),
    () => list(`[${outside}, 1, 2, ${otherKind()}]`, { type: "any[]", holds: "anything" }),
    () =>
      list(pick(["[1, , 3, 4]", `Object.freeze([1, 2, 3, 4])${isTypeScript ? " as any[]" : ""}`]), {
        type: "any[]",
        holds: "anything",
        events: ["mark = c.length;"],
      }),
    () =>
      list(`[1, 2, 30].map(id => ({ id, cents: id * 10 }))`, {
        setup: isTypeScript ? [`interface Row${n} { id: number; cents: number }`] : [],
        fresh: [
          `const made${typed(`Row${n}[]`)} = [];`,
          `for (const digits of ["1", "2", "30"]) made.push({ id: JSON.parse(digits), cents: JSON.parse(digits + "0") });`,
        ],
        type: `Row${n}[]`,
        canStore: false,
        holds: "records",
        events: ["c.pop();", "c.push({ id: 4, cents: 5 });", "c[0].cents = 0.5;"],
        show: "made.length",
      }),
    views,
    views,
    views,
    () =>
      list(`new Shelf${n}()`, {
        setup: [
          pick([
            `class Shelf${n} { reads${any} = 0; get length() { this.reads = this.reads + 1; return 4; } }`,
            `class Shelf${n} { reads${any} = 0; get length() { this.reads = this.reads + 1; return 4; } }`,
            `class Shelf${n} { reads = 0; known = -1; get length()${number} { this.reads++; if (this.known < 0) this.known = 4; return this.known; } }`,
            `class Base${n} { reads${any} = 0; get length() { this.reads = this.reads + 1; return 4; } }\nclass Shelf${n} extends Base${n} { more = 1; }`,
            `class Shelf${n} { reads${any} = 0; bump() { this.reads = this.reads + 1; return 4; } get length() { return this.bump(); } }`,
          ]),
        ].flatMap(text => text.split("\n")),
        type: "any",
        canStore: false,
        holds: "anything",
        events: ["mark = c.length;"],
        show: "made.reads",
        leaves: "c.reads",
      }),
    () =>
      list(`new Shelf${n}()`, {
        setup: [`class Shelf${n} { reads${any} = 0; get length() { this.reads = this.reads + 1; return 4; } }`],
        type: "any",
        canStore: false,
        holds: "anything",
        events: ["mark = c.length;"],
        show: "made.reads",
        leaves: "c.reads",
      }),
    () =>
      list(pick(['"abcd"', `JSON.parse('"abcd"')`, '"a\\u{1F600}b"']), {
        type: "string",
        canStore: false,
        holds: "anything",
        events: ["mark = c.length;"],
        show: "made",
      }),
    () =>
      list("new Set([1, 2, 3, 4])", {
        type: "Set<number>",
        isIndexed: false,
        canStore: false,
        events: ["c.add(9);", "c.delete(3);", "c.clear();"],
        show: "[...made].join()",
      }),
    () => list('new Map([[1, "a"], [2, "b"], [3, "c"]])', { type: "Map<number, string>", isIndexed: false, canStore: false, holds: "anything", events: ['c.set(9, "z");', "c.delete(3);"], show: "[...made].join()" }), // prettier-ignore
    ...Array.from(
      { length: 2 },
      () => () =>
        list(`parts${n}(4)`, {
          setup: [
            ...(overAnother
              ? [
                  `function* parts${n}(count${number})${typed("Generator<any>")} { for (const value of inner${n}(count)) yield ${pick(["value", "value", 'typeof value === "number" ? value * 2 : value'])}; }`,
                ]
              : []),
            `function* ${overAnother ? "inner" : "parts"}${n}(count${number})${typed("Generator<any>")} { ${pick([`yield ${outside}; for (let i = 0; i < count; i++) yield ${yielded};`, `yield ${outside}; for (let i = 0; i < count; i++) yield ${yielded};`, `yield ${outside}; for (let i = 0; i < count; i++) yield ${yielded};`, `for (let i = 0; i < count; i++) yield ${yielded};`, `for (let i = 0; i < count; i++) yield ${yielded}; yield ${outside};`, `for (let i = 0; i < count; i++) { if (i === 2) yield ${outside}; yield ${yielded}; }`])} }`,
          ],
          type: "Generator<any>",
          isIndexed: false,
          canStore: false,
          holds: "anything",
          events: ["c.return(0);", "mark = c.next().value;"],
          show: '""',
        }),
    ),
    () =>
      list(
        pick([
          `new Rack${n}(0)`,
          `new Rack${n}(0)`,
          `round & 1 ? [1, 2, 3] : new Rack${n}(1)`,
          `round & 1 ? new Rack${n}(1) : [1, 2, 3]`,
        ]),
        {
          setup: [
            `const bounds${n} = [4];`,
            `class Rack${n} { from${number}; constructor(from${number}) { this.from = from; } [Symbol.iterator]()${any} { let at = this.from; return { next: ()${any} => { ${pick([`const [limit] = bounds${n};`, `const [limit] = bounds${n};`, `const limit = bounds${n}[0];`, "const limit = 4;"])} return at < limit ? { done: false, value: at++ } : { done: true, value: undefined }; }${chance(30) ? `, return()${any} { heard${n}++; return {}; }` : ""} }; } }`,
          ],
          again: `new Rack${n}(1)`,
          type: `number[] | Rack${n}`,
          isIndexed: false,
          canStore: false,
          events: [`bounds${n}[0] = 2;`, `bounds${n}[0] = 6;`],
          show: `bounds${n}.join()`,
        },
      ),
    () =>
      list(`(function (...all${typed("number[]")}) { return arguments; })(1, 2, 3, 4)`, {
        type: "any",
        events: ["c.length = 2;", "c[i + 1] = 7;"],
        show: "Array.from(made).join()",
      }),
  ])();

  const shape = pick([
    "function",
    "function",
    "function",
    "function",
    "function",
    "arrow",
    "method",
    "async",
    "async",
    "generator",
  ]);

  // Where each variable lives.
  type Home = "local" | "outer" | "held" | "field";
  const home = () =>
    pick<Home>(["local", "local", "local", "outer", "outer", shape === "method" ? "outer" : "held", "field"]);
  const born: Record<string, string> = {
    a: pick(["0", "0", "0", "0.5", "-1"]),
    b: pick(["0", "0", "0", "undefined", "undefined", "null", '""', "-1"]),
    t: '""',
    ticks: "0",
  };
  const homes: Record<string, Home> = {
    a: home(),
    b: home(),
    t: pick<Home>(["local", "local", "local", "outer"]),
    ticks: pick<Home>(["local", "outer", "outer"]),
  };
  const ref = (name: string) =>
    homes[name] === "field" ? `box${n}.${name}` : homes[name] === "outer" ? `${name}${n}` : name;
  const [a, b, t, ticks] = [ref("a"), ref("b"), ref("t"), ref("ticks")];

  // How the head counts.
  const isNested = chance(walked.leaves ? 85 : 30);
  // An object of the program's own has no iterator.
  const walksByIndex = walked.leaves !== undefined || (walked.isIndexed && chance(65));
  const form = walksByIndex ? pick(["for", "for", "for", "for", "down", "while", "do"]) : "of";
  const turn = pick(["i++", "i++", "i++", "i += step", "i += 1", "++i"]);
  const bound = pick([
    "i < to",
    "i < to",
    "i < to",
    "i < to",
    "i < c.length",
    "i < c.length",
    "i <= to - 1",
    "i < to && i < c.length",
  ]);
  const canContinue = form === "for" || form === "down" || form === "of";

  // What the body does.
  const x = walked.holds === "records" ? pick(["x.cents", "x.cents", "x.id"]) : "x";
  const beside = pick(["i + 1", "i + 1", "i + 1", "i - 1", "i + 2", "i + step"]);
  const when = pick(["1", "2", "2", "3", "99"]);
  const closure = (deed: string) => pick([`() => { ${deed} }`, `() => { ${deed} }`, `function () { ${deed} }`]);
  const motifs: (() => Motif | false)[] = [
    // A variable is tested and then given another kind: what one turn leaves there the next one finds.
    () => {
      const test = pick([`if (${b} === mark) same = i;`, `if (${b} === mark) same = i;`, `if (${b} === mark) same = i;`, `if (${b} !== mark) same = i;`, `if (typeof ${b} === typeof mark) same++;`, `if (${b} == mark) same++;`]); // prettier-ignore
      const store = pick([`${b} = i < 2 ? i : mark;`, `${b} = i < 2 ? i : mark;`, `${b} = i < 2 ? i : mark;`, `${b} = i & 1 ? mark : i;`, `if (i > 1) ${b} = mark;`, `[${b}] = [i < 2 ? i : mark];`, `${b} = hook(i < 2 ? i : mark);`]); // prettier-ignore
      return {
        front: pick([[], [], [`${b} = end;`], [`${b} = mark;`]]),
        body: chance(75) ? [test, store] : [store, test],
      };
    },
    () => {
      const test = pick([
        `if (${b} === mark) same = i;`,
        `if (${b} === mark) same = i;`,
        `if (${b} !== mark) same = i;`,
      ]);
      return { body: [test, pick([`${b} = i < 2 ? i : mark;`, `${b} = i < 2 ? i : mark;`, `${b} = i;`])] };
    },
    // A renderer: a switch on what the element is, a `try` in one case, a text that grows behind it, and a way out of the whole function.
    () => {
      const counts = pick([
        `${a} += String(x).length;`,
        `${a} += String(x).length;`,
        `${a} += x.length;`,
        `${a} += 1;`,
        `same += String(x).length;`,
      ]);
      const grows = pick([`${t} += x;`, `${t} += x;`, `${t} += String(x);`, `${t} = ${t} + x + ",";`]);
      const guarded = pick([
        `try { ${counts} } catch (error) { ${a} += 1; }`,
        `try { ${counts} } catch (error) { ${a} += 1; }`,
        `try { ${counts} } finally { same++; }`,
        counts,
      ]);
      const asked = pick(["typeof x", "typeof x", "typeof x", "i & 1", "String(x).length"]);
      const label = asked === "typeof x" ? pick(['"number"', '"string"', '"object"', '"number"']) : pick(["0", "1"]);
      return {
        body: [
          pick([
            `switch (${asked}) { case ${label}: ${guarded} ${grows} break; }`,
            `switch (${asked}) { case ${label}: ${guarded} ${grows} break; }`,
            `switch (${asked}) { case ${label}: ${guarded} ${grows} break; default: ${grows} }`,
            `switch (${asked}) { case ${label}: ${grows} ${guarded} break; default: same++; }`,
            `if (${asked} === ${label}) { ${guarded} ${grows} }`,
          ]),
          pick([
            `if (${a} > 6) return "too wide";`,
            `if (${a} > 6) return "too wide";`,
            `if (${a} > 2) return "too wide";`,
            `if (same > 3) return "too wide";`,
            `if (${t}.length > 6) return "too wide";`,
            `if (${a} > 6) break;`,
            `if (same > 3) return ${t};`,
            "",
          ]),
        ].filter(Boolean),
      };
    },
    // A closure that one turn makes runs in the next.
    () => {
      const write = pick([
        `${a} += 1;`,
        `${a} += 1;`,
        `${a}++;`,
        `${a} = ${a} + i;`,
        `${a} += 0.5;`,
        `${b} = ${a};`,
        "same += 1;",
        `${t} += "!";`,
      ]);
      const makes = pick([
        `last = ${closure(write)};`,
        `last = ${closure(write)};`,
        `if (i & 1) last = ${closure(write)};`,
        `kept.push(${closure(write)}); last = kept[kept.length - 1];`,
      ]);
      const calls = pick([
        "if (last !== null) last();",
        "if (last !== null) last();",
        "last?.();",
        "if (i > 1) last();",
      ]);
      const reads = pick([`same += ${a};`, `same += ${a};`, `${t} += ${a};`, `held = ${a};`]);
      return { body: pick([[calls, reads, makes], [calls, reads, makes], [reads, calls, makes], [makes, reads, calls], [calls, makes, reads]]) }; // prettier-ignore
    },
    // A place beside the one at which the loop stands.
    () =>
      walked.isIndexed &&
      walked.holds !== "records" && {
        body: [
          pick([
            ...(walked.canStore ? [`c[${beside}] = 5; ${a} = (${a} + c[i]) | 0;`, `c[${beside}] = 5; ${a} = (${a} + c[i]) | 0;`, `c[i] = c[${beside}]; ${a} += 1;`, `c[${beside}] = c[i]; ${a} += 1;`, `c[i] = c[i] + 1; c[i + 1] = c[i + 1] + 1; c[i + 2] = c[i + 2] + 1; ${a} += 1;`] : []), // prettier-ignore
            `${a} = (${a} + c[${beside}] + c[i]) | 0;`,
            `${a} = (${a} + c[i] + c[${beside}]) | 0;`,
            `${a} += c[i] * c[${beside}];`,
            `if (c[${beside}] === undefined) same += 100; else ${a} += c[i];`,
          ]),
        ],
      },
    () =>
      walked.isIndexed &&
      walked.canStore && { body: [pick([`c[${beside}] = 5; ${a} = (${a} + c[i]) | 0;`, `${a} = (${a} + c[${beside}] + c[i]) | 0;`, `c[${beside}] = c[i]; ${a} += 1;`])] }, // prettier-ignore
    // Small numbers beside the counter, two written out and one held: in a variable in front of the loop, out of a helper.
    () => {
      if (!walked.isIndexed || !walked.canStore) return false;
      const [held, one, other] = pick([[2, 2, 1], [2, 2, 1], [1, 1, -1], [1, 1, -1], [1, 1, 0], [3, 3, 1], [2, 1, -1], [-1, -1, 1]]); // prettier-ignore
      const helper = chance(30);
      const place = (add: number) => (add === 0 ? "i" : `i + ${add}`);
      const three = chance(75)
        ? [`c[i + ahead] = 5;`, `c[${place(one)}] = 6;`, `c[${place(other)}] = 7;`]
        : [
            `${a} = (${a} + (c[i + ahead] | 0)) | 0;`,
            `${a} = (${a} + (c[${place(one)}] | 0)) | 0;`,
            `${a} = (${a} + (c[${place(other)}] | 0)) | 0;`,
          ];
      return {
        outside: helper ? [`function reach${n}()${number} { return ${held}; }`] : [],
        front: [
          helper
            ? `const ahead = reach${n}();`
            : pick([
                `let ahead = ${held};`,
                `let ahead = ${held};`,
                `const ahead = ${held};`,
                `var ahead = ${held};`,
                `let ahead = ${held - 1}; ahead++;`,
              ]),
        ],
        body: [pick([[0, 1, 2], [0, 1, 2], [0, 2, 1], [1, 0, 2], [2, 1, 0]]).map(at => three[at]).join(" ")], // prettier-ignore
      };
    },
    // A sum is born anew in each turn of an outer loop, as a variable of that turn, and grows by what the loop carries from turn to turn: of one kind in the first turn, of another behind it.
    ...Array.from({ length: 2 }, () => () => {
      if (!isNested) return false;
      const [first, later] = pick([['""', "r"], ['""', "r"], ['"a"', "r"], ["0", '"t" + r'], ["null", "r"], ["undefined", "r"], ["0.5", "r"], ["true", "r"]]); // prettier-ignore
      return {
        front: [`let carried${any} = ${first};`],
        enters: [`let sum${any} = ${pick(["0", "0", "0", "true", "0.5", "null", '""'])};`],
        body: [pick([`sum = sum + carried;`, `sum = sum + carried;`, `sum += carried;`, `sum = carried + sum;`])],
        ends: [`${t} += typeof sum + " " + String(sum) + ";";`, `carried = ${later};`],
      };
    }),
    // The length of an object of the program's own is an accessor that writes.
    ...Array.from(
      { length: 6 },
      () => () =>
        walked.leaves !== undefined && {
          body: [
            pick([
              `${a} = ${a} + c.length;`,
              `${a} = ${a} + c.length;`,
              `${a} += c.length;`,
              `if (c.length > 2) same++;`,
              `const l = c.length; ${a} += l;`,
            ]),
          ],
        },
    ),
    // The kind of what comes round decides.
    () =>
      walked.holds === "anything" && {
        body: [
          pick([
            `if (typeof x === "string") ${b} = x.length;`,
            `if (typeof x === "string") ${b} = x.length;`,
            `if (typeof x === "string") ${b} = x.length;`,
            `if (typeof x !== "number") ${b} = x;`,
            `${b} = x;`,
            `if (x === null) ${b} = "none";`,
            `if (typeof x === "number") ${b} = (${b} ?? 0) + x;`,
            `if (x && x.length) ${b} = x.length;`,
            `${b} = typeof x;`,
          ]),
        ],
      },
    () =>
      walked.holds === "anything" && {
        body: [
          pick([`if (typeof x === "string") ${b} = x.length;`, `if (typeof x !== "number") ${b} = x;`, `${b} = x;`]),
        ],
      },
    // A text grows.
    () => {
      const part = () =>
        pick([
          `\`\${${x}}\``,
          `\`\${${x}}\``,
          `\`\${i}\``,
          x,
          x,
          "i",
          a,
          `String(${x})`,
          '"$"',
          '""',
          "mark",
          `\`#\${i}\``,
        ]);
      const grows = pick([`${t} += ${part()} + ${part()} + ";";`, `${t} += ${part()} + ${part()} + ";";`, `${t} += ${part()} + (${part()} + ${part()}) + ";";`, `${t} += i + ",";`, `${t} += i + ",";`, `${t} = ${t} + ${x} + ",";`, `${t} += \`\${i},\`;`]); // prettier-ignore
      const keeps = pick([
        "",
        "",
        `copy = echo${n}(${t});`,
        `copy = echo${n}(${t});`,
        `copy = String(${t});`,
        `copy = ${t};`,
        `if (i & 1) copy = echo${n}(${t});`,
      ]);
      return { body: [grows, ...(keeps ? [keeps] : [])] };
    },
    () => ({
      body: [
        pick([`${t} += i + ",";`, `${t} += ${x} + ",";`]),
        pick([`copy = echo${n}(${t});`, `copy = echo${n}(${t});`, `copy = ${t}.slice(0);`]),
      ],
    }),
    // Patterns over lists walk too, in front of the loop and in it.
    () => ({
      front: [Array.from({ length: pick([0, 3, 3, 12, 53]) }, () => `[held] = [held + 1];`).join(" ")].filter(Boolean),
      body: [
        pick([
          `${a} += hook(${x});`,
          `${a} += hook(${x});`,
          `const [first] = pair; ${a} += first;`,
          `[${a}] = [${a} + 1];`,
        ]),
        `if (++same > 50) break;`,
      ],
    }),
    // Something happens to what is walked, in one turn.
    () => ({
      body: [
        pick([
          `${a} += typeof ${x} === "number" ? ${x} : 1;`,
          `${t} += String(${x});`,
          ...(walked.isIndexed ? [`${a} += c.length;`] : []),
        ]),
        `if (i === ${when}) { ${pick(walked.events)} }`,
      ],
    }),
    // A call may change what the loop holds.
    () => ({ body: pick([[`same += ${b} === mark ? 1 : 0;`, `hook(i);`], [`${a} += hook(i);`, `${t} += ${a};`], [`${b} = hook(${b});`, `if (typeof ${b} === "number") same++;`]]) }), // prettier-ignore
    // Sums that leave the small whole numbers.
    () => ({
      body: [
        pick([`${a} = (${a} * 31 + ${x}) | 0;`, `${a} = ${a} * 3 + i;`, `${a} += ${x} * 0.5;`, `${a} += ${x} / 2;`, `${a} = Math.max(${a}, ${x});`, `${a} -= ${x};`, `${a} = (${a} + ${x}) >>> 0;`, `${a} += 1073741824;`, `${a} = ${a} * ${x};`, `${a} += ${x};`, `${a} = -${a} - ${x};`, `${a} %= ${x};`]), // prettier-ignore
      ],
    }),
    // Ways out of a turn and out of the loop.
    () => ({
      body: pick([
        [`try { if (i === ${when}) break; ${a} += 1; } finally { same++; }`],
        ...(canContinue
          ? [
              [`if (${pick(["i & 1", `${x} === 2`])}) continue;`, `${a} += ${x};`],
              [`try { if (i === ${when}) continue; ${a} += 1; } finally { same++; }`],
            ]
          : []),
        [`if (i === ${when}) return "left " + ${a};`, `${a} += 1;`],
        [`try { if (i === ${when}) throw new RangeError("turn"); ${a} += 1; } catch (error) { same += 10; }`],
        [`switch (i) { case 0: ${a} += 1; case 1: ${b} = ${otherKind()}; break; default: same++; }`],
        [`if (${pick([`${x} > 2`, "i > 1", `${a} > 5`])}) break;`, `${a} += ${x};`],
      ]),
    }),
    // A helper takes the element, behind a test of the place or without one.
    () =>
      walked.isIndexed &&
      walked.holds !== "records" && {
        outside: [
          `function take${n}(held${typed(walked.type)}, at${number})${any} { ${chance(70) ? "let work = 0; for (let j = 0; j < 2; j++) work = (work + j) | 0;" : ""} return ${pick(["at >= 0 && at < held.length", "at >= 0 && at < held.length", "at < held.length", "at >= 0", "true"])} ? ${pick(["held[at]", "held[at]", "held[at]", "held.at(at)", ...(walked.type === "string" ? ["held.charAt(at)", "held.codePointAt(at)", "held.slice(at, at + 1)"] : [])])} : undefined; }`,
        ],
        body: [
          pick([
            `${a} += take${n}(c, i);`,
            `${a} += take${n}(c, i);`,
            `${t} += take${n}(c, i);`,
            `${t} += take${n}(c, ${beside});`,
            `${b} = take${n}(c, i);`,
          ]),
        ],
      },
    // A name comes to an object, or leaves it, while the loop reads it.
    () => ({
      front: [`const thing${any} = { size: 1 };`],
      body: [
        pick([`if (thing.late !== undefined) same++;`, `same += thing.size;`, `if ("late" in thing) same++;`]),
        `if (i === ${when}) ${pick(["thing.late = i;", "thing.late = i;", "delete thing.size;", 'thing.size = "x";', "Object.freeze(thing);"])}`,
      ],
    }),
  ];
  const drawn: Motif[] = [];
  while (drawn.length < (chance(25) ? 2 : 1)) {
    const motif = pick(motifs)();
    // Two motifs that declare one name in front of the loop cannot stand together.
    const declared = (each: Motif) =>
      (each.front ?? []).flatMap(line => /^(?:let|const|var) (\w+)/.exec(line)?.[1] ?? []);
    if (motif && !drawn.some(other => declared(other).some(name => declared(motif).includes(name)))) drawn.push(motif);
  }
  const pause =
    shape === "async"
      ? pick(["await null;", "await null;", "await hook(i);"])
      : shape === "generator"
        ? pick(["yield i;", `yield ${a};`])
        : "";
  const body = [...new Set(drawn.flatMap(motif => motif.body))];
  // One statement gets a small loop of its own inside the turn.
  if (chance(25)) {
    const at = Math.floor(random() * body.length);
    if (!/\b(?:break|continue|return|const|yield|await)\b/.test(body[at]))
      body[at] = `for (let j = 0; j < ${pick(["2", "3", "to", "to"])}; j++) { ${body[at]} }`;
  }
  if (pause && chance(35)) body.splice(Math.floor(random() * (body.length + 1)), 0, pause);
  // A list that grows ahead of the loop which walks it to its end would never end.
  if (
    body.some(line => /c\[i \+ [^\]]*\] = |c\.(?:push|unshift|add|set)\(/.test(line)) &&
    (form === "of" || bound.includes("c.length"))
  )
    body.push("if (i > 12) break;");

  // Where what is walked comes from: a parameter, a variable of the function, or the head of the loop itself. What is made and walked in one place is known through and through.
  const inPlace = (walked.again ?? "").replace(/\bround\b/g, "0");
  const namesIt = body.some(line => /(?<![\w$.])c\b/.test(line));
  const drawnOrigin = inPlace ? pick(["parameter", "parameter", "parameter", "local", "head", "head"]) : "parameter";
  const origin = drawnOrigin === "head" && (form !== "of" || namesIt || isNested) ? "local" : drawnOrigin;
  const usesElement = body.some(line => /(?<![\w$.])x\b/.test(line));
  const element = usesElement ? [`  const x${walked.holds === "anything" ? any : ""} = c[i];`] : [];
  const lines = body.map(line => "  " + line);
  const cast = isTypeScript && walked.holds === "anything" ? " as any" : "";
  const inner =
    form === "of"
      ? [
          `let i = -1;`,
          `for (${pick(["const", "const", "let"])} x of ${origin === "head" ? inPlace : "c"}${cast}) {`,
          `  i++;`,
          ...lines,
          `}`,
        ]
      : form === "for"
        ? [`for (let i = from; ${bound}; ${turn}) {`, ...element, ...lines, `}`]
        : form === "down"
          ? [`for (let i = to - 1; i >= from; i--) {`, ...element, ...lines, `}`]
          : form === "while"
            ? [`let i = from;`, `while (i < to) {`, ...element, ...lines, `  i = (i + 1) | 0;`, `}`]
            : [`let i = from;`, `do {`, ...element, ...lines, `  i = (i + 1) | 0;`, `} while (i < to);`];
  const loop = isNested
    ? [
        `for (let r = 0; r < ${pick(["3", "rows", "rows", "6"])}; r++) {`,
        ...pick([
          [`  ${ticks}++;`],
          [`  ${ticks}++;`, `  ${b} = r;`],
          [`  ${ticks}++;`, `  ${b} = r;`],
          [`  ${ticks}++;`, `  ${b} = mark;`],
          [`  ${ticks}++;`, `  ${a} += r;`],
        ]),
        ...(walked.leaves
          ? [`  c = ${inPlace};`]
          : form === "of" && !walked.isIndexed && walked.again
            ? [`  c = again();`]
            : []),
        ...drawn.flatMap(motif => motif.enters ?? []).map(line => "  " + line),
        ...inner.map(line => "  " + line),
        ...drawn.flatMap(motif => motif.ends ?? []).map(line => "  " + line),
        ...(walked.leaves ? [`  same += ${walked.leaves};`] : []),
        `}`,
      ]
    : inner;

  // A function holds what its loop names and nothing else: a closure over the parameter that is walked, made for no one, would move the parameter out of its register.
  const front = [...new Set(drawn.flatMap(motif => motif.front ?? []))];
  const behind = [
    ...drawn.flatMap(motif => motif.behind ?? []),
    ...(pause && chance(60) ? [pause.replace(/\bi\b/g, "0")] : []),
    ...(pause && chance(30) ? ["Bun.gc(true);"] : []),
  ];
  const text = [...front, ...loop, ...behind].join("\n");
  const names = (name: string) => new RegExp(`(?<![\\w$.])${name.replace(/[.$]/g, "\\$&")}(?![\\w$])`).test(text);
  const told = [
    ...[a, b].flatMap(each => (names(each) ? [`typeof ${each}`, `String(${each})`] : [])),
    ...[t, "same", "held", ticks].filter(names),
    ...(names("copy") ? ["copy.length", "copy.slice(-4)"] : []),
    ...(names("mark") ? ["String(mark)"] : []),
    ...(names("thing") ? ["Object.keys(thing).join()"] : []),
  ];
  const parameters = pick([
    ["c", "start", "end", "stride", "mark", "hook"],
    ["c", "start", "end", "stride", "mark", "hook"],
    ["c", "start", "end", "stride", "mark", "hook"],
    ["start", "c", "end", "stride", "mark", "hook"],
    ["start", "end", "stride", "mark", "hook", "c"],
  ]).filter(name =>
    name === "c"
      ? origin === "parameter"
      : names(name) ||
        (name === "start" && names("from")) ||
        (name === "end" && names("to")) ||
        (name === "stride" && names("step")),
  );
  const types: Record<string, string> = {
    c: chance(70) ? walked.type : "any",
    start: "number",
    end: "number",
    stride: "number",
    mark: "any",
    hook: "(value: any) => any",
  };
  const head = parameters.map(name => name + typed(types[name])).join(", ");
  const bounds = pick([
    ["start | 0", "end | 0", "(stride | 0) || 1"],
    ["start | 0", "end | 0", "(stride | 0) || 1"],
    ["start", "end", "stride || 1"],
  ]);
  // The text is a text all its life and the count of turns a number: to call them `any` would hide that from whoever listens to the types.
  const declare = (name: string) =>
    `${pick(["let", "let", "let", "var"])} ${ref(name)}${name === "t" || name === "ticks" ? "" : any} = ${born[name]};`;
  // What stands round the loop and what follows it: nothing, or a `try` whose `finally` or `catch` reads what the loop has left.
  const leaves = `heard${n} += [${told.join(", ")}].join("|").length;`;
  const round = pick<[string[], string[]]>([
    [[], []],
    [[], []],
    [[], []],
    [[], []],
    [[], []],
    [[`try {`], [`} finally {`, `  ${leaves}`, `}`]],
    [[`try {`], [`} finally {`, `  ${leaves}`, `}`]],
    [[`try {`], [`} catch (error) {`, `  ${leaves}`, `}`]],
    [[`try {`], [`} catch (error) {`, `  ${leaves}`, `} finally {`, `  heard${n}++;`, `}`]],
  ]);
  const living = (where: Home) => Object.keys(homes).filter(name => homes[name] === where && names(ref(name)));
  const whole = [
    ...living("local").map(declare),
    ...(origin === "local"
      ? [`${isNested ? "let" : "const"} c${walked.holds === "anything" ? any : ""} = ${inPlace};`]
      : []),
    ...["from", "to", "step"].flatMap((each, at) => (names(each) ? [`const ${each} = ${bounds[at]};`] : [])),
    ...(names("rows") ? [`const rows = 3;`] : []),
    ...(names("pair") ? [`const pair = [1, 2];`] : []),
    ...(names("kept") ? [`const kept${typed("(() => void)[]")} = [];`] : []),
    ...(names("again") ? [`const again = ()${any} => ${walked.again};`] : []),
    ...["same", "held"].flatMap(each => (names(each) ? [`let ${each} = ${each === "same" ? -1 : 0};`] : [])),
    ...(names("copy") ? [`let copy = "";`] : []),
    ...(names("last") ? [`let last${any} = null;`] : []),
    ...front,
    ...round[0],
    ...[...loop, ...behind].map(line => (round[0].length ? "  " + line : line)),
    ...round[1],
    `${shape === "generator" ? "yield" : "return"} [${told.join(", ")}].join("|");`,
  ].map(line => "  " + line);
  const name = `run${n}`;
  const returns = typed(shape === "async" ? "Promise<string>" : shape === "generator" ? "Generator<any>" : "string");
  const written =
    shape === "arrow"
      ? [`const ${name} = (${head})${returns} => {`, ...whole, `};`]
      : shape === "method"
        ? [
            `class Runner${n} {`,
            `  run(${head})${returns} {`,
            ...whole.map(line => "  " + line),
            `  }`,
            `}`,
            `const runner${n} = new Runner${n}();`,
          ]
        : [
            `${shape === "async" ? "async function" : shape === "generator" ? "function*" : "function"} ${name}(${head})${returns} {`,
            ...whole,
            `}`,
          ];
  const held = living("held");
  const made = held.length
    ? [
        `function make${n}() {`,
        ...held.map(each => "  " + declare(each)),
        ...written.map(line => "  " + line),
        `  return ${name};`,
        `}`,
        `const ${name} = make${n}();`,
      ]
    : written;
  const fields = living("field");

  const hook = pick([
    `(value${any}) => value`,
    `(value${any}) => value`,
    `(value${any}) => value + 1`,
    `(value${any}) => { heard${n}++; return value; }`,
    `(value${any}) => { heard${n}++; return heard${n} > 2 ? ${otherKind()} : value; }`,
    ...(homes.a === "outer" && names(a)
      ? [`(value${any}) => { ${a} += 1; return value; }`, `(value${any}) => { ${a} += 1; return value; }`]
      : []),
    ...(homes.b === "outer" && names(b)
      ? [
          `(value${any}) => { ${b} = ${otherKind()}; return value; }`,
          `(value${any}) => { ${b} = ${otherKind()}; return value; }`,
          `(value${any}) => { ${b} = ${otherKind()}; return value; }`,
        ]
      : []),
  ]);
  const mark = unseen(otherKind());
  // Of a written bound the compiler knows that it is a small whole number. Of one out of a parser it knows that it is a number, if that.
  const bounded = pick<(value: number | string) => string>([
    String,
    String,
    value => `Number(JSON.parse("${value}"))`,
    value => `JSON.parse("${value}")`,
  ]);
  const call = ([from, to, step]: (number | string)[]) => {
    const given: Record<string, string> = {
      c: "made",
      start: bounded(from),
      end: bounded(to),
      stride: String(step),
      mark,
      hook: `hook${n}`,
    };
    const said = `${shape === "method" ? `runner${n}.run` : name}(${parameters.map(each => given[each]).join(", ")})`;
    return shape === "async" ? `await ${said}` : shape === "generator" ? `[...${said}].join("~")` : said;
  };
  return [
    `let heard${n} = 0;`,
    ...(names(`echo${n}`) ? [`function echo${n}(value${typed("string")})${typed("string")} { return value; }`] : []),
    ...(walked.setup ?? []),
    ...new Set(drawn.flatMap(motif => motif.outside ?? [])),
    ...living("outer").map(declare),
    ...(fields.length
      ? [`const box${n}${any} = { ${fields.map(field => `${field}: ${born[field]}`).join(", ")} };`]
      : []),
    ...made,
    ...(names("hook") ? [`const hook${n} = ${pick([hook, hook, `[${hook}][JSON.parse("0")]`])};`] : []),
    `for (let round = 0; round < ${pick([1, 1, 1, 2, 2, 40])}; round++) {`,
    ...[
      [0, 3, 1],
      [0, 4, 1],
      [pick([-2, -2, -1, -1, 0, 1]), 2, 1],
      pick([
        [0, 9, 2],
        [0, 9, 1],
        [2, 2, 1],
        [0, 3.5, 1],
      ]),
    ].flatMap(each => [
      // prettier-ignore
      `  {`,
      ...walked.fresh.map(line => "    " + line),
      `    let said${any};`,
      `    try { said = ${call(each)}; } catch (error) { said = (error${isTypeScript ? " as any" : ""}).name; }`,
      `    if (round < 2) printValue("loop ${n}", said, ${walked.show}, heard${n});`,
      `  }`,
    ]),
    `}`,
  ];
}
