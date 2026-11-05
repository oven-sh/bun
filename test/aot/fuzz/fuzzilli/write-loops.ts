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
};
type Motif = { front?: string[]; body: string[]; behind?: string[] };

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
            `function* parts${n}(count${number})${typed("Generator<any>")} { ${pick([`yield ${outside}; for (let i = 0; i < count; i++) yield ${yielded};`, `yield ${outside}; for (let i = 0; i < count; i++) yield ${yielded};`, `yield ${outside}; for (let i = 0; i < count; i++) yield ${yielded};`, `for (let i = 0; i < count; i++) yield ${yielded};`, `for (let i = 0; i < count; i++) yield ${yielded}; yield ${outside};`, `for (let i = 0; i < count; i++) { if (i === 2) yield ${outside}; yield ${yielded}; }`])} }`,
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
  const isNested = chance(30);
  const walksByIndex = walked.isIndexed && chance(65);
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
    if (motif) drawn.push(motif);
  }
  const pause =
    shape === "async"
      ? pick(["await null;", "await null;", "await hook(i);"])
      : shape === "generator"
        ? pick(["yield i;", `yield ${a};`])
        : "";
  const body = [...new Set(drawn.flatMap(motif => motif.body))];
  if (pause && chance(35)) body.splice(Math.floor(random() * (body.length + 1)), 0, pause);
  // A list that grows ahead of the loop which walks it to its end would never end.
  if (
    body.some(line => /c\[i \+ [^\]]*\] = |c\.(?:push|unshift|add|set)\(/.test(line)) &&
    (form === "of" || bound.includes("c.length"))
  )
    body.push("if (i > 12) break;");

  const usesElement = body.some(line => /(?<![\w$.])x\b/.test(line));
  const element = usesElement ? [`  const x${walked.holds === "anything" ? any : ""} = c[i];`] : [];
  const lines = body.map(line => "  " + line);
  const cast = isTypeScript && walked.holds === "anything" ? " as any" : "";
  const inner =
    form === "of"
      ? [`let i = -1;`, `for (${pick(["const", "const", "let"])} x of c${cast}) {`, `  i++;`, ...lines, `}`]
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
        ...(form === "of" && !walked.isIndexed && walked.again ? [`  c = again();`] : []),
        ...inner.map(line => "  " + line),
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
  ]).filter(
    name =>
      name === "c" ||
      names(name) ||
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
  const declare = (name: string) => `${pick(["let", "let", "let", "var"])} ${ref(name)}${any} = ${born[name]};`;
  const living = (where: Home) => Object.keys(homes).filter(name => homes[name] === where && names(ref(name)));
  const whole = [
    ...living("local").map(declare),
    ...["from", "to", "step"].flatMap((each, at) => (names(each) ? [`const ${each} = ${bounds[at]};`] : [])),
    ...(names("rows") ? [`const rows = 3;`] : []),
    ...(names("pair") ? [`const pair = [1, 2];`] : []),
    ...(names("kept") ? [`const kept${typed("(() => void)[]")} = [];`] : []),
    ...(names("again") ? [`const again = ()${any} => ${walked.again};`] : []),
    ...["same", "held"].flatMap(each => (names(each) ? [`let ${each} = ${each === "same" ? -1 : 0};`] : [])),
    ...(names("copy") ? [`let copy = "";`] : []),
    ...(names("last") ? [`let last${any} = null;`] : []),
    ...front,
    ...loop,
    ...behind,
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
  const call = ([from, to, step]: (number | string)[]) => {
    const given: Record<string, string> = {
      c: "made",
      start: String(from),
      end: String(to),
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
      [pick([-1, -1, 0, 1]), 2, 1],
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
