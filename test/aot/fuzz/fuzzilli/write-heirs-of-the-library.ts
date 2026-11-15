// Heirs of the library's classes, as packages write them: in the old way (`Base.call(this)` and `util.inherits`), in the new way (`class .. extends`), and in the ways between.
// The heir overrides some of what it inherits, the library's own code calls those overrides, and records of the program travel through the library's hands to the program's listeners, which act on them.
//
// The scene is put together from tables that do not know of each other: the base, how the heir hangs below it, how the base's constructor is run, what the heir overrides, what travels,
// what the listener does to it, and what the program reads behind that.

export function writeSceneOfHeirsOfTheLibrary(random: () => number, n: number, isTypeScript: boolean): string[] {
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const chance = (percent: number) => random() * 100 < percent;
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const any = typed("any");
  const loose = (text: string) => (isTypeScript ? `(${text} as any)` : text);
  const self = isTypeScript ? "this: any" : "";
  const selfAnd = isTypeScript ? "this: any, " : "";

  const [base, from, options] = pick<[string, string, string]>([
    ["EventEmitter", "node:events", ""],
    ["EventEmitter", "node:events", ""],
    ["EventEmitter", "node:events", ""],
    ["Readable", "node:stream", "{ objectMode: true, read() {} }"],
    ["Writable", "node:stream", "{ objectMode: true, write(chunk, encoding, done) { done(); } }"],
    ["Transform", "node:stream", "{ objectMode: true, transform(chunk, encoding, done) { done(null, chunk); } }"],
    ["PassThrough", "node:stream", "{ objectMode: true }"],
  ]);
  const Base = `${base}${n}`;
  const Heir = `Heir${n}`;
  const given =
    isTypeScript && options
      ? loose(options.replace("(chunk, encoding, done)", "(chunk: any, encoding: any, done: any)"))
      : options;

  // What the heir overrides or adds. The library's own code calls `emit`, `on` and the hooks.
  const overrides = pick<[string, string][]>([
    [],
    [],
    [
      [
        "emit",
        `function (${selfAnd}type${any}, ...rest${typed("any[]")}) { calls${n}++; return ${Base}.prototype.emit.call(this, type, ...rest); }`,
      ],
    ],
    [
      [
        "emit",
        `function (${selfAnd}type${any}, value${any}) { calls${n}++; return ${Base}.prototype.emit.apply(this, arguments${isTypeScript ? " as any" : ""}); }`,
      ],
    ],
    [
      [
        "on",
        `function (${selfAnd}type${any}, listener${any}) { calls${n}++; return ${Base}.prototype.on.call(this, type, listener); }`,
      ],
    ],
    [
      [
        "addListener",
        `function (${selfAnd}type${any}, listener${any}) { calls${n} += 10; return ${Base}.prototype.on.call(this, type, listener); }`,
      ],
    ],
    [
      [
        "removeListener",
        `function (${selfAnd}type${any}, listener${any}) { calls${n}++; listener.seen = true; return ${Base}.prototype.removeListener.call(this, type, listener); }`,
      ],
    ],
    [["listenerCount", `function (${self}) { calls${n}++; return -1; }`]],
    [["tell", `function (${selfAnd}value${any}) { calls${n}++; return this.emit("made-up", value); }`]],
    [
      ["tell", `function (${selfAnd}value${any}) { calls${n}++; return this.emit("made-up", value); }`],
      [
        "emit",
        `function (${selfAnd}type${any}, value${any}) { calls${n} += 100; return ${Base}.prototype.emit.call(this, type, value); }`,
      ],
    ],
  ]);
  const way = pick(["class", "class", "inherits", "inherits", "inherits", "create", "set prototype", "proto", "mixin"]);
  const runs = pick([
    `${Base}.call(this${given ? `, ${given}` : ""});`,
    `${Base}.call(this${given ? `, ${given}` : ""});`,
    `${Base}.apply(this, [${given}]${isTypeScript ? " as any" : ""});`,
    ...(options ? [] : [``]),
  ]);
  const own = pick([`this.count = 0;`, `this.count = 0;`, `this.count = 0; this.label = "heir";`, ``]);
  const written =
    way === "class"
      ? [
          `class ${Heir} extends ${Base} { ${isTypeScript ? "[key: string]: any; " : ""}constructor() { super(${given}); ${own} } ${overrides
            .map(
              ([name, text]) =>
                `${name}${text
                  .replace(/^function /, "")
                  .replace(new RegExp(`${Base}\\.prototype\\.(\\w+)\\.call\\(this, `, "g"), "super.$1(")
                  .replace(
                    new RegExp(`${Base}\\.prototype\\.(\\w+)\\.apply\\(this, `, "g"),
                    `${Base}.prototype.$1.apply(this, `,
                  )}`,
            )
            .join(" ")} }`,
        ]
      : [
          `function ${Heir}(${self}) { ${runs} ${own} }`,
          way === "inherits"
            ? `util${n}.inherits(${Heir}, ${Base});`
            : way === "create"
              ? `${Heir}.prototype = Object.create(${Base}.prototype, { constructor: { value: ${Heir}, writable: true, configurable: true } });`
              : way === "set prototype"
                ? `Object.setPrototypeOf(${Heir}.prototype, ${Base}.prototype);`
                : way === "proto"
                  ? `${loose(`${Heir}.prototype`)}.__proto__ = ${Base}.prototype;`
                  : `for (let at${any} = ${Base}.prototype; at && at !== Object.prototype; at = Object.getPrototypeOf(at)) for (const name of Object.getOwnPropertyNames(at)) if (!Object.hasOwn(${Heir}.prototype, name)) Object.defineProperty(${Heir}.prototype, name, Object.getOwnPropertyDescriptor(at, name)${isTypeScript ? "!" : ""});`,
          ...overrides.map(([name, text]) => `${loose(`${Heir}.prototype`)}.${name} = ${text};`),
        ];
  const make = way === "class" ? `new ${Heir}()` : `new ${loose(Heir)}()`;

  // What travels, and what the listener does to it.
  const [fresh, reads, deeds] = pick<[string, string[], string[]]>([
    [
      `{ n: seed, m: 1 }`,
      [`record.n`, `record.n`, `Object.keys(record).length`, `typeof record.n`],
      [
        `record.n = record.n + 10;`,
        `record.n = record.n + 10;`,
        `record.n = "text";`,
        `record.extra = 1;`,
        `delete record.m;`,
        `record.n = record.n + 0.5;`,
        `Object.freeze(record);`,
        `sum${n} += record.n;`,
      ],
    ],
    [
      `[seed, 2, 3]`,
      [`record[0]`, `record.length`, `typeof record[0]`],
      [
        `record.push(7);`,
        `record[0] = record[0] + 10;`,
        `record[0] = "text";`,
        `record.length = 0;`,
        `record[0] = 0.5;`,
        `sum${n} += record[0];`,
      ],
    ],
    [
      `seed`,
      [`record`],
      [`sum${n} += record;`, `sum${n} += record * 2;`, `sum${n} = sum${n} + String(record).length;`],
    ],
    [
      `new Pair${n}(seed)`,
      [`record.n`, `record.twice()`],
      [`record.n = record.n + 10;`, `record.n = "text";`, `record.twice = () => -1;`, `sum${n} += record.twice();`],
    ],
  ]);
  const deed = pick(deeds);
  const read = pick(reads);
  const isStream = from === "node:stream";
  const event = isStream && base !== "Writable" && chance(60) ? "data" : "made-up";
  const listens = pick([
    `heir${n}.on(${JSON.stringify(event)}, (record${any}) => { heard${n}++; ${deed} });`,
    `heir${n}.on(${JSON.stringify(event)}, (record${any}) => { heard${n}++; ${deed} });`,
    `heir${n}.on(${JSON.stringify(event)}, function (${selfAnd}record${any}) { heard${n}++; this.count = (this.count ?? 0) + 1; ${deed} });`,
    `heir${n}.addListener(${JSON.stringify(event)}, (record${any}) => { heard${n}++; ${deed} });`,
    ...(event === "made-up"
      ? [
          `heir${n}.once("made-up", (record${any}) => { heard${n}++; ${deed} });`,
          `heir${n}.prependListener("made-up", (record${any}) => { heard${n}++; ${deed} });`,
        ]
      : []),
  ]);
  const sends =
    event === "data"
      ? base === "Readable"
        ? `heir${n}.push(record);`
        : `heir${n}.write(record);`
      : pick([
          `heir${n}.emit("made-up", record);`,
          `heir${n}.emit("made-up", record);`,
          ...(overrides.some(([name]) => name === "tell") ? [`heir${n}.tell(record);`, `heir${n}.tell(record);`] : []),
          `Reflect.apply(heir${n}.emit, heir${n}, ["made-up", record]);`,
        ]);
  const waits = event === "data";
  const asks = `${waits ? "async " : ""}function ask${n}(seed${typed("number")})${waits ? typed("Promise<any>") : any} { const record${any} = ${fresh}; const before = ${read}; ${sends} ${waits ? "await new Promise(resolve => setImmediate(resolve));" : ""} return String(before) + ">" + String(${read}); }`;
  const turns = pick([4, 4, 40, waits ? 8 : 300]);
  return [
    `import { ${base} as ${Base} } from ${JSON.stringify(from)};`,
    ...(way === "inherits" ? [`import util${n} from "node:util";`] : []),
    `let calls${n} = 0, heard${n} = 0;`,
    `let sum${n}${any} = 0;`,
    ...(fresh.startsWith("new Pair")
      ? [
          `class Pair${n} { n${any}; ${isTypeScript ? "[key: string]: any; " : ""}constructor(n${any}) { this.n = n; } twice()${any} { return this.n * 2; } }`,
        ]
      : []),
    ...written,
    `const heir${n}${any} = ${make};`,
    listens,
    asks,
    `{ const given${typed("number[]")} = JSON.parse("[1,2,3,2]"); let said = ""; for (let turn = 0; turn < ${turns}; turn++) { let answer${any}; try { answer = ${waits ? "await " : ""}ask${n}(given[turn & 3]); } catch (error) { answer = ${loose("error")}.name; } if (turn < 4) said += answer + ";"; } printValue("an heir of the library ${n}", said, calls${n}, heard${n}, String(sum${n}), String(heir${n}.count), heir${n} instanceof ${Base}, typeof heir${n}.listenerCount("made-up")); }`,
    ...(chance(30)
      ? [
          `printValue("an heir of the library ${n}", Object.keys(heir${n}).filter(key => !key.startsWith("_")).sort().join(), heir${n}.constructor === ${Heir});`,
        ]
      : []),
  ];
}
