// Some built-in objects add a member to their own properties when it is first read, called or asked for, and the rest when the object is first
// copied. From then on their keys stand in that order. A program takes one such object. It uses 1 to 5 of its members: reads them, calls them as
// a program would, tests them, takes them by a pattern, asks for them with `in`, Object.hasOwn or a descriptor. Between the uses and behind them it
// lists the keys: Object.keys, Reflect.ownKeys, Object.getOwnPropertyNames, for-in, a spread, a rest pattern, Object.assign, Object.entries,
// Object.values, JSON.stringify, the descriptors. What is listed is the object by its name, or a value that could also be something else:
// a variable with two stores, an element of a list, a member of a table, a parameter of a function with two callers, what a function returns.
// The steps stand at the top of the module, in a function, or in a function that a loop calls many times.
import type { Random } from "./random";

type Holder = {
  /** How a program names the object. */
  path: string;
  /** Goes in front of the steps. */
  setup?: string;
  /** A member that the object adds when it is first read, and how a program uses it. `null`: it is only read. */
  uses: Record<string, string | null>;
  /** Members that the object has from the start. */
  others?: string[];
};

const view = "new DataView(new ArrayBuffer(16))";
const date = "new Date(86400000)";

const intlClass = (name: string, instance: string, uses: Record<string, string | null>): Holder[] => [
  {
    path: `Intl.${name}`,
    uses: { supportedLocalesOf: `Intl.${name}.supportedLocalesOf("en")` },
    others: ["prototype", "name"],
  },
  {
    path: `Intl.${name}.prototype`,
    uses: Object.fromEntries(
      Object.entries(uses).map(([member, call]) => [member, call === null ? null : `${instance}.${call}`]),
    ),
    others: ["constructor"],
  },
];

export const holders: Holder[] = [
  {
    path: "Reflect",
    uses: {
      apply: "Reflect.apply(Math.abs, undefined, [-1])",
      construct: "Reflect.construct(Object, [])",
      defineProperty: 'Reflect.defineProperty({}, "a", { value: 1 })',
      deleteProperty: 'Reflect.deleteProperty({ a: 1 }, "a")',
      get: 'Reflect.get({ a: 1 }, "a")',
      getOwnPropertyDescriptor: 'Reflect.getOwnPropertyDescriptor({ a: 1 }, "a")',
      getPrototypeOf: "Reflect.getPrototypeOf({})",
      has: 'Reflect.has({ a: 1 }, "a")',
      isExtensible: "Reflect.isExtensible({})",
      ownKeys: "Reflect.ownKeys({ a: 1 })",
      preventExtensions: "Reflect.preventExtensions({})",
      set: 'Reflect.set({}, "a", 1)',
      setPrototypeOf: "Reflect.setPrototypeOf({}, null)",
    },
  },
  {
    path: "Object",
    uses: {
      assign: "Object.assign({}, { a: 1 })",
      create: "Object.create(null)",
      defineProperties: "Object.defineProperties({}, { a: { value: 1 } })",
      defineProperty: 'Object.defineProperty({}, "a", { value: 1 })',
      entries: "Object.entries({ a: 1 })",
      freeze: "Object.freeze({})",
      fromEntries: 'Object.fromEntries([["a", 1]])',
      getOwnPropertyDescriptor: 'Object.getOwnPropertyDescriptor({ a: 1 }, "a")',
      getOwnPropertyDescriptors: "Object.getOwnPropertyDescriptors({ a: 1 })",
      getOwnPropertyNames: "Object.getOwnPropertyNames({ a: 1 })",
      getOwnPropertySymbols: "Object.getOwnPropertySymbols({})",
      getPrototypeOf: "Object.getPrototypeOf({})",
      is: "Object.is(1, 1)",
      isExtensible: "Object.isExtensible({})",
      isFrozen: "Object.isFrozen({})",
      isSealed: "Object.isSealed({})",
      keys: "Object.keys({ a: 1 })",
      preventExtensions: "Object.preventExtensions({})",
      seal: "Object.seal({})",
      setPrototypeOf: "Object.setPrototypeOf({}, null)",
      values: "Object.values({ a: 1 })",
    },
    others: ["hasOwn", "groupBy", "prototype", "name", "length"],
  },
  {
    path: "JSON",
    uses: { parse: 'JSON.parse("[1]")', stringify: "JSON.stringify([1])" },
    others: ["rawJSON", "isRawJSON"],
  },
  {
    path: "Date",
    uses: { UTC: "Date.UTC(2000, 1)", now: "Date.now()", parse: 'Date.parse("2000-01-01")' },
    others: ["prototype", "name"],
  },
  {
    path: "Date.prototype",
    uses: {
      getDate: `${date}.getDate()`,
      getDay: `${date}.getDay()`,
      getFullYear: `${date}.getFullYear()`,
      getHours: `${date}.getHours()`,
      getMilliseconds: `${date}.getMilliseconds()`,
      getMinutes: `${date}.getMinutes()`,
      getMonth: `${date}.getMonth()`,
      getSeconds: `${date}.getSeconds()`,
      getTime: `${date}.getTime()`,
      getTimezoneOffset: `${date}.getTimezoneOffset()`,
      getUTCDate: `${date}.getUTCDate()`,
      getUTCDay: `${date}.getUTCDay()`,
      getUTCFullYear: `${date}.getUTCFullYear()`,
      getUTCHours: `${date}.getUTCHours()`,
      getUTCMonth: `${date}.getUTCMonth()`,
      setDate: `${date}.setDate(2)`,
      setFullYear: `${date}.setFullYear(2001)`,
      setHours: `${date}.setHours(1)`,
      setTime: `${date}.setTime(5)`,
      setUTCHours: `${date}.setUTCHours(1)`,
      toDateString: `${date}.toDateString()`,
      toISOString: `${date}.toISOString()`,
      toJSON: `${date}.toJSON()`,
      toLocaleDateString: `${date}.toLocaleDateString("en")`,
      toString: `${date}.toString()`,
      toTimeString: `${date}.toTimeString()`,
      valueOf: `${date}.valueOf()`,
    },
    others: ["constructor", "toUTCString", "toGMTString"],
  },
  {
    path: "Promise",
    uses: {
      all: "Promise.all([])",
      allSettled: "Promise.allSettled([])",
      any: "Promise.any([1])",
      race: "Promise.race([1])",
      reject: "Promise.reject(1).catch(() => {})",
      resolve: "Promise.resolve(1)",
      withResolvers: "Promise.withResolvers()",
    },
    others: ["try", "prototype", "name"],
  },
  {
    path: "Promise.prototype",
    uses: { finally: "Promise.resolve(1).finally(() => {})" },
    others: ["then", "catch", "constructor"],
  },
  {
    path: "String",
    uses: { fromCharCode: "String.fromCharCode(65)", fromCodePoint: "String.fromCodePoint(65)", raw: "String.raw`a`" },
    others: ["prototype", "name"],
  },
  {
    path: "String.prototype",
    uses: {
      anchor: '"a".anchor("b")',
      big: '"a".big()',
      blink: '"a".blink()',
      bold: '"a".bold()',
      fixed: '"a".fixed()',
      fontcolor: '"a".fontcolor("b")',
      fontsize: '"a".fontsize(1)',
      italics: '"a".italics()',
      link: '"a".link("b")',
      small: '"a".small()',
      strike: '"a".strike()',
      sub: '"a".sub()',
      sup: '"a".sup()',
    },
    others: ["at", "slice", "trim", "constructor"],
  },
  {
    path: "Symbol",
    uses: { for: 'Symbol.for("a")', keyFor: "Symbol.keyFor(Symbol.iterator)" },
    others: ["iterator", "hasInstance", "prototype"],
  },
  {
    path: "Symbol.prototype",
    uses: { toString: "Symbol.iterator.toString()", valueOf: "Symbol.iterator.valueOf()" },
    others: ["constructor"],
  },
  {
    path: "Number",
    uses: { isFinite: "Number.isFinite(1)", isNaN: "Number.isNaN(1)", isSafeInteger: "Number.isSafeInteger(1)" },
    others: ["isInteger", "parseFloat", "EPSILON", "MAX_SAFE_INTEGER", "prototype"],
  },
  {
    path: "Number.prototype",
    uses: {
      toExponential: "(1.5).toExponential(1)",
      toFixed: "(1.5).toFixed(1)",
      toLocaleString: '(1.5).toLocaleString("en")',
      toPrecision: "(1.5).toPrecision(2)",
      valueOf: "(1.5).valueOf()",
    },
    others: ["toString", "constructor"],
  },
  {
    path: "BigInt",
    uses: { asIntN: "BigInt.asIntN(8, 1n)", asUintN: "BigInt.asUintN(8, 1n)" },
    others: ["prototype", "name"],
  },
  {
    path: "BigInt.prototype",
    uses: { toLocaleString: '(1n).toLocaleString("en")', toString: "(1n).toString()", valueOf: "(1n).valueOf()" },
    others: ["constructor"],
  },
  {
    path: "Boolean.prototype",
    uses: { toString: "true.toString()", valueOf: "true.valueOf()" },
    others: ["constructor"],
  },
  {
    path: "Error.prototype",
    uses: { toString: 'new Error("a").toString()' },
    others: ["name", "message", "constructor"],
  },
  { path: "Array", uses: { from: "Array.from([1])" }, others: ["of", "isArray", "fromAsync", "prototype"] },
  {
    path: "DataView.prototype",
    uses: {
      getBigInt64: `${view}.getBigInt64(0)`,
      getBigUint64: `${view}.getBigUint64(0)`,
      getFloat32: `${view}.getFloat32(0)`,
      getFloat64: `${view}.getFloat64(0)`,
      getInt16: `${view}.getInt16(0)`,
      getInt32: `${view}.getInt32(0)`,
      getInt8: `${view}.getInt8(0)`,
      getUint16: `${view}.getUint16(0)`,
      getUint32: `${view}.getUint32(0)`,
      getUint8: `${view}.getUint8(0)`,
      setBigInt64: `${view}.setBigInt64(0, 1n)`,
      setFloat32: `${view}.setFloat32(0, 1)`,
      setFloat64: `${view}.setFloat64(0, 1)`,
      setInt16: `${view}.setInt16(0, 1)`,
      setInt32: `${view}.setInt32(0, 1)`,
      setInt8: `${view}.setInt8(0, 1)`,
      setUint16: `${view}.setUint16(0, 1)`,
      setUint32: `${view}.setUint32(0, 1)`,
      setUint8: `${view}.setUint8(0, 1)`,
    },
    others: ["constructor"],
  },
  {
    path: "generatorPrototype",
    setup:
      "function* counted() { yield 1; yield 2; }\nconst generatorPrototype = Object.getPrototypeOf(counted.prototype);",
    uses: { next: "counted().next()", return: "counted().return()", throw: "counted().throw(new RangeError())" },
    others: ["constructor"],
  },
  {
    path: "asyncGeneratorPrototype",
    setup:
      "async function* awaited() { yield 1; }\nconst asyncGeneratorPrototype = Object.getPrototypeOf(awaited.prototype);",
    uses: { return: "awaited().return()", throw: "awaited().throw(new RangeError()).catch(() => {})" },
    others: ["next", "constructor"],
  },
  {
    path: "helperPrototype",
    setup: "const helperPrototype = Object.getPrototypeOf([1].values().map(value => value));",
    uses: { next: "[1].values().map(value => value).next()", return: "[1].values().map(value => value).return?.()" },
  },
  {
    path: "Intl",
    uses: {
      Collator: 'new Intl.Collator("en")',
      DateTimeFormat: 'new Intl.DateTimeFormat("en")',
      DisplayNames: 'new Intl.DisplayNames("en", { type: "region" })',
      ListFormat: 'new Intl.ListFormat("en")',
      Locale: 'new Intl.Locale("en")',
      NumberFormat: 'new Intl.NumberFormat("en")',
      PluralRules: 'new Intl.PluralRules("en")',
      RelativeTimeFormat: 'new Intl.RelativeTimeFormat("en")',
      Segmenter: 'new Intl.Segmenter("en")',
      getCanonicalLocales: 'Intl.getCanonicalLocales("en")',
      supportedValuesOf: 'Intl.supportedValuesOf("unit")',
    },
  },
  ...intlClass("Collator", 'new Intl.Collator("en")', { resolvedOptions: "resolvedOptions()" }),
  ...intlClass("DateTimeFormat", 'new Intl.DateTimeFormat("en")', {
    formatRange: "formatRange(0, 1)",
    formatRangeToParts: "formatRangeToParts(0, 1)",
    formatToParts: "formatToParts(0)",
    resolvedOptions: "resolvedOptions()",
  }),
  ...intlClass("DisplayNames", 'new Intl.DisplayNames("en", { type: "region" })', {
    of: 'of("US")',
    resolvedOptions: "resolvedOptions()",
  }),
  ...intlClass("ListFormat", 'new Intl.ListFormat("en")', {
    format: 'format(["a"])',
    formatToParts: 'formatToParts(["a"])',
    resolvedOptions: "resolvedOptions()",
  }),
  ...intlClass("NumberFormat", 'new Intl.NumberFormat("en")', {
    formatRange: "formatRange(1, 2)",
    formatRangeToParts: "formatRangeToParts(1, 2)",
    formatToParts: "formatToParts(1)",
    resolvedOptions: "resolvedOptions()",
  }),
  ...intlClass("PluralRules", 'new Intl.PluralRules("en")', {
    resolvedOptions: "resolvedOptions()",
    select: "select(1)",
    selectRange: "selectRange(1, 2)",
  }),
  ...intlClass("RelativeTimeFormat", 'new Intl.RelativeTimeFormat("en")', {
    format: 'format(1, "day")',
    formatToParts: 'formatToParts(1, "day")',
    resolvedOptions: "resolvedOptions()",
  }),
  ...intlClass("Segmenter", 'new Intl.Segmenter("en")', {
    resolvedOptions: "resolvedOptions()",
    segment: 'segment("a")',
  }),
  {
    path: "Intl.Locale.prototype",
    uses: {
      maximize: 'new Intl.Locale("en").maximize()',
      minimize: 'new Intl.Locale("en").minimize()',
      toString: 'new Intl.Locale("en").toString()',
      getCalendars: null,
      getTimeZones: null,
    },
    others: ["constructor"],
  },
  {
    path: "WebAssembly",
    uses: {
      CompileError: "new WebAssembly.CompileError()",
      LinkError: "new WebAssembly.LinkError()",
      RuntimeError: "new WebAssembly.RuntimeError()",
      Memory: "new WebAssembly.Memory({ initial: 1 })",
      validate: "WebAssembly.validate(new Uint8Array(4))",
      Global: null,
      Instance: null,
      Module: null,
      Table: null,
      compile: null,
      instantiate: null,
    },
  },
  {
    path: "Buffer",
    uses: {
      alloc: "Buffer.alloc(1)",
      allocUnsafe: "Buffer.allocUnsafe(1)",
      allocUnsafeSlow: "Buffer.allocUnsafeSlow(1)",
      byteLength: 'Buffer.byteLength("a")',
      compare: "Buffer.compare(Buffer.alloc(1), Buffer.alloc(1))",
      concat: "Buffer.concat([])",
      from: 'Buffer.from("a")',
      isBuffer: "Buffer.isBuffer(1)",
      isEncoding: 'Buffer.isEncoding("utf8")',
    },
    others: ["poolSize", "prototype", "name"],
  },
  {
    path: "Bun",
    uses: {
      allocUnsafe: "Bun.allocUnsafe(1)",
      concatArrayBuffers: "Bun.concatArrayBuffers([])",
      deepEquals: "Bun.deepEquals(1, 1)",
      escapeHTML: 'Bun.escapeHTML("<")',
      fileURLToPath: 'Bun.fileURLToPath("file:///a")',
      hash: 'Bun.hash("a")',
      indexOfLine: "Bun.indexOfLine(new Uint8Array(1), 0)",
      inspect: "Bun.inspect(1)",
      nanoseconds: "Bun.nanoseconds()",
      pathToFileURL: 'Bun.pathToFileURL("/a")',
      peek: "Bun.peek(1)",
      randomUUIDv7: "Bun.randomUUIDv7()",
      sleepSync: "Bun.sleepSync(0)",
      stringWidth: 'Bun.stringWidth("a")',
      stripANSI: 'Bun.stripANSI("a")',
      which: 'Bun.which("no-such-program")',
      env: "Bun.env",
      isMainThread: "Bun.isMainThread",
      revision: "Bun.revision",
      semver: 'Bun.semver.order("1.0.0", "1.0.1")',
      file: null,
      gc: null,
      serve: null,
      spawn: null,
      write: null,
    },
    others: ["main"],
  },
  {
    path: "process",
    uses: {
      availableMemory: "process.availableMemory()",
      config: "process.config",
      cpuUsage: "process.cpuUsage()",
      cwd: "process.cwd()",
      emitWarning: null,
      env: "process.env",
      execPath: "process.execPath",
      features: "process.features",
      getuid: "process.getuid?.()",
      hrtime: "process.hrtime()",
      memoryUsage: "process.memoryUsage()",
      nextTick: "process.nextTick(() => {})",
      pid: "process.pid",
      resourceUsage: "process.resourceUsage()",
      umask: "process.umask()",
      uptime: "process.uptime()",
      exit: null,
      kill: null,
      abort: null,
    },
    others: ["title", "exitCode"],
  },
];

// `it` is what the program lists. Each prints the names it finds, in the order in which it finds them.
const listings: [weight: number, copies: boolean, (it: string) => string][] = [
  [3, false, it => `names(Reflect.ownKeys(${it}))`],
  [2, false, it => `names(Object.getOwnPropertyNames(${it}))`],
  [1, false, it => `names(Object.keys(${it}))`],
  [1, false, it => `names(walked(${it}))`],
  [1, false, it => `names(Object.keys(Object.getOwnPropertyDescriptors(${it})))`],
  [1, false, it => `names(written(${it}))`],
  [2, true, it => `names(Object.keys({ ...${it} }))`],
  [2, true, it => `names(Object.keys(rest(${it})))`],
  [2, true, it => `names(Object.keys(Object.assign({}, ${it})))`],
  [2, true, it => `names(Object.entries(${it}).map(([key]) => key))`],
  [1, true, it => `String(Object.values(${it}).length)`],
];

const never = "Date.now() < 5";

/** How the program comes by what it lists: what goes in front of the steps, what goes around them, and how they name it. */
function bind(
  form: number,
  path: string,
  typed: boolean,
): { before: string[]; open: string; close: string; it: string } {
  const any = typed ? ": any" : "";
  const unknown = `${typed ? "(globalThis as any)" : "globalThis"}[String(Date.now())]`;
  const plain = { open: "", close: "" };
  switch (form) {
    case 0:
      return { ...plain, before: [], it: typed ? `(${path} as any)` : path };
    case 1:
      return { ...plain, before: [`let listed${any} = ${path};`, `if (${never}) listed = ${unknown};`], it: "listed" };
    case 2:
      return { ...plain, before: [`let listed${any} = ${path};`, `if (${never}) listed = { a: 1 };`], it: "listed" };
    case 3:
      return {
        ...plain,
        before: [`let listed${any} = ${path};`, `if (${never}) listed = JSON.parse("{}");`],
        it: "listed",
      };
    case 4:
      return {
        before: [],
        open: `for (const listed of [${never} ? ${unknown} : ${path}]${typed ? " as any[]" : ""}) {`,
        close: "}",
        it: "listed",
      };
    case 5:
      return {
        ...plain,
        before: [
          `const table${any} = { first: ${path}, second: { a: 1 }, third: Math };`,
          `const listed = table[${never} ? "second" : "first"];`,
        ],
        it: "listed",
      };
    case 6:
      return {
        ...plain,
        before: [
          `const list${typed ? ": any[]" : ""} = [${path}, Math, [1]];`,
          `const listed = list[${never} ? 1 : 0];`,
        ],
        it: "listed",
      };
    case 7:
      return {
        before: [],
        open: `function withListed(listed${any})${typed ? ": void" : ""} {`,
        close: `}\nif (${never}) withListed(${unknown});\nwithListed(${path});`,
        it: "listed",
      };
    default:
      return {
        ...plain,
        before: [
          `function chosen()${any} {`,
          `  if (${never}) return new Map();`,
          `  return ${path};`,
          `}`,
          `const listed = chosen();`,
        ],
        it: "listed",
      };
  }
}
export const numberOfForms = 9;

export function generate(random: Random, typed: boolean, holder: Holder, form: number): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const out: string[] = [
    `function names(keys${as("(string | symbol)[]")})${as("string")} {`,
    `  return keys.length + " " + keys.map(key => String(key)).join();`,
    `}`,
    `function walked(object${as("any")})${as("string[]")} {`,
    `  const keys = [];`,
    `  for (const key in object) keys.push(key);`,
    `  return keys;`,
    `}`,
    `function written(object${as("any")})${as("string[]")} {`,
    `  const keys${as("string[]")} = [];`,
    `  JSON.stringify(object, (key, value) => (keys.push(key), key === "" ? value : undefined));`,
    `  return keys;`,
    `}`,
    `function rest({ ...copy }${as("any")})${as("any")} {`,
    `  return copy;`,
    `}`,
    `let quiet = false;`,
    `function attempt(label${as("string")}, run${as("() => unknown")})${as("void")} {`,
    `  let text;`,
    `  try {`,
    `    text = String(run());`,
    `  } catch (error) {`,
    `    text = "throws " + (error${typed ? " as Error" : ""}).name;`,
    `  }`,
    `  if (!quiet) console.log(label, text);`,
    `}`,
  ];
  if (holder.setup) out.push(...holder.setup.split("\n"));
  const { path } = holder;
  const named = typed ? `(${path} as any)` : path;
  const { before, open, close, it } = bind(form, path, typed);
  const added = Object.keys(holder.uses);
  const body: string[] = [];
  const list = (label: string, copies?: boolean) => {
    const [, , text] = random.weighted(
      listings
        .filter(listing => copies === undefined || listing[1] === copies)
        .map(listing => [listing[0], listing] as const),
    );
    body.push(`attempt(${JSON.stringify(label)}, () => ${text(it)});`);
  };
  const steps = random.between(1, 5);
  for (let step = 0; step < steps; step++) {
    const key = random.chance(0.85) || !holder.others ? random.pick(added) : random.pick(holder.others);
    const quoted = JSON.stringify(key);
    const label = JSON.stringify(`${step} ${key}`);
    const call = Object.hasOwn(holder.uses, key) ? holder.uses[key] : null;
    // What a program writes by the name of the object, and now and then through the value that it lists.
    const on = random.chance(0.8) ? named : it;
    const kind = random.between(0, call ? 15 : 10);
    if (kind > 10) body.push(`attempt(${label}, () => typeof ${typed ? `(${call} as any)` : `(${call})`});`);
    else if (kind === 0) body.push(`attempt(${label}, () => typeof ${on}.${key});`);
    else if (kind === 1) body.push(`attempt(${label}, () => typeof ${on}[${quoted}]);`);
    else if (kind === 2) body.push(`attempt(${label}, () => { if (!${on}.${key}) return "none"; return "some"; });`);
    else if (kind === 3)
      body.push(`attempt(${label}, () => { const { ${key}: taken } = ${on}; return typeof taken; });`);
    else if (kind === 4) body.push(`attempt(${label}, () => ${quoted} in ${on});`);
    else if (kind === 5) body.push(`attempt(${label}, () => Object.hasOwn(${on}, ${quoted}));`);
    else if (kind === 6)
      body.push(`attempt(${label}, () => typeof Object.getOwnPropertyDescriptor(${on}, ${quoted}));`);
    else if (kind === 7) body.push(`attempt(${label}, () => typeof ${on}?.${key});`);
    else if (kind === 8) body.push(`attempt(${label}, () => [${on}.${key}].length);`);
    else if (kind === 9) body.push(`attempt(${label}, () => ${on}.${key} === undefined);`);
    else body.push(`attempt(${label}, () => Reflect.has(${on}, ${quoted}));`);
    if (random.chance(0.3)) list(`${step} keys`);
  }
  list("copied", true);
  body.push(`attempt("own keys", () => names(Reflect.ownKeys(${it})));`);
  if (random.chance(0.5)) {
    const key = random.pick(added);
    body.push(`attempt("late ${key}", () => typeof ${named}.${key});`);
    list("late keys");
  }
  const steppedIn = [...before, ...(open ? [open, ...body.map(line => "  " + line), ...close.split("\n")] : body)];
  const place = random.between(0, 3);
  if (place <= 1) out.push(...steppedIn);
  else if (place === 2)
    out.push(`function steps()${as("void")} {`, ...steppedIn.map(line => "  " + line), `}`, `steps();`);
  else
    out.push(
      `function steps(turn${as("number")})${as("void")} {`,
      `  quiet = turn < 29;`,
      ...steppedIn.map(line => "  " + line),
      `}`,
      `for (let turn = 0; turn < 30; turn++) steps(turn);`,
    );
  return out.join("\n") + "\n";
}
