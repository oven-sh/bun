// Writes functions on what generators seldom draw: odd keys, texts of odd characters, lists at their ends, views that shrink, grow and go, times at their bounds, big integers, objects of many fields, functions of many parameters, wide control flow, formats of numbers, collections under the collector.
// For write-random-rare-value-sweep.ts.
import { Draws } from "./draw-by-seed.ts";

let draws = new Draws(0);
const pick = <T>(from: readonly T[]): T => draws.pick(from);
const many = <T>(from: readonly T[], least: number, most: number): T[] =>
  draws.several(draws.between(least, most), () => pick(from));
const range = (from: number, to?: number, step = 1): number[] =>
  to === undefined
    ? range(0, from)
    : Array.from({ length: Math.max(0, Math.ceil((to - from) / step)) }, (_, at) => from + at * step);

const edgeNumbers = ["0", "-0", "1", "-1", "2", "3", "7", "0.5", "-1.5", "1.5", "31", "32", "33", "255", "256", "65535", "65536", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967294", "4294967295", "4294967296", "9007199254740991", "9007199254740992", "9007199254740994", "-9007199254740992", "9223372036854775807", "9223372036854775808", "18446744073709551616", "5e-324", "-5e-324", "2.2250738585072014e-308", "1.7976931348623157e308", "Infinity", "-Infinity", "NaN", "1e21", "1e-7", "123456789012345680000", "0.1", "1e300"]; // prettier-ignore
const positions = ["0", "1", "2", "3", "5", "-1", "k", "n", "i"]; // prettier-ignore
const oddKeys = ['"4294967294"', '"4294967295"', '"4294967296"', '"-0"', '"0"', '"1"', '"2"', '"-1"', '"01"', '"1e3"', '"1.5"', '"9007199254740993"', '"Infinity"', '"NaN"', '""', '"\\ud800"', '"\\udc00"', '"__proto__"', '"constructor"', '"length"', '"2147483647"', '"2147483648"', '"toString"', '"a"', '"b"', '"valueOf"', "-0", "2 ** 31", "2 ** 32 - 2", "2 ** 32 - 1", "2 ** 32", "1.5", "NaN", "Infinity", "-1", "2 ** 53", "0", "1", "2", "true", "null", "undefined", "k", "n", "String(k)", "SYM"]; // prettier-ignore
const oddTexts = ['"\\ud83d"', '"\\ude00"', '"\\ud83d\\ude00"', '"a"', '"abc"', '""', '"\\u0100"', '"\\u00ff"', '"ß"', '"ı"', '"İ"', '"ŉ"', '"e\\u0301"', '"é"', '"\\u0000"', '"x\\u0000y"', '"\\uffff"', '" \\t\\n"', '"\\ufeff1"', '"0"', '"-0"', '"10"', '"abcdefghijklmnopqrstuvwxyz0123456789"', '"ab".repeat(n)', '"\\ud800".repeat(k)', "String(k)", "s", "s", "t"]; // prettier-ignore
const bigIntegers = ["0n", "1n", "-1n", "2n", "3n", "-7n", "2n ** 31n", "2n ** 32n", "2n ** 53n + 1n", "2n ** 62n", "2n ** 63n - 1n", "2n ** 63n", "-(2n ** 63n)", "-(2n ** 63n) - 1n", "2n ** 64n - 1n", "2n ** 64n", "2n ** 65n + 3n", "-(2n ** 64n)", "10n ** 30n", "BigInt(k)", "BigInt(n)", "b", "b", "c"]; // prettier-ignore
const instants = ["8.64e15", "-8.64e15", "8.64e15 + 1", "0", "-1", "1", "NaN", "1710054000000", "1710054000000 + k * 3600000", "1730608200000", "1730604600000", "951782400000", "-62198755200000", "253402300800000", "1e12 + 0.5", "-0", "4102444800000", "k", "n * 86400000", "68256000000"]; // prettier-ignore
const viewTypes = ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "Float16Array", "BigInt64Array", "BigUint64Array"]; // prettier-ignore

function writeKeys(): string[] {
  const o = pick([
    "{} as any",
    "[] as any",
    "[1, 2, 3] as any",
    '{ a: 1, "0": 2, "-1": 3 } as any',
    "Object.create(null)",
    "new Map() as any",
    "[1.5, , 2] as any",
    '{ "4294967295": 1, "1": 2, b: 3, "-0": 4 } as any',
    "new Uint8Array(3) as any",
    'Object.create({ a: 5, "1": 6 }) as any',
    '"abc" as any',
    "function q() {} as any",
  ]);
  const isMap = o.includes("Map");
  const lines: string[] = [`const o = ${o};`];
  const keyList = "const ks: any[] = [" + many(oddKeys, 3, 9).join(", ") + "];";
  lines.push(keyList);
  let operations: any = [
    "o[key] = k + 1",
    "o[key]",
    "key in Object(o)",
    "Object.hasOwn(Object(o), key)",
    "delete o[key]",
    "o[key] ??= n",
    "(o[key] = (o[key] ?? 0) + 1)",
    "o?.[key]",
    "Reflect.get(Object(o), key)",
    "typeof o[key]",
    "Object.getOwnPropertyDescriptor(Object(o), key)?.value",
    "o.propertyIsEnumerable?.(key)",
  ];
  if (isMap) {
    operations = [
      "o.set(key, k)",
      "o.get(key)",
      "o.has(key)",
      "o.delete(key)",
      "o.size",
      "o.set(key, (o.get(key) ?? 0) + 1) && o.get(key)",
    ];
  }
  lines.push(
    "for (const key of ks) { " +
      many(operations, 2, 4)
        .map((x: any) => `p(tr(() => ${x}));`)
        .join(" ") +
      " }",
  );
  if (!isMap) {
    lines.push(
      pick([
        "p(Object.keys(Object(o)));",
        "for (const z in Object(o)) p(z);",
        "p(tr(() => (o?.length > 1e5 ? 0 : JSON.stringify(o))));",
        "p(Object.entries(Object(o)).length, o.length);",
        "p(tr(() => ({ ...o })));",
        "p(Reflect.ownKeys(Object(o)).map(String));",
      ]),
    );
  } else {
    lines.push('p([...o.keys()].map(x => Object.is(x, -0) ? "-0" : String(x)));');
  }
  return lines;
}
function writeTexts(): string[] {
  const lines: string[] = [
    `let s: string = ${pick(oddTexts.slice(0, 17))}; let t: string = ${pick(oddTexts.slice(0, 19))}; let i = n;`,
  ];
  const text = () => pick(oddTexts);
  const number = () =>
    pick([...positions, ...["s.length", "s.length - 1", "t.length", "-2", "100", "NaN", "Infinity"]]);
  function operation(): string[] {
    return pick([
      `s.charCodeAt(${number()})`,
      `s.codePointAt(${number()})`,
      `s.at(${number()})`,
      `s[${number()}]`,
      `s.slice(${number()}, ${number()})`,
      `s.substring(${number()}, ${number()})`,
      `s.indexOf(${text()})`,
      `s.lastIndexOf(${text()})`,
      `s.includes(${text()}, ${number()})`,
      `s.startsWith(${text()}, ${number()})`,
      `s.endsWith(${text()})`,
      `s.split(${pick(['""', text()])})`,
      `s.replace(${text()}, ${pick(['"$&$&"', '"$`"', '"$\'"', '"$$"', "(m: string) => m + m", text()])})`,
      `s.replaceAll(${text()} || "q", ${text()})`,
      `s.normalize("${pick(["NFC", "NFD", "NFKC"])}")`,
      "(s as any).toWellFormed()",
      "(s as any).isWellFormed()",
      "s.toUpperCase()",
      "s.toLowerCase()",
      "s.trim()",
      `s.padStart(${pick(["3", "n", "k", "10"])}, ${text()})`,
      `s.padEnd(${pick(["3", "n", "k", "10"])}, ${text()})`,
      `s < ${text()}`,
      `s === ${text()}`,
      "s >= t",
      `s.localeCompare(${text()})`,
      "[...s].length",
      "[...s]",
      "Array.from(s)",
      "encodeURIComponent(s)",
      "new TextEncoder().encode(s).length",
      "[...new TextEncoder().encode(s)]",
      "new TextDecoder().decode(new TextEncoder().encode(s))",
      "JSON.stringify(s)",
      "JSON.stringify({ [s]: t })",
      "parseInt(s)",
      "Number(s)",
      "+s",
      "s.search(/[\\ud800-\\udfff]/)",
      "s.match(/./gu)?.length",
      "s.match(/./g)?.length",
      "s.concat(t, s)",
      "`${s}${t}${k}`",
      `s.repeat(${pick(["0", "1", "2", "n"])})`,
      "String.fromCharCode(s.charCodeAt(0))",
      "String.fromCodePoint(s.codePointAt(0) ?? 65)",
      'Buffer.from(s).toString("hex")',
      'Buffer.from(s, "latin1").toString("latin1")',
      'Buffer.from(s, "utf16le").length',
      "escape(s)",
      "s.length",
      "new Set(s).size",
      'Object.keys({ [s]: 1, [t]: 2, "1": 3 })',
    ]);
  }
  const grow = [
    "s += t",
    's += "\\u0100"',
    's += "a"',
    "s += s.length",
    "s = t + s",
    "s += String.fromCharCode(0xd800 + i)",
    's += s[i] ?? "z"',
    "s = s.slice(1) + t",
    "[s, t] = [t, s]",
    "t += i",
    's += i % 3 === 0 ? "\\u0100" : "q"',
    "t = s.slice(0, 2)",
    "s = `${t}${i}`",
    's += "\\ud83d"; s += "\\ude00"',
    's = [...s].reverse().join("")',
    's = s.split("").reverse().join("")',
  ];
  lines.push(
    "for (let i = 0; i < n; i++) { " +
      range(draws.between(1, 3))
        .map((_: any) => pick(grow) + ";")
        .join(" ") +
      " if (s.length > 400) s = s.slice(0, 9); if (t.length > 200) t = t.slice(0, 7); p(tr(() => " +
      operation() +
      ")); }",
  );
  lines.push(...range(draws.between(2, 5)).map((_: any) => `p(tr(() => ${operation()}));`));
  return lines;
}
function writeLists(): string[] {
  const a = pick([
    "[1, 2, 3]",
    "[1.5, 2.5]",
    '["a", "b"]',
    "[1, , 3]",
    "[]",
    "new Array(5)",
    "new Array(4294967295)",
    '[1, "x", {}]',
    "Array.from({ length: 5 }, (_, i) => i)",
    "Object.freeze([1, 2, 3])",
    "Object.seal([1, 2, 3])",
    "Object.preventExtensions([1, 2, 3])",
    'Object.defineProperty([1, 2, 3], "length", { writable: false })',
    "new (class A extends Array { last() { return this[this.length - 1]; } })()",
    'Object.setPrototypeOf([1, , 3], { __proto__: Array.prototype, 1: "proto" })',
    "Object.defineProperty([1, 2, 3], 1, { get() { return 42; }, configurable: true })",
    "[-0, NaN, 0]",
    "[[1], [2]]",
  ]);
  const position = () =>
    pick([
      "0",
      "1",
      "-0",
      '"1"',
      "a.length",
      "a.length - 1",
      "2 ** 31",
      "2 ** 31 - 1",
      "2 ** 32 - 2",
      "2 ** 32 - 1",
      "2 ** 32",
      "-1",
      "1.5",
      "NaN",
      "k",
      "n",
      "i",
      "i + 1000",
      "i * 3",
    ]);
  const value = () =>
    pick(["i", "0.5", '"s"', "undefined", "null", "-0", "NaN", "k", "({} as any)", "2 ** 31", "a[0]", "i * 1.5"]);
  const operations = [
    () => `a[${position()}] = ${value()}`,
    () => `a[${position()}]`,
    () => `a.push(${value()})`,
    () => "a.pop()",
    () => "a.length < 50 ? a.shift() : 0",
    () => `a.length < 50 ? a.unshift(${value()}) : 0`,
    () => `a.length = ${pick(["0", "1", "2", "3", "5", "2 ** 32 - 1", "2 ** 32", "-1", "1.5", "2 ** 31"])}`,
    () => `a.length < 50 ? a.indexOf(${value()}, ${pick(["0", "-1", "a.length - 2"])}) : 0`,
    () => `${position()} in a`,
    () => `delete a[${position()}]`,
    () => `a.at(${position()})`,
    () => "Object.keys(a).slice(0, 12)",
    () => `a.length < 50 ? a.splice(${pick(["0", "1", "-1"])}, ${pick(["0", "1", "2"])}, ${value()}) : 0`,
    () => "a.length",
    () => "Object.freeze(a) && 1",
    () => "Object.isFrozen(a)",
    () => `Object.hasOwn(a, ${position()})`,
    () => "a.length < 50 ? a.slice().reverse() : 0",
    () => "a.length < 50 ? a.map((x: any) => x) : 0",
    () => 'a.length < 50 ? a.reduce((x: any, y: any) => String(x) + y, "") : 0',
    () => "a.length < 50 ? a.includes(undefined) : 0",
    () => "a.length < 50 ? [...a] : 0",
    () => "a.length < 50 ? a.fill(k) : 0",
    () => "a.length < 50 ? a.sort() : 0",
    () => "a.length < 50 ? a.flat() : 0",
    () => "a.length < 50 ? a.join() : 0",
    () => `a.length < 50 ? a.with?.(${pick(["0", "1"])}, ${value()}) : 0`,
    () => `a.length < 50 ? a.findLast((x: any) => x === ${value()}) : 0`,
    () => "a.length < 50 ? a.concat([1, , 2]).length : 0",
    () => "a.length < 50 ? a.copyWithin(0, 1) : 0",
    () => "a.length < 50 ? a.toSorted?.() : 0",
    () => "a.length < 50 ? JSON.stringify(a) : 0",
    () => "Object.getOwnPropertyNames(a).length",
  ];
  const lines: string[] = [`const a: any = ${a}; let i = 0;`];
  lines.push(
    "for (; i < n; i++) { " +
      range(draws.between(2, 5))
        .map((_: any) => `p(tr(() => ${pick(operations)()}));`)
        .join(" ") +
      " }",
  );
  lines.push(
    "if (a.length < 100) for (let j = 0; j < a.length; j++) p(a[j]); else { let c = 0; for (const z in a) { p(z, a[z]); if (++c > 20) break; } }",
  );
  return lines;
}
function writeViews(): string[] {
  const type = pick(viewTypes);
  const isBig = type.startsWith("Big");
  const mode = draws.below(6);
  const lines: string[] = [];
  const size = type.includes("64") ? 8 : type.includes("32") ? 4 : type.includes("16") ? 2 : 1;
  const number = () => (isBig ? pick(bigIntegers) : pick([...edgeNumbers, ...["i", "k", "v[0]!", "i * 0.75", "-i"]]));
  lines.push("let b = 5n, c = -3n; let i = 0;");
  if (mode === 0) {
    lines.push(
      `const buf: any = new (ArrayBuffer as any)(32, { maxByteLength: 96 }); const v: any = new (globalThis as any).${type}(buf);`,
    );
  } else if (mode === 1) {
    lines.push(
      `const buf: any = new (ArrayBuffer as any)(32, { maxByteLength: 96 }); const v: any = new (globalThis as any).${type}(buf, ${size}, ${pick([1, 2, 3])});`,
    );
  } else if (mode === 2) {
    lines.push(
      `const buf: any = new (SharedArrayBuffer as any)(32, { maxByteLength: 96 }); const v: any = new (globalThis as any).${type}(buf);`,
    );
  } else if (mode === 3) {
    lines.push(
      `const buf: any = new ArrayBuffer(32); const v: any = new (globalThis as any).${type}(buf, ${pick([0, size])});`,
    );
  } else if (mode === 4) {
    lines.push(
      `const v: any = new (globalThis as any).${type}(${pick(["n", "k", "5", isBig ? "[]" : "[1, 2, 3]", "0"])}); const buf: any = v.buffer;`,
    );
  } else {
    lines.push(
      `const buf: any = new ArrayBuffer(40); const v: any = new (globalThis as any).${type}(buf).subarray(${pick([0, 1])}, ${pick([2, 3, 9])});`,
    );
  }
  const position = () =>
    pick([
      "0",
      "1",
      "2",
      "3",
      "i",
      "k",
      "n",
      "-1",
      "v.length",
      "v.length - 1",
      "1.5",
      '"1"',
      '"-0"',
      "-0",
      "NaN",
      "2 ** 31",
      "2 ** 32",
      "2 ** 53",
    ]);
  const resizes = [
    `buf.resize?.(${pick([0, 8, 16, 24, 32, 64, 96])})`,
    `buf.grow?.(${pick([32, 64, 96])})`,
    "(buf.transfer && i === 1 ? buf.transfer() : 0, 1)",
    "structuredClone(buf, { transfer: buf instanceof ArrayBuffer && i === 2 ? [buf] : [] }).byteLength",
    "0",
    "0",
  ];
  const operations = [
    () => `v[${position()}] = ${number()}`,
    () => `v[${position()}]`,
    () => "v.length",
    () => "v.byteOffset",
    () => "buf.byteLength",
    () => `${position()} in v`,
    () => `v.fill(${number()}, ${pick(["0", "1", "-2"])})`,
    () => `v.set([${number()}, ${number()}], ${pick(["0", "1"])})`,
    () => "[...v]",
    () => `v.at(${position()})`,
    () => "v.subarray(1).length",
    () => "v.slice(0, 2)",
    () => `v.indexOf(${number()})`,
    () => `v.includes(${number()})`,
    () => "v.copyWithin(0, 1)",
    () => "v.slice().sort()",
    () => "v.slice().reverse()",
    () => "v.join()",
    () => "Object.keys(v).length",
    () => `v[${position()}]++`,
    () =>
      `v[${position()}] ${pick(["+=", "-=", "*=", "|=", "^="])} ${isBig ? "1n" : pick(["1", "0.5", "k", "2 ** 31"])}`,
    () => `(v[${position()}] = ${number()}) `,
    () => "v.map((x: any) => x)",
    () => "v.reduce((x: any, y: any) => x + y, v[0] ?? 0)",
    () =>
      `new DataView(buf, ${pick([0, 1, 3])}).${pick(["getInt8", "getUint16", "getInt32", "getUint32", "getFloat32", "getFloat64", "getBigInt64", "getBigUint64"])}(${pick(["0", "1", "3", "i", "k", "24", "29", "-1"])}, ${pick(["true", "false"])})`,
    () =>
      `new DataView(buf, ${pick([0, 1])}).${pick(["setInt8", "setUint16", "setInt32", "setUint32", "setFloat32", "setFloat64"])}(${pick(["0", "1", "3", "i", "24", "29"])}, ${pick(edgeNumbers)}, ${pick(["true", "false"])})`,
    () => `Object.hasOwn(v, ${position()})`,
    () => `delete v[${position()}]`,
  ];
  lines.push(
    "for (; i < n; i++) { " +
      range(draws.between(2, 4))
        .map((_: any) => `p(tr(() => ${pick(operations)()}));`)
        .join(" ") +
      ` p(tr(() => ${pick(resizes)})); ` +
      range(draws.between(1, 3))
        .map((_: any) => `p(tr(() => ${pick(operations)()}));`)
        .join(" ") +
      " }",
  );
  lines.push(
    pick([
      "let sum: any = 0; for (let j = 0; j < v.length; j++) sum = sum + String(v[j]); p(sum);",
      "let j2 = 0; for (const x of v) { if (j2++ === 1) tr(() => buf.resize?.(16)); p(x); }",
      "p(v.length, buf.byteLength, [...v]);",
      `for (let j = 0; j < 6; j++) { v[j] = ${number()}; p(v[j]); }`,
    ]),
  );
  return lines;
}
function writeDates(): string[] {
  const instant = () => pick(instants);
  const lines: string[] = [`const d = new Date(${instant()}); let i = 0;`];
  const operations = [
    () => `d.setTime(${instant()})`,
    () => "d.getTime()",
    () => "d.toISOString()",
    () => "d.toJSON()",
    () => "String(d)",
    () => "d.toUTCString()",
    () => "d.getTimezoneOffset()",
    () => "[d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getDay()]",
    () => `d.setMonth(d.getMonth() + ${pick(["1", "-1", "13", "k", "n", "1.5"])})`,
    () => `d.setDate(${pick(["0", "31", "32", "-1", "k", "NaN"])})`,
    () => `d.setHours(${pick(["24", "-1", "k", "2"])}, ${pick(["0", "30", "61"])})`,
    () => `d.setFullYear(${pick(["1970", "275760", "-271821", "2024", "0", "k"])})`,
    () =>
      `Date.UTC(${pick(["2024", "0", "99", "100", "275760", "k", "NaN"])}, ${pick(["0", "11", "12", "-1"])}, ${pick(["1", "0", "29", "31"])})`,
    () =>
      `new Date(${pick(["2024", "99", "0", "1900"])}, ${pick(["2", "10", "1"])}, ${pick(["10", "3", "29"])}, ${pick(["2", "1", "3"])}, 30).getTime()`,
    () =>
      `Date.parse(${pick(['"2024-02-30"', '"2024-03-10T02:30"', '"2024-03-10T02:30:00Z"', '"+275760-09-13T00:00:00.000Z"', '"+275760-09-13T00:00:00.001Z"', '"-000000-01-01T00:00:00Z"', '"2024"', '"2024-1-1"', '"Mar 10 2024 02:30"', '"1/2/99"', '"2024-01-01T24:00:00Z"', '""', '"2024-01-01T00:00:00.123456789Z"', "String(d)"])})`,
    () => "new Date(d.getTime() + i * 1800000).getHours()",
    () => "d.valueOf() === +d",
    () => "d < new Date(0)",
    () => "(d as any) - 1",
    () => 'd + ""',
    () => "JSON.stringify({ d })",
    () => 'd.toLocaleDateString("en-US", { timeZone: "UTC" })',
    () => 'd[Symbol.toPrimitive]("number")',
    () => "new Date(d).getTime()",
    () => "new Date(NaN).getDay()",
    () => "d.setMilliseconds(1e9)",
    () => "d.setUTCSeconds(-1)",
  ];
  lines.push(
    "for (; i < n; i++) { " +
      range(draws.between(3, 6))
        .map((_: any) => `p(tr(() => ${pick(operations)()}));`)
        .join(" ") +
      " }",
  );
  return lines;
}
function writeBigInts(): string[] {
  const big = () => pick(bigIntegers);
  const lines: string[] = [
    `let b: any = ${pick(bigIntegers.slice(0, -5))}; let c: any = ${pick(bigIntegers.slice(0, -5))}; let i = 0;`,
  ];
  const shift = () =>
    pick(["0n", "1n", "31n", "32n", "63n", "64n", "65n", "-1n", "-64n", "100n", "BigInt(i)", "-BigInt(i)"]);
  const operations = [
    () => `b ${pick(["+", "-", "*", "/", "%", "&", "|", "^"])} ${big()}`,
    () => `b ${pick(["<<", ">>"])} ${shift()}`,
    () => `b ${pick(["<", "<=", ">", ">=", "===", "==", "!="])} ${pick([big(), pick(edgeNumbers), pick(edgeNumbers)])}`,
    () =>
      `BigInt.asIntN(${pick(["0", "1", "8", "31", "32", "53", "63", "64", "65", "128"])}, ${pick(["b", "c", big()])})`,
    () => `BigInt.asUintN(${pick(["0", "1", "8", "32", "53", "63", "64", "65"])}, ${pick(["b", "c", big()])})`,
    () => "-b",
    () => "~b",
    () => "Number(b)",
    () => `b.toString(${pick(["2", "10", "16", "36"])})`,
    () => `BigInt(${pick([...edgeNumbers, ...['"0x10"', '" 12 "', '"1.5"', '""', "true", "null"]])})`,
    () => "parseInt(String(b))",
    () => "typeof b",
    () => "b++",
    () => "--c",
    () => `(b as any) + ${pick(["1", '"s"', "i"])}`,
    () => `b ** ${pick(["0n", "1n", "2n", "3n", "-1n"])}`,
    () => "Math.max(Number(b), Number(c))",
    () => "!b",
    () => "b ? 1 : 0",
    () => "b === c",
    () => "[b, c, 0, 1.5].sort((x: any, y: any) => (x < y ? -1 : x > y ? 1 : 0))",
    () => "new Map([[b, 1]]).get(BigInt(String(b)))",
    () => "new Set([b, BigInt(String(b)), c]).size",
    () => "Object.is(b, BigInt(String(b)))",
    () => "JSON.stringify({ x: String(b) })",
    () => "+b",
    () => "b >>> (c as any)",
    () => 'b.toLocaleString("en-US")',
  ];
  const changes = [
    "b += 1n",
    "b *= 3n",
    "b = b - c",
    "b <<= 1n",
    "b >>= 1n",
    "b = BigInt.asIntN(64, b * 6364136223846793005n + 1n)",
    "b = BigInt.asUintN(64, b + c)",
    "b ^= c",
    "c = -c",
    "b %= 1000000007n",
    "[b, c] = [c, b]",
    "b = b / (c || 1n)",
    "b = b & 0xffffffffffffffffn",
    "c += BigInt(i)",
  ];
  lines.push(
    "for (; i < n; i++) { " +
      range(draws.between(1, 3))
        .map((_: any) => `tr(() => ${pick(changes)});`)
        .join(" ") +
      " if (b > 10n ** 60n || b < -(10n ** 60n)) b = 7n; " +
      range(draws.between(2, 4))
        .map((_: any) => `p(tr(() => ${pick(operations)()}));`)
        .join(" ") +
      " }",
  );
  return lines;
}
function writeObjects(): string[] {
  const size = draws.pick([3, 20, 63, 64, 65, 100, 127, 128, 129, 200]);
  const lines: string[] = [
    `const o: any = ${pick(["{}", "{ a: 1, b: 2 }", "Object.create(null)", "Object.create({ z: 9, get g() { return (this as any).x0; } })", "new (class K { a = 1; #p = 2; get p() { return this.#p; } })()", 'Object.create(new Proxy({ hid: 1 } as any, { get: (t, x) => typeof x === "string" && x.startsWith("y") ? "P" + x : (t as any)[x], has: (t, x) => x === "yes" }))'])}; let i = 0;`,
  ];
  lines.push(`for (; i < ${size}; i++) o["x" + i] = i;`);
  const position = () =>
    pick([
      '"x0"',
      '"x1"',
      `"x${size - 1}"`,
      `"x${size}"`,
      '"x" + (i % 7)',
      '"a"',
      '"z"',
      '"g"',
      '"y1"',
      '"yes"',
      '"hid"',
      "SYM",
      '"p"',
      "i",
      '"5"',
      '"__proto__"',
    ]);
  const field = () => pick([".x0", ".x1", ".x2", ".a", ".b", ".g", ".z", ".y3", ".hid", `.x${size - 1}`, ".p"]);
  const operations = [
    () => `o[${position()}]`,
    () => `o${field()}`,
    () => `o${field()} = i`,
    () => `o[${position()}] = i`,
    () => `delete o[${position()}]`,
    () => `${position()} in o`,
    () => "Object.keys(o).length",
    () => "Object.keys(o).slice(-3)",
    () => "JSON.stringify(o).length",
    () => "Object.freeze(o) && 0",
    () => 'Object.setPrototypeOf(o, { late: 1, g: 7, y3: "own" }) && 0',
    () => "Object.setPrototypeOf(o, null) && 0",
    () =>
      `Object.defineProperty(o, ${position()}, { get() { return 77; }, configurable: true, enumerable: true }) && 0`,
    () => `Object.defineProperty(o, ${position()}, { value: 78, writable: false, configurable: true }) && 0`,
    () => "({ ...o }).x1",
    () => "Object.entries(o).slice(0, 3)",
    () => '(() => { let r = ""; let c = 0; for (const z in o) { r += z; if (++c > 4) break; } return r; })()',
    () => `(o${field()} ?? 0) + 1`,
    () => `o${field()}++`,
    () => `o[${position()}]?.toString?.()`,
    () => "Object.getOwnPropertySymbols(o).length",
    () => "structuredClone({ ...o, p: 0 }).x0",
    () => "Object.assign({}, o).x2",
    () => "Reflect.ownKeys(o).length",
    () => "o.__proto__ === Object.prototype",
    () => "(o.__proto__ = { q5: 1 }) && o.q5",
  ];
  lines.push(
    "for (i = 0; i < n; i++) { " +
      range(draws.between(3, 6))
        .map((_: any) => `p(tr(() => ${pick(operations)()}));`)
        .join(" ") +
      " }",
  );
  return lines;
}
function writeFunctions(): string[] {
  const count = pick([3, 8, 16, 31, 32, 33, 40, 64, 70]);
  const parameters = range(count)
    .map((i: any) => `a${i}: any` + (i && draws.next() < 0.15 ? ` = ${pick(["1", "a0", "i0", "undefined"])}` : ""))
    .join(", ")
    .replaceAll("i0", "a0");
  const body = pick([
    `a0 + a${count - 1}`,
    `[a0, a${Math.floor(count / 2)}, a${count - 1}]`,
    "arguments.length",
    `arguments[${count - 1}]`,
    `arguments.length + String(a${count - 1})`,
    "Array.prototype.slice.call(arguments, -2)",
  ]);
  const lines: string[] = [
    `function w(${parameters}): any { ${pick(["", "a0 = 5;", 'if (a1 === 2) return "two";'])} return ${body}; } const W: any = w;`,
    "let i = 0;",
  ];
  lines.push(
    'const sl = new Function("a", "b", "a = 10; arguments[1] = 20; return [a, b, arguments[0], arguments.length].join()");',
  );
  const argumentsOf = size =>
    range(size)
      .map((_: any) => pick(["i", "k", "n", '"s"', "undefined", "1.5", "null"]))
      .join(", ");
  const operations = [
    () => `W(${argumentsOf(count)})`,
    () => `W(${argumentsOf(draws.between(0, 5))})`,
    () => `W(...Array.from({ length: ${count} }, (_, x) => x))`,
    () => `W(${argumentsOf(2)}, ...[k, n, i], ${argumentsOf(2)})`,
    () => `W.apply(null, { length: ${count}, 0: "z", ${count - 1}: i } as any)`,
    () => `W.call(${argumentsOf(count + 1)})`,
    () => `W.bind(null, ${argumentsOf(3)})(${argumentsOf(4)})`,
    () => "w.length",
    () => "(sl as any)(1, 2)",
    () => "sl(1)",
    () => `Math.max(...Array.from({ length: ${pick([0, 1, 2, 1000, 20000])} }, (_, x) => x % 97))`,
    () => `String.fromCharCode(...Array.from({ length: ${pick([0, 3, 300])} }, (_, x) => 65 + x % 26)).length`,
    () => "((...r: any[]) => r.length)(...[1, , 3], i)",
    () => "(function deep(x: number): number { return x <= 0 ? 0 : 1 + deep(x - 1); })(k * 100)",
    () =>
      "(() => { let z = 0; const f: any = () => { z++; f(); }; try { f(); } catch (e) { return (e as any).constructor.name + (z > 500); } })()",
    () =>
      "(((x: any, { y = x, ...r }: any = {}, [z = y, ...q]: any = [3]) => [x, y, z, r, q]) as any)(i, { y: undefined, u: 2 }, [undefined, 5, 6])",
    () => "(function (this: any) { return typeof this; }).call(i as any)",
    () => "new (function (this: any, a: any) { this.a = a; this.t = new.target !== undefined; } as any)(i).t",
    () => "(Reflect as any).construct(Array, [i], Map) instanceof Map",
    () => "((a: any, b: any = a, c: any = () => a + b) => { a = 9; return c(); })(i)",
    () => "((function f(this: any): any { return f.name; }) as any)()",
    () => "((function (a: any) { arguments[0] = 7; return a; }) as any)(i)",
  ];
  lines.push(
    "for (; i < n; i++) { " +
      range(draws.between(3, 6))
        .map((_: any) => `p(tr(() => ${pick(operations)()}));`)
        .join(" ") +
      " }",
  );
  return lines;
}
function writeControl(): string[] {
  const r = draws.below(6);
  if (r === 0) {
    const size = pick([5, 40, 255, 256, 257, 300]);
    const field = pick(["", "'s' + "]);
    const label = x => (field ? `'s${x}'` : String(x));
    const cases = draws
      .sample(range(size * 2), size)
      .map(
        (x: any) =>
          `case ${label(x)}: r += ${draws.between(1, 99)}; ${pick(["break;", "break;", "return r;", "", "continue;"])}`,
      )
      .join(" ");
    return [
      `function sw(m: number): any { let r = 0; for (let i = 0; i < m; i++) { switch (${field}(i * ${pick([1, 3, 7])} % ${size * 2})) { ${cases} default: r -= 1; } r = r * 2 % 1000003; } return r; }`,
      `for (const m of [0, 1, 2, k, n, ${size}]) p(tr(() => sw(m)));`,
      `p(tr(() => sw(${pick(edgeNumbers.slice(0, 12))})));`,
    ];
  }
  if (r === 1) {
    const d = draws.between(3, 12);
    let t: any = "";
    for (const x of range(d)) {
      t +=
        `try { if (i === ${x} + k) throw new ${pick(["Error", "TypeError", "RangeError"])}("t${x}"); r += ${x}; ` +
        pick(["", "if (i % 5 === 4) continue outer;", "if (i > 9) break outer;", 'if (i === 7) return "R" + r;']);
    }
    t += 'r += "|";';
    for (const x of range(d - 1, -1, -1)) {
      t += ` } ${pick([`catch (e: any) { r += e.message; ${pick(["", "if (i === 3) throw e;", "continue;"])} }`, `finally { r += "f${x}"; ${pick(["", "", "if (i === 11) break outer;"])} }`, `catch { r += "c"; } finally { r += "F${x}"; }`])}`;
    }
    return [
      'function nest(m: number): any { let r: any = ""; outer: for (let i = 0; i < m; i++) { for (let j = 0; j < 2; j++) { ' +
        t +
        " } } return r; }",
      "for (const m of [0, 1, 2, 5, 13]) p(tr(() => nest(m)));",
    ];
  }
  if (r === 2) {
    const [lo, hi, step] = pick([
      ["2147483645", "2147483650", "1"],
      ["-2147483650", "-2147483645", "1"],
      ["2 ** 53 - 3", "2 ** 53 + 2", "1"],
      ["4294967293", "4294967299", "1"],
      ["0", "2 ** 31 + 5", "2 ** 29"],
      ["-(2 ** 31)", "2 ** 31", "2 ** 30"],
      ["0", "1", "0.1"],
      ["5", "-5", "-1"],
      ["0", "-1", "1"],
      ["NaN", "5", "1"],
      ["0", "NaN", "1"],
      ["-0", "3", "1"],
      ["0", "Infinity", "2 ** 1020"],
      ["2 ** 52", "2 ** 52 + 3", "0.5"],
      ["1e16", "1e16 + 10", "1"],
    ]);
    const cond = step === "-1" ? ">" : "<";
    const use = pick([
      "s = (s + i) % 1000003",
      "s += i | 0",
      "s ^= i",
      "s = Math.imul(s + 1, i)",
      "s += i >>> 0",
      "s += a[i % 4]! ?? 1",
      "s += i % 3 === 0 ? 1 : 2",
      "s += String(i).length",
      "s = (s << 1) ^ (i >>> 3)",
      "s += i & 1",
      "s += Math.floor(i / 2) % 7",
    ]);
    return [
      "const a = [1, 2, 3, 4];",
      `function lp(lo: any, hi: any, step: any): any { let s = 0, c = 0; for (let i = lo; i ${cond} hi; i += step) { if (c++ > 40) break; ${use}; } return [s, c]; }`,
      `p(tr(() => lp(${lo}, ${hi}, ${step})));`,
      `{ let s = 0, c = 0; for (let i = ${lo}; i ${cond} ${hi}; i += ${step}) { if (c++ > 40) break; ${use}; } p(s, c); }`,
      `{ let s = 0, c = 0, i = ${lo}; while (c < 9) { ${use}; i++; c++; } p(s, i); }`,
      `{ let s = 0, c = 0; let i = ${lo}; do { ${use}; } while ((i += ${step}) ${cond} ${hi} && c++ < 30); p(s, i, c); }`,
    ];
  }
  if (r === 3) {
    return [
      'function* g(m: number): any { try { for (let i = 0; i < m; i++) { const got = yield i; if (got) p("got", got); } return "end"; } finally { p("fin"); } }',
      pick([
        "for (const x of g(5)) { if (x === k) break; p(x); }",
        "const [x0, , x2 = 9, ...xs] = g(n); p(x0, x2, xs);",
        'const it = g(3); p(it.next(), it.next("v"), it.return(8), it.next());',
        'const it = g(3); it.next(); p(tr(() => it.throw(new Error("th"))));',
        "p(tr(() => Math.max(...g(n))));",
        "l: for (const a of g(3)) for (const b of g(3)) { if (b === 1) continue l; if (a === 2) break l; p(a, b); }",
        "p(new Map([...g(3)].map(x => [x, x])).size, Array.from(g(2), x => x * 2), Object.fromEntries([...g(2)].map(x => [x, 1])));",
      ]),
      'const di = { [Symbol.iterator]() { let z = 0; return { next: () => ({ done: z > 3, value: z++ }), return(v: any) { p("ret", z); return { done: true, value: v }; } }; } };',
      pick([
        "const [q1, q2] = di as any; p(q1, q2);",
        "for (const q of di as any) { if (q === 2) break; p(q); }",
        'p(tr(() => { for (const q of di as any) throw new Error("in" + q); }));',
        "p([...(di as any)], Math.min(...(di as any)));",
        "const [...all] = di as any; p(all);",
        'p(tr(() => { const [z = (() => { throw new Error("d"); })()] = [undefined, ...(di as any)]; return z; }));',
      ]),
    ];
  }
  if (r === 4) {
    return [
      'let log = ""; const it = async (x: any) => { log += "<" + x; await 0; log += x + ">"; return x; };',
      'async function* ag(m: number) { try { for (let i = 0; i < m; i++) { yield await it(i); } } finally { log += "F"; } }',
      pick([
        "(async () => { for await (const x of ag(n)) { if (x === 2) break; p(x); } p(log); })();",
        "Promise.all([it(1), it(2), it(k)]).then(v => p(v, log));",
        '(async () => { try { await Promise.any([Promise.reject(1), it(3)]).then(p); await Promise.reject(new Error("rj")); } catch (e: any) { p(e.message, log); } finally { p("z"); } })();',
        'Promise.race([it(1), Promise.reject(2).catch(x => x + 1)]).then(v => p(v, log)); queueMicrotask(() => p("mt", log));',
        '(async () => { const r = await Promise.allSettled([it(1), Promise.reject(5), (async () => { throw "t"; })()]); p(r); })(); p("sync");',
        '(async () => { const g = ag(4); p(await g.next(), await g.return("rv" as any), await g.next(), log); })();',
      ]),
    ];
  }
  return [
    `function wl(m: number): any { const r: any[] = []; let i = m; w: while (true) { i${pick(["--", "++"])}; if (i < -3 || i > 9) break; switch (i % 3) { case 0: continue w; case 1: r.push(i); break; case -1: r.push("n"); default: if (r.length > 4) break w; r.push(r.length); } } return r; }`,
    "for (const m of [0, 1, 2, -1, k, n]) p(tr(() => wl(m)));",
  ];
}
function writeFormats(): string[] {
  const number = () => pick(edgeNumbers);
  const lines: string[] = ["let i = 0;", `const xs: any[] = [${many(edgeNumbers, 4, 10).join(", ")}];`];
  const operations = [
    () => `x.toFixed(${pick(["0", "1", "2", "20", "100", "101", "k"])})`,
    () => `x.toPrecision(${pick(["1", "2", "17", "100", "k"])})`,
    () => `x.toExponential(${pick(["", "0", "5", "20"])})`,
    () => `x.toString(${pick(["2", "3", "8", "16", "32", "36", "10", "1"])})`,
    () => "String(x)",
    () => "parseInt(String(x))",
    () => `parseInt(x, ${pick(["2", "10", "16", "36", "0"])})`,
    () => 'parseFloat(x + "e2")',
    () => `Number(${pick(['"0x" + i', '" " + x', '"1_0"', 'x + "n"', '"0b" + i', '"\\ufeff" + x'])})`,
    () =>
      `Math.${pick(["fround", "clz32", "sign", "trunc", "round", "floor", "ceil", "abs", "sqrt", "cbrt", "log2", "log1p", "expm1", "f16round"])}(x)`,
    () => `Math.${pick(["max", "min", "hypot", "imul", "pow", "atan2"])}(x, ${number()})`,
    () => `x ${pick(["+", "-", "*", "/", "%", "**"])} ${number()}`,
    () => `x ${pick(["|", "&", "^", "<<", ">>", ">>>"])} ${pick(["0", "1", "31", "32", "33", "-1", "k", "x"])}`,
    () => `x ${pick(["<", "<=", ">", ">=", "==", "==="])} ${number()}`,
    () => "Object.is(x, -x)",
    () => "~x",
    () => "-x",
    () => "~~x",
    () => "x | 0",
    () => "x >>> 0",
    () => "(x >> 1) + (x >>> 31)",
    () => "Number.isInteger(x)",
    () => "Number.isSafeInteger(x)",
    () => 'x.toLocaleString("en-US")',
    () => "JSON.stringify([x, { x }])",
    () => "1 / x",
    () => "x++",
    () => "[x].includes(NaN)",
    () => "[x].indexOf(x)",
    () => "new Set([x, -x, NaN]).size",
    () => "new Float32Array([x])[0]",
    () => "new Int32Array([x])[0]",
    () => "new Uint8ClampedArray([x])[0]",
    () => "Math.round(x * 100) / 100",
    () => "x % 1",
    () => "Math.floor(x / 2) * 2 === x",
    () => 'x ? "t" : "f"',
    () => "`${x}`.length",
    () => `(x + ${number()}) | 0`,
    () => `Math.abs(x - ${number()}) < 1e-9`,
    () => "isNaN(x - x)",
  ];
  lines.push(
    "for (let x of xs) { " +
      range(draws.between(3, 6))
        .map((_: any) => `p(tr(() => ${pick(operations)()}));`)
        .join(" ") +
      " }",
  );
  lines.push(
    "const hx = (x: number, y: number) => " +
      pick([
        `(x ${pick(["+", "-", "*", "%", "/"])} y) ${pick(["| 0", ">>> 0", "% 7", "& 255", "+ 0.5", ">> 3"])}`,
        "Math.imul(x, y) ^ (x + y)",
        "x > y ? x - y : y - x",
        "(x * 31 + y) | 0",
        "(x << 5) - x + y",
        "x === y ? 0 : x < y ? -1 : 1",
      ]) +
      "; for (; i < n; i++) p(hx(xs[i % xs.length], " +
      number() +
      "), hx(i, " +
      number() +
      "));",
  );
  return lines;
}
function writeCollections(): string[] {
  const lines: string[] = ["const keep: any[] = []; let i = 0; const gc = () => (globalThis as any).Bun.gc(true);"];
  const made = () =>
    pick([
      '{ a: i, b: "t" + i }',
      '[i, i + 0.5, "x" + i]',
      "(() => { const z = { i }; return () => z.i; })()",
      'new Map([[i, { i }], ["k", [i]]] as any)',
      '("s" + i).repeat(5)',
      "BigInt(i) ** 40n",
      "new Date(i * 1e9)",
      "new (class Q { #v = { i }; get v() { return this.#v.i; } })()",
      "Object.create({ up: { i } })",
      "Array.from({ length: 20 }, (_, x) => ({ x }))",
      "new Float64Array(8).fill(i)",
      '[..."abc"].map(x => x + i)',
      "{ get lazy() { return { i }; } }",
      '/a(b)/.exec("xab" + i)',
      "new Set([{ i }, i])",
      'Symbol("s" + i)',
      "new WeakMap([[keep, { i }]])",
      "Promise.resolve({ i })",
      "(function* () { yield { i }; yield i; })()",
      'new Error("e" + i)',
      '{ ["k" + i]: i, ...{ z: { i } } }',
    ]);
  const use = [
    'typeof x === "function" ? x() : typeof x',
    "x?.a ?? x?.length ?? x?.size",
    "x?.v",
    "x?.up?.i",
    "x?.lazy?.i",
    "Array.isArray(x) ? x.length : String(x?.description)",
    'x instanceof Map ? x.get("k")?.[0] : 0',
    "x instanceof Error ? x.message : 0",
    "x?.[1]",
    "x?.next?.().value",
    "x?.index",
    "x?.z?.i",
    'JSON.stringify(typeof x === "bigint" || typeof x === "symbol" ? String(x) : x)?.slice(0, 80)',
    "x instanceof WeakMap ? x.get(keep)?.i : 1",
  ];
  lines.push(
    "for (; i < 2 + n; i++) { " +
      range(draws.between(1, 4))
        .map(
          (_: any) =>
            `{ const x: any = ${made()}; ${pick(["gc();", "", "gc(); "])} keep.push(x); ${pick(["gc();", ""])} p(tr(() => ${pick(use)})); }`,
        )
        .join(" ") +
      " }",
  );
  lines.push(`gc(); for (const x of keep) p(tr(() => ${pick(use)}));`);
  if (draws.next() < 0.4) {
    lines.push(
      'let chain: any = null; for (let j = 0; j < 50; j++) { chain = { j, chain, s: "q" + j }; if (j % 9 === 0) gc(); } let dep = 0; for (let c = chain; c; c = c.chain) dep += c.j; p(dep);',
    );
  }
  if (draws.next() < 0.4) {
    lines.push(
      'let str = ""; for (let j = 0; j < 60; j++) { str += "p" + j; if (j % 11 === 0) gc(); } p(str.length, str.slice(-9));',
    );
  }
  return lines;
}
export const families: Record<string, () => string[]> = {
  keys: writeKeys,
  texts: writeTexts,
  lists: writeLists,
  views: writeViews,
  dates: writeDates,
  bigInts: writeBigInts,
  objects: writeObjects,
  functions: writeFunctions,
  control: writeControl,
  formats: writeFormats,
  collections: writeCollections,
};

/** The body of a function of `k` and `n`, which lie between -1 and 7. */
export function writeRareValues(drawn: Draws, family: string): string[] {
  draws = drawn;
  return families[family]!();
}
