// Writes typed functions whose loops meet the edges of what they hold: views that shrink, grow, are detached or shared in a turn, texts of both widths, big integers, lists at their ends, records with keys that look like positions, wide switches, many parameters, classes of many fields.
// For write-random-typed-edge-sweep.ts.
import { Draws } from "./draw-by-seed.ts";

let draws = new Draws(0);
const pick = <T>(from: readonly T[]): T => draws.pick(from);
const range = (from: number, to?: number): number[] =>
  to === undefined ? range(0, from) : Array.from({ length: Math.max(0, to - from) }, (_, at) => from + at);
const format = (text: string, number: number) => text.replace("%d", String(number));

const bytesOf: Record<string, number> = {
  "Int8Array": 1,
  "Uint8Array": 1,
  "Uint8ClampedArray": 1,
  "Int16Array": 2,
  "Uint16Array": 2,
  "Int32Array": 4,
  "Uint32Array": 4,
  "Float32Array": 4,
  "Float64Array": 8,
};
const storedNumbers = ["0", "-0", "1", "-1", "0.5", "-1.5", "127", "128", "255", "256", "65535", "2147483647", "2147483648", "-2147483649", "4294967295", "4294967296", "9007199254740993", "1e300", "Infinity", "NaN", "i", "i * 0.75", "-i", "k", "i * k", "i / 3", "1 / (i - 2)"]; // prettier-ignore
const oddTexts = ['"\\ud83d\\ude00"', '"abc"', '""', '"\\u0100xyz"', '"\\u00ff\\u00fe"', '"a\\ud83d"', '"\\ude00b"', '"x\\u0000y"', '"0123456789".repeat(3)', '"é".repeat(20)', '"\\u4e2d\\u6587abc"', '" a\\tb\\n"', '"ß"', '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"']; // prettier-ignore
const bigIntegers = ["0n", "1n", "-1n", "-7n", "2n ** 31n", "2n ** 63n - 1n", "2n ** 63n", "-(2n ** 63n)", "2n ** 64n - 1n", "2n ** 64n", "-(2n ** 65n)", "10n ** 20n", "123456789012345678901234567890n"]; // prettier-ignore

function readElement(v: string, i = "i"): string {
  return pick([
    `${v}[${i}]!`,
    `${v}[${i}]! * 2`,
    `${v}[${i}]! + ${i}`,
    `${v}[${i}]! | 0`,
    `${v}[${i}]! >>> 0`,
    `(${v}[${i} + 1] ?? -7)`,
    `(${v}[${i} - 1] ?? -9)`,
    `${v}[${i} & 3]!`,
    `${v}[${v}.length - 1 - ${i}] ?? 5`,
    `${v}.at(${i} - 2) ?? 3`,
  ]);
}
function writeViews(at: number): [string, string[]] {
  const type = pick(Object.keys(bytesOf));
  const bytes = bytesOf[type];
  const length = draws.pick([4, 8, 12]);
  const change = pick([
    "cut(i)",
    "if (i === k) cut(i)",
    "grow(i)",
    "if (i === 2) gone()",
    "if (i === k) gone()",
    "",
    "if (v[i]! > 2) cut(i)",
    "hook()",
    "if (i % 3 === k) grow(i)",
  ]);
  const loop = pick([
    "for (let i = 0; i < v.length; i++)",
    "for (let i = 0, e = v.length; i < e; i++)",
    "for (let i = v.length - 1; i >= 0; i--)",
    "for (let i = 0; i < 9; i++)",
    "for (let i = k; i < v.length; i += 2)",
  ]);
  let body: any = draws.sample(
    [
      `c++; if (c > 60) break;`,
      `s += ${readElement("v")};`,
      `v[i] = ${pick(storedNumbers)};`,
      `${change};`,
      `s = s * 0.5 + (${readElement("v")});`,
      `v[i] = v[i]! + ${pick(["1", "k", "0.5", "i"])};`,
      `if (i < v.length) s += v[i]!; else s -= 1;`,
      `const x = v[i]!; ${change}; s += x + (v[i] ?? 100);`,
      `v[k] = v[i]!;`,
      `[v[i], v[k]] = [v[k]!, v[i]!];`,
    ],
    draws.between(3, 6),
  );
  body = [
    ...["c++; if (c > 60) break;"],
    ...body.filter((deeds: any) => !deeds.startsWith("c++")).map((deeds: any) => deeds),
  ];
  const kind = pick(["rab", "rab", "track", "track", "plain", "shared", "sub", "odd"]);
  const made = (
    {
      "rab": `const buf = new (ArrayBuffer as any)(${length * bytes}, { maxByteLength: ${length * bytes * 4} }); const v = new ${type}(buf, 0, ${Math.max(1, Math.floor(length / 2))});`,
      "track": `const buf = new (ArrayBuffer as any)(${length * bytes}, { maxByteLength: ${length * bytes * 4} }); const v = new ${type}(buf);`,
      "plain": `const buf: any = new ArrayBuffer(${length * bytes}); const v = new ${type}(buf);`,
      "shared": `const buf = new (SharedArrayBuffer as any)(${length * bytes}, { maxByteLength: ${length * bytes * 4} }); const v = new ${type}(buf);`,
      "sub": `const buf: any = new (ArrayBuffer as any)(${length * bytes}, { maxByteLength: ${length * bytes * 4} }); const v = new ${type}(buf).subarray(1);`,
      "odd": `const buf: any = new (ArrayBuffer as any)(${length * bytes}, { maxByteLength: ${length * bytes * 4} }); const v = new ${type}(buf, ${bytes});`,
    } as Record<string, any>
  )[kind];
  const stores = range(draws.between(1, 5))
    .map((position: any) => `v[${position}] = ${pick(["1", "2", "3", "7", "200", "-5", "0.5", "70000"])};`)
    .join(" ");
  const inner = `function run(v: ${type}, k: number, cut: (i: number) => void, grow: (i: number) => void, gone: () => void, hook: () => void): any { let s = 0, c = 0; ${loop} { ${body.join(" ")} } return [s, c, v.length]; }`;
  const two = draws.next() < 0.3;
  const text = `function t${at}(k: number): any {
  ${made} ${stores}
  const cut = (i: number) => { tr(() => buf.resize?.(Math.max(0, ${length * bytes} - ${bytes} * i))); }; const grow = (i: number) => { tr(() => (buf.resize ? buf.resize(Math.min(${length * bytes * 4}, ${length * bytes} + ${bytes} * i)) : buf.grow?.(Math.min(${length * bytes * 4}, ${length * bytes} + ${bytes} * i)))); }; const gone = () => { tr(() => structuredClone(buf, { transfer: [buf] })); }; let h = 0; const hook = () => { if (h++ === k) ${pick(["cut(2)", "gone()", "grow(3)", "v.fill(9)", "0"])}; };
  ${inner}
  const r = tr(() => run(v, k, cut, grow, gone, hook));
  return [r, ${two ? "tr(() => run(v, k + 1, cut, grow, gone, hook)), " : ""}v.length, tr(() => [...v]), tr(() => buf.byteLength)];
}
`;
  return [text, draws.sample([0, 1, 2, 3, 5, -1], 3).map((position: any) => `t${at}(${position})`)];
}
function writeTexts(at: number): [string, string[]] {
  const loop = pick([
    "for (let i = 0; i < s.length; i++)",
    "for (let i = s.length - 1; i >= 0; i--)",
    "for (let i = 0; i < n; i++)",
    "for (let i = -1; i <= s.length; i++)",
  ]);
  const deeds = draws.sample(
    [
      "x += s.charCodeAt(i) | 0;",
      "x += (s.codePointAt(i) ?? 1);",
      'o += s[i] ?? "_";',
      "o = s.charAt(i) + o;",
      "if (s[i] === t[i]) x++;",
      "if (s.charCodeAt(i) > 0xd7ff && s.charCodeAt(i) < 0xdc00) x += 1000;",
      'o += i % 2 === 0 ? "\\u0100" : "z";',
      "x ^= s.charCodeAt(s.length - 1 - i);",
      "o += String.fromCharCode(s.charCodeAt(i) + 1);",
      "if (s.slice(i, i + 2) === t.slice(0, 2)) x += 7;",
      "o += s.substring(i, i + 1).toUpperCase();",
      "x += s.indexOf(t, i);",
      "o += `${s.at(-i)}${i}`;",
      "if (s < t) x++; else if (s > t) x--;",
      "x = (x * 31 + s.charCodeAt(i)) | 0;",
      'const ch = s[i]; switch (ch) { case "a": x += 1; break; case "\\u0100": x += 2; break; case undefined: x += 3; break; case "\\ud83d": x += 4; break; default: x += 5; }',
      'o += s.startsWith(t, i) ? "T" : "";',
      "o = o.length > 30 ? o.slice(3) + t : o + t;",
      "parts.push(s[i] + t);",
      "if ((s.charCodeAt(i) - 48) >>> 0 < 10) x = x * 10 + (s.charCodeAt(i) - 48);",
      "bytes[i & 7] = s.charCodeAt(i);",
    ],
    draws.between(2, 5),
  );
  const text = `function t${at}(s: string, t: string, n: number): any { let x = 0, o = ""; const parts: string[] = []; const bytes = new Uint8Array(8); let c = 0; ${loop} { if (c++ > 70) break; ${deeds.join(" ")} } return [x, o, parts.join("|"), bytes.join(), o.length, ${pick(["o.split(t).length", 'o.replaceAll(t || "q", "<$&>")', "[...o].length", "o.toLowerCase()", "JSON.stringify(o)", "encode(o)", "o === s + t", "(o as any).isWellFormed()", "o.trim().padEnd(5, t)", "new Map([[o, 1], [s, 2]]).get(s)", "({ [o]: 1, [s]: 2 } as Record<string, number>)[s]"])}]; }
`;
  return [text, range(4).map((_: any) => `t${at}(${pick(oddTexts)}, ${pick(oddTexts)}, ${pick([0, 1, 3, 9])})`)];
}
function writeBigInts(at: number): [string, string[]] {
  const deeds = draws.sample(
    [
      "a += b;",
      "a *= 3n;",
      "a = a - b;",
      "a = BigInt.asIntN(64, a * 6364136223846793005n + 1442695040888963407n);",
      "a = BigInt.asUintN(64, a + b);",
      "a ^= b;",
      "a = (a << 3n) ^ (a >> 5n);",
      "a &= 0xffffffffffffn;",
      "a = a % (b || 7n);",
      "a = a / (b || 3n);",
      "if (a > b) x++; else if (a < b) x--; else x += 10;",
      "x += Number(a & 255n);",
      "a = -a;",
      "a = ~a;",
      "a |= BigInt(i);",
      "if (a === b) break;",
      "[a, b] = [b, a];",
      "a++;",
      "b--;",
      "v[i & 3] = a;",
      "a = v[i & 3]!;",
      "u[i & 3] = a;",
      "a += u[(i + 1) & 3]!;",
      "x += a.toString(16).length;",
      "if (Number(a) > 2 ** 53) x += 1; ",
      "if (a < i) x += 100;",
      "if (a == BigInt(i)) x += 1000;",
    ],
    draws.between(3, 6),
  );
  const text = `function t${at}(a: bigint, b: bigint, n: number): any { let x = 0; const v = new BigInt64Array(4), u = new BigUint64Array(4); for (let i = 0; i < n; i++) { ${deeds.join(" ")} if (a > 2n ** 300n || a < -(2n ** 300n)) a %= 1000003n; } return [a, b, x, [...v], [...u], a < b, a === b, BigInt.asIntN(${pick([1, 8, 32, 63, 64, 65])}, a)]; }
`;
  return [
    text,
    range(4).map((_: any) => `t${at}(${pick(bigIntegers)}, ${pick(bigIntegers)}, ${pick([0, 1, 2, 5, 9])})`),
  ];
}
function writeLists(at: number): [string, string[]] {
  const deeds = draws.sample(
    [
      "s += a[i] ?? -1;",
      "a[i] = s;",
      "a[i + n] = i;",
      "a[a.length] = 0.5;",
      "a.push(s);",
      "s += a.pop() ?? 0.25;",
      "a.length = Math.max(0, a.length - 1);",
      "a.length = i;",
      "s += a.at(-1) ?? 7;",
      "s += a[a.length - 1] ?? 3;",
      "if (i in a) s += 1;",
      "delete a[i];",
      "a[i * 100] = 1;",
      "a[i] = -0;",
      "a[i] = NaN;",
      "s += a.indexOf(NaN) + (a.includes(NaN) ? 10 : 0);",
      "a.unshift(i);",
      "s += a.shift() ?? 0;",
      "a.reverse();",
      "a.sort((x, y) => x - y);",
      "s += a.reduce((x, y) => x + y, 0);",
      "s += Math.max(...a, 0);",
      "a.splice(1, 1);",
      "a.fill(i, 1, 2);",
      "s += a.slice(i).length;",
      "a = a.concat(a.slice(0, 2));",
      "a = [...a, i];",
      "s += a.filter(x => x > 1).length;",
      "s += a.map(x => x * 2)[i] ?? 0.125;",
      "const old = a.length; a.push(1, 2); if (a.length > old + 1) s += a[old]!;",
      "for (const x of a) { if (x > 5) break; s += x; if (a.length < 12) a.push(x + 1); }",
      "s += a.findLastIndex(x => x === i);",
      "if (a.length > 2) a.copyWithin(0, 1);",
      "s += a.join().length;",
      "s += a.lastIndexOf(i);",
      draws.next() < 0.2 ? "Object.freeze(a); " : "s += 1;",
      "s += a.flat().length;",
      "a[i]! && (s += a[i]!);",
      "a[i] = (a[i] ?? 0) + 1;",
    ],
    draws.between(3, 6),
  );
  const text = `function t${at}(a: number[], n: number): any { let s = 0, c = 0; ${pick(["for (let i = 0; i < a.length; i++)", "for (let i = 0; i < n; i++)", "for (let i = a.length - 1; i >= 0; i--)", "for (let i = 0, e = a.length; i < e; i++)"])} { if (c++ > 25 || a.length > 400) break; ${deeds.join(" ")} } return [s, a.length, a.slice(0, 30)]; }
`;
  const made = () =>
    pick([
      "[1, 2, 3]",
      "[0.5, -0, 2]",
      "[]",
      "[1, , 3] as number[]",
      "new Array<number>(4)",
      "Array.from({ length: 9 }, (_, i) => i)",
      "[NaN, 1e300, -1]",
      "[2147483647, 2147483648]",
      "Object.freeze([1, 2]) as number[]",
      "[...new Set([3, 1])]",
      "new Array<number>(3).fill(7)",
    ]);
  return [text, range(4).map((_: any) => `t${at}(${made()}, ${pick([0, 1, 2, 4, 7])})`)];
}
function writeRecords(at: number): [string, string[]] {
  const key = () =>
    pick([
      '"0"',
      '"1"',
      '"-0"',
      '"4294967295"',
      '"a"',
      '"b"',
      '"__proto__x"',
      '"1.5"',
      '"-1"',
      '"01"',
      "String(i)",
      "String(-i)",
      '"k" + i',
      "`${i}`",
      "k",
    ]);
  const mapKey = () => pick(["i", "-0", "0", "NaN", "i * 0.5", "2 ** 31 + i", "-i", "k.length", "i / 3"]);
  const deeds = draws.sample(
    [
      `o[${key()}] = i;`,
      `s += o[${key()}] ?? 0.5;`,
      `delete o[${key()}];`,
      `if (${key()} in o) s += 2;`,
      `o[${key()}] = (o[${key()}] ?? 0) + 1;`,
      `m.set(${mapKey()}, i);`,
      `s += m.get(${mapKey()}) ?? 0.25;`,
      `if (m.has(${mapKey()})) s += 3;`,
      `m.delete(${mapKey()});`,
      `t.add(${mapKey()});`,
      `if (t.has(${mapKey()})) s += 5;`,
      `for (const z in o) { s += z.length; if (s > 1e6) break; }`,
      `s += Object.keys(o).length;`,
      `for (const [x, y] of m) { s += x + y; if (m.size > 9) m.delete(x); }`,
      `s += Object.values(o).reduce((x, y) => x + y, 0);`,
      `o = { ...o, [${key()}]: i };`,
      `s += m.size * 10 + t.size;`,
      `g.set(${key()}, (g.get(${key()}) ?? 0) + i);`,
      `s += [...g.values()].length;`,
      `s += [...t].filter(x => x > 0).length;`,
      `(o[${key()}] ??= i);`,
      `s += Object.entries(o).length;`,
    ],
    draws.between(3, 6),
  );
  const text = `function t${at}(k: string, n: number): any { let s = 0; let o: Record<string, number> = ${pick(["{}", "{ a: 1, b: 2 }", '{ "1": 5, "0": 6, z: 1 }'])}; const m = new Map<number, number>(), t = new Set<number>(), g = new Map<string, number>(); for (let i = 0; i < n; i++) { ${deeds.join(" ")} } return [s, Object.keys(o), [...m], [...t], [...g]]; }
`;
  return [
    text,
    range(4).map((_: any) => `t${at}(${pick(['"a"', '"1"', '""', '"-0"', '"length"'])}, ${pick([0, 1, 2, 5, 9])})`),
  ];
}
function writeParameters(at: number): [string, string[]] {
  const count = pick([9, 17, 33, 40, 65]);
  const types = range(count).map((_: any) =>
    pick(["number", "number", "string", "number | undefined", "boolean", "number[]"]),
  );
  const values = {
    "number": ["i", "0.5", "-0", "2147483648", "NaN", "k"],
    "string": ['"s"', '"t" + i', '""'],
    "number | undefined": ["undefined", "i", "1.5"],
    "boolean": ["true", "i > 1"],
    "number[]": ["[i]", "[]", "[1, 2.5]"],
  } as Record<string, any>;
  const use: string[] = [];
  for (const position of draws.sample(range(count), Math.min(count, 6))) {
    use.push(
      (
        {
          "number": `a${position} * 2`,
          "string": `a${position}.length`,
          "number | undefined": `(a${position} ?? 9)`,
          "boolean": `(a${position} ? 1 : 0)`,
          "number[]": `(a${position}[0] ?? 4)`,
        } as Record<string, any>
      )[types[position]],
    );
  }
  const body = pick([
    "return " + use.join(" + ") + ";",
    "let s = 0; for (let i = 0; i < 3; i++) s += " + use.join(" + ") + " + i; return s;",
    "return d > 0 ? h(d - 1, " +
      range(count)
        .map((position: any) => `a${position}`)
        .join(", ") +
      ") + 1 : " +
      use.join(" + ") +
      ";",
    "const f = () => " + use.join(" + ") + "; return f() + (d > 1 ? 1 : 0);",
    "try { return " + use.join(" + ") + "; } finally { calls++; }",
  ]);
  const text = `let calls${at} = 0; function t${at}(k: number): any { let calls = 0; function h(d: number, ${range(
    count,
  )
    .map((position: any) => `a${position}: ${types[position]}`)
    .join(
      ", ",
    )}): number { ${body} } let r = 0; for (let i = 0; i < 4; i++) r = r * 0.5 + h(i, ${types.map((x: any) => pick(values[x])).join(", ")}); return [r, calls, h(2, ${types.map((x: any) => (({ "number": pick(["k", "0.25", "-0"]), "string": String.fromCharCode(34) + "q" + String.fromCharCode(34), "number | undefined": pick(["undefined", "k"]), "boolean": "false", "number[]": "[k]" }) as Record<string, any>)[x]).join(", ")})]; }
`;
  return [text, [0, 1.5, -1].map((position: any) => `t${at}(${position})`)];
}
function writeSwitches(at: number): [string, string[]] {
  const count = pick([6, 30, 120, 300]);
  const isTextual = draws.next() < 0.4;
  let keys: any = draws.sample(range(-20, count * 4), count);
  if (draws.next() < 0.3) {
    keys = range(count).map((x: any) => x * pick([1, 1000, 2 ** 20]));
  }
  keys = [...[...new Set(keys)]];
  const label = isTextual ? (x: any) => `"w${x}"` : (x: any) => String(x);
  const cases = keys
    .map(
      (x: any) =>
        `case ${label(x)}: ${format(pick(["r += %d; break;", "r ^= %d; break;", "r -= %d;", "return r + %d;", "r = r * 3 + %d; continue;"]), draws.between(1, 50))}`,
    )
    .join(" ");
  const defaultCase = pick(["default: r += 1;", "default: r--; break;", ""]);
  const arg = isTextual ? "string" : "number";
  const text = `function t${at}(xs: ${arg}[]): number { let r = 0; for (const x of xs) { switch (x) { ${cases} ${defaultCase} } r = r % 100003; } return r; }
`;
  const drawnArguments = () =>
    range(draws.between(0, 9))
      .map((_: any) =>
        pick([
          label(pick(keys)),
          label(pick(keys)),
          isTextual ? '"w"' : pick(["0.5", "-0", "NaN", "2147483648", "Infinity", "1e9", "-1"]),
        ]),
      )
      .join(", ");
  return [
    text,
    [
      ...range(4).map((_: any) => `t${at}([${drawnArguments()}])`),
      ...[
        `t${at}(Array.from({ length: 40 }, (_, i) => ${isTextual ? `${String.fromCharCode(34) + "w" + String.fromCharCode(34) + " + "}i` : `i * ${pick(["1", "3", "0.5", "1000"])}`}))`,
      ],
    ],
  ];
}
function writeClasses(at: number): [string, string[]] {
  const count = pick([4, 20, 70, 140]);
  const types = range(count).map((_: any) => pick(["number", "string", "number[]", "number | null"]));
  const init = {
    "number": ["0", "1.5", "k"],
    "string": ['"s"', '""'],
    "number[]": ["[]", "[k]"],
    "number | null": ["null", "3"],
  } as Record<string, any>;
  const fieldsOf = (text: string) =>
    range(count)
      .filter((x: any) => types[x] === text)
      .map((x: any) => x) || null;
  const numberFields = fieldsOf("number") || [];
  const stringFields = fieldsOf("string") || [];
  const listFields = fieldsOf("number[]") || [];
  const optionalFields = fieldsOf("number | null") || [];
  const operations: string[] = [];
  for (const x of draws.sample(numberFields, Math.min(3, numberFields.length))) {
    operations.push(...[`o.p${x} += i;`, `s += o.p${x};`, `o.p${x}++;`, `o.p${x} = -0;`]);
  }
  for (const x of draws.sample(stringFields, Math.min(2, stringFields.length))) {
    operations.push(...[`o.p${x} += i;`, `s += o.p${x}.length;`]);
  }
  for (const x of draws.sample(listFields, Math.min(2, listFields.length))) {
    operations.push(...[`o.p${x}.push(i);`, `s += o.p${x}[i] ?? 0.5;`, `o.p${x} = [...o.p${x}, i];`]);
  }
  for (const x of draws.sample(optionalFields, Math.min(2, optionalFields.length))) {
    operations.push(...[`o.p${x} = o.p${x} === null ? i : null;`, `s += o.p${x} ?? 2;`]);
  }
  operations.push(
    ...[
      "gc();",
      "keep.push(o);",
      "o = new K(i);",
      draws.next() < 0.15 ? "if (i === 2) Object.freeze(o);" : "s += 1;",
      "s += o.sum();",
      "const { p0, ...rest } = o; s += Object.keys(rest).length;",
      "o = Object.assign(new K(1), o);",
      "s += JSON.stringify(o).length;",
    ],
  );
  const deeds = draws.sample(operations, Math.min(operations.length, draws.between(3, 6)));
  const text = `function t${at}(k: number, n: number): any { class K { ${range(count)
    .map((x: any) => `p${x}: ${types[x]} = ${pick(init[types[x]])};`)
    .join(
      " ",
    )} constructor(k: number) { ${numberFields.length ? `this.p${numberFields[0]} = k;` : ""} } sum(): number { return ${[...["0"], ...numberFields.slice(0, 5).map((x: any) => `this.p${x}`)].join(" + ")}; } } let s = 0; let o = new K(k); const keep: K[] = []; for (let i = 0; i < n; i++) { ${deeds.join(" ")} } return [s, o, keep.length, keep[0]?.sum()]; }
`;
  return [text, [0, 1, 4].map((x: any) => `t${at}(${pick([0, 1.5, -1])}, ${x})`)];
}
const families = [writeViews, writeViews, writeViews, writeTexts, writeTexts, writeBigInts, writeLists, writeLists, writeRecords, writeParameters, writeSwitches, writeClasses]; // prettier-ignore

/** A function and its calls. */
export function writeTypedEdge(drawn: Draws, at: number): { name: string; text: string; calls: string[] } {
  draws = drawn;
  const family = pick(families);
  const [text, calls] = family(at);
  return { name: family.name.slice("write".length).toLowerCase(), text, calls };
}
