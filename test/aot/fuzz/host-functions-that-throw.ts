// Functions of Bun, Node.js and the web that are written in native code, called with values they accept and values they refuse. A program
// picks 2 to 6 of them. Each is called by its full name, through a constant or a pattern, through a small function with typed
// parameters, bound, or with call, apply and Reflect.apply, with and without a receiver. Calls stand at the top of the module, in
// loops, in callbacks of array methods, in getters, constructors, generators and behind an await. The values come from lists that mix
// good and bad ones, so one call site returns on one turn and throws on the next. Some arguments are objects whose toString, valueOf,
// toJSON or getters run code of the program while the native function is on the stack: that code captures a stack, throws, collects
// garbage, or calls another native function that throws. The program prints each result, and of each error its class, name, code and
// message and the functions of the program that its stack lists.
import type { Random } from "./random";

type Kind = "number" | "text" | "bytes" | "any";
type Entry = { path: string; takes: Kind[]; good: string[][]; bad: string[][]; runsCode?: (hook: string) => string[] };

const bytes = (...values: number[]) => `new Uint8Array([${values.join(", ")}])`;
const digest = (path: string): Entry => ({
  path,
  takes: ["text", "any"],
  good: [
    [`"abc"`, `"hex"`],
    [bytes(1, 2, 3), `"base64"`],
    [`""`, `"hex"`],
  ],
  bad: [
    [`"abc"`, `"no-such-encoding"`],
    [`Symbol("s")`, `"hex"`],
    [`undefined`, `"hex"`],
    [`12`, `"hex"`],
  ],
});
const hash = (path: string): Entry => ({
  path,
  takes: ["text", "any"],
  good: [[`"abc"`], [`""`], [bytes(9, 8, 7)], [`"abc"`, `7`]],
  bad: [[`Symbol("s")`], [`"abc"`, `Symbol("s")`]],
  runsCode: hook => [`{ toString() { ${hook} return "abc"; } }`],
});
const parser = (path: string, good: string[], bad: string[]): Entry => ({
  path,
  takes: ["text"],
  good: good.map(text => [JSON.stringify(text)]),
  bad: [...bad.map(text => [JSON.stringify(text)]), [`Symbol("s")`]],
  runsCode: hook => [`{ toString() { ${hook} return ${JSON.stringify(good[0])}; } }`],
});
const packer = (path: string): Entry => ({
  path,
  takes: ["bytes"],
  good: [[bytes(1, 1, 1, 1, 2)], [`"aaaaaaaaaa"`], [bytes()]],
  bad: [[`12`], [`undefined`], [`{}`], [`Symbol("s")`]],
});
const unpacker = (path: string): Entry => ({
  path,
  takes: ["bytes"],
  good: [],
  bad: [[bytes(255, 254)], [bytes()], [`12`], [bytes(31, 139, 8, 0)], [`undefined`]],
});

const entries: Entry[] = [
  {
    path: "Bun.sleepSync",
    takes: ["number"],
    good: [["0"], ["0.5"], ["1"], ["-0"]],
    bad: [["-1"], ["NaN"], ["-0.5"], ["-Infinity"], [`"soon"`], []],
  },
  {
    path: "Bun.allocUnsafe",
    takes: ["number"],
    good: [["0"], ["1"], ["16"]],
    bad: [["-1"], ["NaN"], ["-0.5"], [`"many"`], []],
  },
  {
    path: "Bun.indexOfLine",
    takes: ["bytes", "number"],
    good: [
      [bytes(97, 10, 98, 10), "0"],
      [bytes(97, 10, 98, 10), "2"],
      [bytes(97, 10), "9"],
      [bytes(97, 10), "-1"],
      [bytes(97, 10), "0.5"],
    ],
    bad: [
      [bytes(97, 10), `Symbol("s")`],
      [`12`, `0`],
    ],
  },
  {
    path: "getSystemErrorName",
    takes: ["number"],
    good: [["-2"], ["-13"], ["-1"]],
    bad: [["2"], ["-2.5"], ["NaN"], ["0"], [`"two"`], ["2 ** 40"]],
  },
  {
    path: "Buffer.alloc",
    takes: ["number"],
    good: [["0"], ["3"], ["2.5"]],
    bad: [["-1"], ["NaN"], [`"3"`], ["2 ** 53"]],
  },
  {
    path: "Buffer.byteLength",
    takes: ["text"],
    good: [[`"abc"`], [`"é"`], [bytes(1, 2)]],
    bad: [["1"], ["undefined"], ["{}"]],
  },
  { path: "process.hrtime", takes: ["any"], good: [], bad: [["1"], [`"a"`], ["[1]"], ["{}"]] },
  { path: "process.chdir", takes: ["text"], good: [], bad: [[`"/nonexistent-directory/entry"`], ["1"], ["undefined"]] },
  {
    path: "atob",
    takes: ["text"],
    good: [[`"YWJj"`], [`""`]],
    bad: [[`"***"`], [`Symbol("s")`], []],
    runsCode: hook => [`{ toString() { ${hook} return "YWJj"; } }`],
  },
  {
    path: "btoa",
    takes: ["text"],
    good: [[`"abc"`]],
    bad: [[`"\\u0100"`], [`Symbol("s")`], []],
    runsCode: hook => [`{ toString() { ${hook} return "abc"; } }`],
  },
  {
    path: "structuredClone",
    takes: ["any"],
    good: [[`{ a: [1, "b"] }`], ["7"]],
    bad: [["() => {}"], [`Symbol("s")`], [], [`{ a: { b: () => {} } }`]],
    runsCode: hook => [`{ get a() { ${hook} return 1; } }`],
  },
  { path: "queueMicrotask", takes: ["any"], good: [], bad: [["1"], [], [`"f"`]] },
  { path: "crypto.getRandomValues", takes: ["any"], good: [], bad: [["1"], ["new Float64Array(2)"], ["{}"], []] },
  {
    path: "Bun.fileURLToPath",
    takes: ["text"],
    good: [[`"file:///a/b"`]],
    bad: [[`"http://example.com/"`], ["1"], [`"not a url"`]],
  },
  { path: "Bun.pathToFileURL", takes: ["text"], good: [[`"/a/b c"`]], bad: [[], ["1"], [`Symbol("s")`]] },
  { path: "Bun.stringWidth", takes: ["text"], good: [[`"abc"`], [`"\\u{1F600}"`], [`""`]], bad: [[`Symbol("s")`]] },
  {
    path: "Bun.escapeHTML",
    takes: ["text"],
    good: [[`"<a & b>"`], ["12"], [`""`]],
    bad: [[`Symbol("s")`]],
    runsCode: hook => [`{ toString() { ${hook} return "<"; } }`],
  },
  {
    path: "Bun.which",
    takes: ["text", "any"],
    good: [[`"no-such-program-anywhere"`], [`"no-such-program-anywhere"`, `{ PATH: "/nonexistent" }`]],
    bad: [[`Symbol("s")`], [`"x"`, `{ PATH: Symbol("s") }`]],
    runsCode: hook => [`"no-such-program-anywhere"`, `{ get PATH() { ${hook} return "/nonexistent"; } }`],
  },
  { path: "Bun.randomUUIDv7", takes: ["any"], good: [], bad: [[`"no-such-encoding"`], [`Symbol("s")`]] },
  {
    path: "Bun.randomUUIDv5",
    takes: ["text", "text"],
    good: [
      [`"name"`, `"dns"`],
      [`"name"`, `"6ba7b810-9dad-11d1-80b4-00c04fd430c8"`],
    ],
    bad: [[`"name"`, `"no namespace"`], [`"name"`], [`Symbol("s")`, `"dns"`]],
  },
  {
    path: "Bun.semver.order",
    takes: ["text", "text"],
    good: [
      [`"1.0.0"`, `"1.0.1"`],
      [`"2.0.0"`, `"2.0.0"`],
    ],
    bad: [[`"one"`, `"1.0.0"`], [`"1.0.0"`], [`Symbol("s")`, `"1.0.0"`]],
    runsCode: hook => [`{ toString() { ${hook} return "1.2.3"; } }`, `"1.0.0"`],
  },
  {
    path: "Bun.semver.satisfies",
    takes: ["text", "text"],
    good: [
      [`"1.0.0"`, `"^1.0.0"`],
      [`"2.0.0"`, `"^1.0.0"`],
    ],
    bad: [[`"1.0.0"`], [`Symbol("s")`, `"1"`]],
  },
  {
    path: "Bun.password.verifySync",
    takes: ["text", "text"],
    good: [],
    bad: [[`"a"`, `"not a hash"`], [`""`, `""`], [`"a"`], [`1`, `2`]],
  },
  { path: "Bun.mmap", takes: ["text"], good: [], bad: [[`"/nonexistent-directory/entry"`], ["1"], []] },
  { path: "Bun.unsafe.arrayBufferToString", takes: ["bytes"], good: [[bytes(97, 98)], [bytes()]], bad: [["1"], []] },
  {
    path: "Bun.CryptoHasher.hash",
    takes: ["text", "text", "any"],
    good: [
      [`"sha256"`, `"abc"`, `"hex"`],
      [`"md5"`, bytes(1), `"base64"`],
    ],
    bad: [[`"no-such-algorithm"`, `"abc"`, `"hex"`], [`"sha256"`, `12`, `"hex"`], [`"sha256"`]],
  },
  digest("Bun.SHA1.hash"),
  digest("Bun.SHA256.hash"),
  digest("Bun.MD5.hash"),
  digest("Bun.sha"),
  hash("Bun.hash"),
  hash("Bun.hash.crc32"),
  hash("Bun.hash.adler32"),
  hash("Bun.hash.wyhash"),
  hash("Bun.hash.xxHash32"),
  hash("Bun.hash.murmur32v3"),
  parser("Bun.TOML.parse", [`a = 1`, `[t]\nb = "c"`], [`a = `, `= 1`, `[t`]),
  parser("Bun.YAML.parse", [`a: 1`, `- b\n- c`], [`a: [1`, `"`, `a: b: c`]),
  parser("Bun.JSONC.parse", [`{ "a": 1 } // b`, `[1, 2,]`], [`{`, `{ a }`, ``]),
  parser("Bun.JSON5.parse", [`{ a: 1 }`, `[0x10, +1]`], [`{`, `{ a: }`, ``]),
  packer("Bun.deflateSync"),
  packer("Bun.gzipSync"),
  packer("Bun.zstdCompressSync"),
  unpacker("Bun.inflateSync"),
  unpacker("Bun.gunzipSync"),
  unpacker("Bun.zstdDecompressSync"),
];

const typeOf: Record<Kind, string> = { number: "number", text: "string", bytes: "Uint8Array", any: "any" };

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const any = typed ? " as any" : "";
  const chosen = random.sample(entries, random.between(2, 6));
  const out: string[] = [
    `import { getSystemErrorName } from "node:util";`,
    `function ownNames(stack${as("unknown")})${as("string")} {`,
    `  return (String(stack).match(/\\bown[A-Z]\\w*/g) ?? []).join("<");`,
    `}`,
    `function show(value${as("any")})${as("string")} {`,
    `  if (typeof value === "bigint") return value + "n";`,
    `  if (typeof value === "string") return JSON.stringify(value);`,
    `  if (ArrayBuffer.isView(value)) return value.constructor.name + " " + value.byteLength;`,
    `  if (typeof value === "object" && value !== null) return value instanceof URL ? value.href : JSON.stringify(value);`,
    `  return String(value);`,
    `}`,
    `function told(error${as("any")})${as("string")} {`,
    `  const kind = error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : error instanceof SyntaxError ? "SyntaxError" : error instanceof Error ? "Error" : typeof error;`,
    `  // An error with a code is made by the native function itself, so its stack begins with that function.`,
    `  const first = error?.code === undefined ? "" : (/^\\s*at (?:async )?([\\w.$<>]+)/m.exec(String(error?.stack))?.[1] ?? "") + "<";`,
    `  return kind + " " + error?.name + " " + error?.code + " " + String(error?.message).split("\\n")[0] + " | " + first + ownNames(error?.stack);`,
    `}`,
    `let under = 0, calls = 0;`,
    `function ownAttempt(label${as("string")}, run${as("() => unknown")})${as("void")} {`,
    `  try {`,
    `    const value = run();`,
    `    console.log(label, "returns", show(value));`,
    `  } catch (error) {`,
    `    console.log(label, "throws", told(error));`,
    `  }`,
    `}`,
  ];

  // What the program does while a native function is converting an argument.
  const hooks = [
    `console.log("under", ++under, ownNames(new Error("here").stack));`,
    `under++; Bun.gc(true);`,
    `if (++under % 2 === 1) throw new RangeError("from below " + under);`,
    `under++; try { Bun.sleepSync(-1); } catch (error) { console.log("below", told(error)); }`,
    `under++; try { atob("***"); } catch (error) { console.log("below", told(error)); }`,
    `{ const holder = {}; Error.captureStackTrace(holder); console.log("captured", ++under, ownNames((holder${any}).stack)); }`,
  ];

  chosen.forEach((entry, index) => {
    const name = `f${index}`;
    const rows = random.shuffled([...entry.good, ...entry.bad]).slice(0, random.between(2, 6));
    if (entry.runsCode && random.chance(0.6))
      rows.splice(random.below(rows.length + 1), 0, entry.runsCode(random.pick(hooks)));
    const width = Math.max(1, ...rows.map(row => row.length));
    // Only numbers in the list: a typed call site sees nothing but numbers and finds out on each turn whether the function throws.
    const onlyNumbers = entry.takes[0] === "number" && entry.takes.length === 1 && random.chance(0.6);
    const kept = onlyNumbers ? rows.filter(row => row.length === 1 && !/["{S]/.test(row[0])) : rows;
    const list = kept.length > 0 ? kept : [entry.bad[0]];
    const callee = random.weighted<string>([
      [4, entry.path],
      [2, name],
      [1, `${name}Bound`],
      [2, `own${name.toUpperCase()}`],
    ]);
    const holder = entry.path.includes(".") ? entry.path.slice(0, entry.path.lastIndexOf(".")) : "globalThis";
    const member = entry.path.slice(entry.path.lastIndexOf(".") + 1);
    if (callee === name)
      out.push(
        random.chance(0.5) || holder === "globalThis"
          ? `const ${name} = ${entry.path}${any};`
          : `const { ${member}: ${name} } = ${holder}${any};`,
      );
    if (callee === `${name}Bound`)
      out.push(`const ${name}Bound = (${entry.path}${any}).bind(${random.pick(["undefined", "null", holder, "{}"])});`);
    const parameters = Array.from({ length: width }, (_, at) => `p${at}`);
    if (callee.startsWith("own"))
      out.push(
        `function ${callee}(${parameters.map((p, at) => p + (typed ? (at === 0 || onlyNumbers ? "" : "?") + ": " + (onlyNumbers ? "number" : typeOf[entry.takes[at] ?? "any"]) : "")).join(", ")}) {`,
        `  const result = (${entry.path}${onlyNumbers ? "" : any})(${parameters.join(", ")});`,
        `  calls++;`,
        `  return result;`,
        `}`,
      );
    const target =
      callee.startsWith("own") || callee === entry.path
        ? onlyNumbers || !typed
          ? callee
          : `(${callee} as any)`
        : callee;
    const call = (args: string) =>
      random.weighted<string>([
        [6, `${target}(...${args})`],
        [1, `${target}.call(${random.pick(["undefined", "{}", holder])}, ...${args})`],
        [1, `${target}.apply(${random.pick(["null", "[]", holder])}, ${args})`],
        [1, `Reflect.apply(${target}, ${random.pick(["undefined", holder])}, ${args})`],
      ]);
    const direct = (row: string[]) => `${target}(${row.join(", ")})`;
    const label = JSON.stringify(entry.path);
    const turns = random.pick([1, 1, 2, 3, 40]);
    const quiet = turns > 3;
    if (onlyNumbers) {
      out.push(`const values${index}${as("number[]")} = [${list.map(row => row[0]).join(", ")}];`);
      const site = `${target}(value)`;
      out.push(
        `for (let turn = 0; turn < ${turns}; turn++)`,
        `  for (const value of values${index}) ${quiet ? `if (turn > ${turns - 2}) ownAttempt(${label}, () => ${site}); else try { ${site}; } catch {}` : `ownAttempt(${label} + " " + value, () => ${site});`}`,
      );
      return;
    }
    out.push(`const rows${index}${as("any[][]")} = [${list.map(row => `[${row.join(", ")}]`).join(", ")}];`);
    const place = random.between(0, 8);
    const each = `rows${index}`;
    if (place === 0) for (const row of list) out.push(`ownAttempt(${label}, () => ${direct(row)});`);
    else if (place === 1)
      out.push(
        `for (let turn = 0; turn < ${turns}; turn++) for (const row of ${each}) ownAttempt(${label}, () => ${call("row")});`,
      );
    else if (place === 2)
      out.push(
        `${each}.forEach(function ownEach${index}(row) { ownAttempt(${label}, function ownInner${index}() { const result = ${call("row")}; calls++; return result; }); });`,
      );
    else if (place === 3)
      out.push(
        `class Own${index} { row${as("any[]")}; value${as("unknown")}; constructor(row${as("any[]")}) { this.row = row; this.value = ${call("row")}; } }`,
        `for (const row of ${each}) ownAttempt(${label}, () => new Own${index}(row).value);`,
      );
    else if (place === 4)
      out.push(
        `function* ownSteps${index}()${as("Generator<unknown>")} { for (const row of ${each}) { try { yield ${call("row")}; } catch (error) { yield "caught " + told(error); } } }`,
        `for (const step of ownSteps${index}()) console.log(${label}, show(step));`,
      );
    else if (place === 5)
      out.push(
        `async function ownLater${index}(row${as("any[]")}) { await null; const result = ${call("row")}; calls++; return result; }`,
        `for (const row of ${each}) await ownLater${index}(row).then(value => console.log(${label}, "resolves", show(value)), error => console.log(${label}, "rejects", told(error)));`,
      );
    else if (place === 6)
      out.push(
        `for (const row of ${each}) { const holder = { get ownGetter() { const result = ${call("row")}; calls++; return result; } }; ownAttempt(${label}, () => holder.ownGetter); }`,
      );
    else if (place === 7)
      out.push(
        `ownAttempt(${label}, () => [3, 1, 2].sort(function ownCompare${index}(a, b) { for (const row of ${each}) ${call("row")}; return a - b; }).join());`,
      );
    else
      out.push(
        `for (const row of ${each}) { try { ${call("row")}; } catch (error) { console.log(${label}, "first", told(error)); } finally { ownAttempt(${label} + " again", () => ${call("row")}); } }`,
      );
  });
  out.push(`console.log("under", under, "calls", calls);`);
  return out.join("\n") + "\n";
}
