// One key, asked of one value in every way the language has: a read, `in`, Object.hasOwn, a store, a delete, a call, a pattern. What one way has learned about a key and a value
// ("there is nothing under it") is no answer for another way, which throws, walks the prototypes or asks a trap.
//
//   key     text that is a literal, the name of a member, still in pieces, cut out of a longer one, made of bytes, wide, empty, an index as text; whole numbers, fractions, -0; symbols; a bigint; null; an object that is asked for its text
//   value   texts of as many kinds, symbols, bigints, numbers, booleans, null, undefined and their boxes; records with the key, without it, with a getter, without a prototype, frozen, thinned out, below a record or a proxy that has it; lists, typed arrays, Maps, functions, classes, instances, proxies
//   way     a read, its kind, `in`, four ways to ask for an own member, Reflect, `?.`, a call, stores of six kinds, a delete, a definition, patterns, a walk
//   where   each way in a function of its own, all of them in one function, in a method, or both
//   when    one key and one value for many turns and then the next pair, or another key and another value at every turn; the same key and value again, or ones made anew
//
// `AOT_FUZZ_ONE_KEY_WITHOUT=has,hasNot` leaves ways out, for a build that is older than a fix.
import type { Random } from "./random";

const keys: Record<string, string> = {
  literal: `"abcd"`,
  memberName: `Object.keys({ abcd: 1 })[0]`,
  inPieces: `"ab" + late("cd")`,
  longInPieces: `"abcdefghijklmnop" + late("qrstuvwxyz")`,
  cutOut: `late("xxabcdxx").slice(2, 6)`,
  ofBytes: `Buffer.from("abcd").toString("latin1")`,
  ofHighBytes: `Buffer.from([97, 233]).toString("latin1")`,
  ofCodes: `String.fromCharCode(97, 98, 99, 100)`,
  parsed: `JSON.parse('"abcd"')`,
  wide: `"日本"`,
  wideInPieces: `"日" + late("本")`,
  empty: `""`,
  length: `"length"`,
  lengthInPieces: `"len" + late("gth")`,
  inherited: `"toString"`,
  inheritedInPieces: `"to" + late("String")`,
  prototype: `"__proto__"`,
  indexAsText: `"1"`,
  indexInPieces: `late("") + late("1")`,
  farIndexAsText: `"4294967294"`,
  pastEveryIndex: `"4294967295"`,
  almostAnIndex: `"01"`,
  index: `1`,
  farIndex: `70`,
  negative: `-1`,
  negativeZero: `-0`,
  fraction: `1.5`,
  notANumber: `NaN`,
  shared: `Symbol.for("abcd")`,
  own: `mine`,
  iterator: `Symbol.iterator`,
  big: `1n`,
  nothing: `null`,
  missing: `undefined`,
  yes: `true`,
  asked: `{ toString() { asked++; return "abcd"; } }`,
  list: `["abcd"]`,
};

const values: Record<string, string> = {
  text: `"abcdefgh"`,
  textInPieces: `"abcdefgh" + late("ijklmnop")`,
  textOfBytes: `Buffer.from("abcd").toString()`,
  textCutOut: `late("xxabcdxx").slice(1, 7)`,
  wideText: `"日本語"`,
  emptyText: `""`,
  oneLetter: `late("a")`,
  symbol: `Symbol("s")`,
  sharedSymbol: `Symbol.for("t")`,
  big: `10n ** 30n`,
  smallBig: `3n`,
  number: `7`,
  fraction: `0.5`,
  notANumber: `NaN`,
  yes: `true`,
  nothing: `null`,
  missing: `undefined`,
  boxedText: `new String("abcdefgh")`,
  boxedNumber: `new Number(7)`,
  boxedSymbol: `Object(Symbol("s"))`,
  record: `{ other: 1 }`,
  emptyRecord: `{}`,
  recordWithIt: `{ [key]: 1 }`,
  recordWithACall: `{ [key]() { return 2; } }`,
  recordWithAGetter: `{ get [key]() { got++; return 3; } }`,
  recordWithNothingStored: `{ [key]: undefined }`,
  withoutAPrototype: `Object.create(null)`,
  withoutAPrototypeWithIt: `Object.assign(Object.create(null), { [key]: 1 })`,
  belowOneThatHasIt: `Object.create({ [key]: 4 })`,
  belowAProxy: `Object.create(new Proxy({ [key]: 5 }, traps))`,
  frozen: `Object.freeze({ [key]: 1 })`,
  closed: `Object.preventExtensions({ other: 1 })`,
  thinnedOut: `thinned({ a: 1, b: 2, c: 3, [key]: 4, d: 5 })`,
  hidden: `Object.defineProperty({}, key, { value: 6, enumerable: false, configurable: true, writable: true })`,
  list: `[1, 2]`,
  listOfTexts: `["a", "b", "c"]`,
  listWithAHole: `[1, , 3]`,
  listWithIt: `Object.assign([1, 2], { [key]: 1 })`,
  bytes: `new Uint8Array([1, 2, 3])`,
  fractions: `new Float64Array(2)`,
  map: `new Map([[key, 1]])`,
  callable: `function () { return 1; }`,
  arrow: `() => 1`,
  aClass: `class { static [key] = 1; }`,
  instance: `new (class { [key] = 1; })()`,
  instanceWithAMethod: `new (class { [key]() { return 2; } })()`,
  instanceWithoutIt: `new (class { other = 1; })()`,
  proxy: `new Proxy({ [key]: 1 }, traps)`,
  proxyWithoutIt: `new Proxy({}, traps)`,
  handed: `Reflect.apply(function () { return arguments; }, null, [1, 2])`,
  pattern: `/a/`,
  error: `new Error("e")`,
};

const ways: Record<string, string> = {
  read: `value[key]`,
  kind: `typeof value[key]`,
  has: `key in value`,
  hasNot: `!(key in value)`,
  own: `Object.hasOwn(value, key)`,
  ownTheOldWay: `Object.prototype.hasOwnProperty.call(value, key)`,
  listed: `Object.prototype.propertyIsEnumerable.call(value, key)`,
  described: `Object.getOwnPropertyDescriptor(value, key)?.value`,
  reflectHas: `Reflect.has(value, key)`,
  reflectGet: `Reflect.get(value, key)`,
  ifThere: `value?.[key]`,
  call: `value[key]()`,
  callIfThere: `value[key]?.()`,
  lengthOfIt: `value[key]?.length`,
  store: `(value[key] = turn & 3)`,
  storeAndRead: `(value[key] = 5, value[key])`,
  less: `(value[key] -= 1)`,
  count: `value[key]++`,
  storeIfMissing: `(value[key] ??= 9)`,
  reflectSet: `Reflect.set(value, key, 4)`,
  remove: `delete value[key]`,
  reflectRemove: `Reflect.deleteProperty(value, key)`,
  define: `Object.defineProperty(value, key, { value: 3, writable: true, configurable: true, enumerable: true }) === value`,
  pattern: `(({ [key]: found }ANY) => found)(value)`,
  patternWithADefault: `(({ [key]: found = "none" }ANY) => found)(value)`,
  walk: `walked(key, value)`,
  names: `Object.keys(Object(value)).length`,
};

const quietWays = ["read", "kind", "has", "hasNot", "own", "ownTheOldWay", "listed", "described", "reflectHas", "reflectGet", "ifThere", "callIfThere", "lengthOfIt", "pattern", "patternWithADefault", "walk"];

const storingWays = ["store", "storeAndRead"];

function some<T>(random: Random, from: readonly T[], low: number, high: number): T[] {
  return random.shuffled(from).slice(0, random.between(low, high));
}

export function generate(random: Random, typed = false): string {
  const any = typed ? ": any" : "";
  const chosenKeys = random.chance(0.5) ? some(random, Object.keys(keys), 2, 4) : some(random, ["literal", "memberName", "inPieces", "cutOut", "ofBytes", "ofCodes", "parsed", "asked", "list"], 2, 4);
  const chosenValues = some(random, Object.keys(values), 2, 6);
  const without = (process.env.AOT_FUZZ_ONE_KEY_WITHOUT ?? "").split(",");
  const chosenWays = (random.chance(0.6) ? some(random, quietWays, 2, 6) : some(random, Object.keys(ways), 3, 7)).filter(way => !without.includes(way));
  if (random.chance(0.5) && !chosenWays.includes("read")) chosenWays.unshift("read");
  // A store into null or undefined throws before the key is asked for its text; plain Bun asks first.
  if (chosenKeys.includes("asked") && chosenWays.some(way => storingWays.includes(way))) for (const name of ["nothing", "missing"]) if (chosenValues.includes(name)) chosenValues.splice(chosenValues.indexOf(name), 1, "record");
  const turns = random.pick([3, 20, 150, 150, 400]);
  const where = random.pick(["apart", "together", "together", "both", "methods"]);
  const isMixed = random.chance(0.4);
  const keyAgain = random.pick([1, 3, 1000]);
  const valueAgain = random.pick([1, 5, 1000]);
  const text = (way: string) => ways[way].replaceAll("ANY", any);
  const block = (way: string) => `  try {\n    said.push(show(${text(way)}));\n  } catch (error) {\n    said.push("throws " + (error${typed ? " as Error" : ""}).constructor.name.slice(0, -5));\n  }`;
  const parameters = `key${any}, value${any}, turn${typed ? ": number" : ""}`;
  const lines: string[] = [
    `let asked = 0, got = 0;`,
    `const trapped${typed ? ": Record<string, number>" : ""} = { has: 0, get: 0, set: 0, deleteProperty: 0, getOwnPropertyDescriptor: 0, defineProperty: 0, ownKeys: 0 };`,
    `const traps${any} = {};`,
    `for (const name of Object.keys(trapped)) traps[name] = (...all${typed ? ": any[]" : ""}) => (trapped[name]++, (Reflect${typed ? " as any" : ""})[name](...all));`,
    `const mine = Symbol("mine");`,
    `const late = (text${typed ? ": string" : ""}) => String(Date.now() > 0 ? text : "");`,
    `function thinned(record${any}) {\n  delete record.b;\n  delete record.a;\n  return record;\n}`,
    `function walked(key${any}, value${any}) {\n  let found = 0;\n  for (const name in value) if (name === key) found++;\n  return found;\n}`,
    `function show(value${any})${typed ? ": string" : ""} {\n  if (typeof value === "function") return "function";\n  if (typeof value === "symbol") return "symbol";\n  if (typeof value === "bigint") return value + "n";\n  if (typeof value === "string") return JSON.stringify(value);\n  if (value === null || typeof value !== "object") return Object.is(value, -0) ? "-0" : String(value);\n  return Array.isArray(value) ? "list" : "object";\n}`,
    `const keys${typed ? ": (() => any)[]" : ""} = [${chosenKeys.map(name => `() => (${keys[name]})`).join(", ")}];`,
    `const values${typed ? ": ((key: any) => any)[]" : ""} = [${chosenValues.map(name => `(key${any}) => (${values[name]})`).join(", ")}];`,
  ];
  const calls: string[] = [];
  if (where === "apart" || where === "both")
    chosenWays.forEach((way, at) => {
      lines.push(`function way${at}(${parameters}) {\n  const said${typed ? ": string[]" : ""} = [];\n${block(way)}\n  return said[0];\n}`);
      calls.push(`way${at}(key, value, turn)`);
    });
  if (where === "together" || where === "both") {
    lines.push(`function everyWay(${parameters}) {\n  const said${typed ? ": string[]" : ""} = [];\n${chosenWays.map(block).join("\n")}\n  return said.join(" ");\n}`);
    calls.push(`everyWay(key, value, turn)`);
  }
  if (where === "methods") {
    lines.push(`class Asker {\n${chosenWays.map((way, at) => `  way${at}(${parameters}) {\n  const said${typed ? ": string[]" : ""} = [];\n${block(way)}\n  return said[0];\n  }`).join("\n")}\n}\nconst asker = new Asker();`);
    chosenWays.forEach((_, at) => calls.push(`asker.way${at}(key, value, turn)`));
  }
  const line = `[${calls.join(", ")}].join(" ")`;
  if (isMixed)
    lines.push(
      `const counts = new Map${typed ? "<string, number>" : ""}();`,
      `const keptKeys = keys.map(make => make());`,
      `const keptValues = values.map((make, at) => keptKeys.map(key => make(key)));`,
      `for (let turn = 0; turn < ${turns * chosenKeys.length * chosenValues.length}; turn++) {`,
      `  const k = (turn * ${random.pick([1, 3, 5])} + (turn >> ${random.between(2, 6)})) % keys.length, v = (turn * ${random.pick([1, 7, 11])} + (turn >> ${random.between(1, 5)})) % values.length;`,
      `  const key = turn % ${keyAgain} ? keptKeys[k] : keys[k](), value = turn % ${valueAgain} ? keptValues[v][k] : values[v](key);`,
      `  const line = k + " " + v + ": " + ${line};`,
      `  counts.set(line, (counts.get(line) ?? 0) + 1);`,
      `}`,
      `for (const [line, count] of counts) console.log(line, "x" + count);`,
    );
  else
    lines.push(
      `for (let k = 0; k < keys.length; k++)`,
      `  for (let v = 0; v < values.length; v++) {`,
      `    const counts = new Map${typed ? "<string, number>" : ""}();`,
      `    const keptKey = keys[k](), keptValue = values[v](keptKey);`,
      `    for (let turn = 0; turn < ${turns}; turn++) {`,
      `      const key = turn % ${keyAgain} ? keptKey : keys[k](), value = turn % ${valueAgain} ? keptValue : values[v](key);`,
      `      const line = ${line};`,
      `      counts.set(line, (counts.get(line) ?? 0) + 1);`,
      `    }`,
      `    console.log(k, v, [...counts].map(([line, count]) => line + " x" + count).join(" | "));`,
      `  }`,
    );
  lines.push(`console.log(asked, got, JSON.stringify(trapped));`, `// keys: ${chosenKeys.join(", ")}; values: ${chosenValues.join(", ")}; ways: ${chosenWays.join(", ")}`, `export {};`);
  return lines.join("\n") + "\n";
}
