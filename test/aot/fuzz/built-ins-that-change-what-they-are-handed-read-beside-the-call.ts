// Small programs in which a built-in changes the object it is called on or handed, and the program reads that object beside the call: in one sum, one template, one list, on both sides, in a loop.
// The object is handed to no function of the program, and every line is printed at once.
//
//   regular expressions   `test`, `exec`, `match`, `matchAll`, `replace`, `search`, `split`, `compile` and `lastIndex`; the members of `RegExp` that remember the last match
//   lists                 `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin` and `length`, elements, `join`
//   maps and sets         `set`, `add`, `delete`, `clear` and `size`, `has`, `get`
//   buffers and views     two views of one buffer, `set`, `fill`, `DataView`, `TextEncoder.encodeInto`, `Buffer.write`, `copy`, `resize`, `transfer`, `structuredClone` with a transfer, `Atomics`
//   dates                 the setters and `getTime`
//   iterators             `next` of a list's iterator, a generator, a map's iterator, while the thing is changed
//   objects               `Object.assign`, `defineProperty`, `defineProperties`, `freeze`, `setPrototypeOf`, `Reflect.set`, `Object.groupBy`, `JSON.parse` with a reviver that changes its holder
//   the process           `process.env`, `process.exitCode`, `process.title`, members of `globalThis`
import type { Random } from "./random";

type Case = { setup: string; calls: string[]; reads: string[] };

export function generate(random: Random): string {
  const flags = random.pick(["g", "y", "gy", "gi", "", "d", "gd", "gm"]);
  const cases: Case[] = [
    {
      setup: `const re = /${random.pick(["a", "(a)(b)?", "a|b", "\\\\d+", "(?<n>a)", "^a", "a*"])}/${flags};\nconst text = "${random.pick(["aaa", "abab", "ba1a22", "", "xaax"])}";`,
      calls: [
        "re.test(text)",
        "re.exec(text)?.index",
        "re.exec(text)?.[0]",
        "text.match(re)?.length",
        'text.replace(re, "-")',
        "text.search(re)",
        "text.split(re).length",
        "(re.lastIndex = 1)",
        "(re.lastIndex = 9)",
        're.compile("b", "g").source',
        "[...text.matchAll(re.global ? re : /a/g)].length",
        'text.replaceAll(re.global ? re : /a/g, "+")',
        're[Symbol.replace](text, "=")',
        "re[Symbol.match](text)?.length",
      ],
      reads: [
        "re.lastIndex",
        "re.lastIndex",
        "re.lastIndex",
        "typeof re.lastIndex",
        "re.source",
        "re.flags",
        "RegExp.$1",
        "RegExp.lastMatch",
        'RegExp["$&"]',
        "RegExp.leftContext",
        "RegExp.lastParen",
        "re.global",
      ],
    },
    {
      setup: `const list = ${random.pick(["[1, 2, 3]", "[1.5, 2.5]", '["b", "a"]', "[]", "[3, 1, 2]", "[{ v: 1 }, { v: 2 }].map(each => each.v)", "new Array(3).fill(0)", "[1, , 3]"])};`,
      calls: [
        "list.push(9)",
        "list.pop()",
        "list.shift()",
        "list.unshift(8)",
        "list.splice(0, 1).length",
        "list.splice(1, 0, 7, 6).length",
        "list.sort().length",
        "list.reverse().length",
        "list.fill(5).length",
        "list.copyWithin(0, 1).length",
        "(list.length = 1)",
        "(list.length = 0)",
        "(list[list.length] = 4)",
        "(list[0] = 3)",
        "delete list[0]",
        "list.push(1, 2, 3)",
        "Array.prototype.push.call(list, 0)",
        "list.sort((first, second) => second - first)[0]",
      ],
      reads: [
        "list.length",
        "list.length",
        "list[0]",
        "list[1]",
        "list.at(-1)",
        "list.join()",
        "list[list.length - 1]",
        "0 in list",
        "list.indexOf(9)",
        "list.includes(5)",
        "typeof list[0]",
      ],
    },
    {
      setup: `const map = new Map([[1, "one"], [2, "two"]]);`,
      calls: [
        'map.set(3, "three").size',
        "map.delete(1)",
        "map.delete(9)",
        "map.clear()",
        'map.set(1, "again").get(1)',
        "map.forEach((each, name) => map.delete(name))",
        'map.getOrInsert?.(4, "four")',
      ],
      reads: ["map.size", "map.size", "map.has(1)", "map.get(1)", "map.has(3)", "[...map.keys()].join()", "map.get(3)"],
    },
    {
      setup: `const set = new Set([1, 2]);`,
      calls: [
        "set.add(3).size",
        "set.delete(1)",
        "set.clear()",
        "set.add(1).has(1)",
        "set.forEach(each => set.delete(each))",
      ],
      reads: ["set.size", "set.size", "set.has(1)", "set.has(3)", "[...set].join()"],
    },
    {
      setup: `const buffer = new ArrayBuffer(8${random.pick(["", ", { maxByteLength: 16 }"])});\nconst bytes = new Uint8Array(buffer);\nconst words = new Uint16Array(buffer);\nconst floats = new Float32Array(buffer);\nconst view = new DataView(buffer);\nconst part = bytes.subarray(1, 3);`,
      calls: [
        "(bytes[0] = 255)",
        "(words[0] = 258)",
        "(floats[0] = 1.5)",
        "view.setInt8(0, -1)",
        "view.setUint16(0, 513, true)",
        "view.setFloat32(0, 2.5)",
        "bytes.fill(7).length",
        "bytes.set([1, 2, 3], 1)",
        "(part[0] = 9)",
        "bytes.copyWithin(0, 1).length",
        "bytes.reverse().length",
        "bytes.sort().length",
        'new TextEncoder().encodeInto("az", bytes).written',
        'new TextEncoder().encodeInto("é", part).written',
        "Atomics.store(bytes, 0, 5)",
        "Atomics.add(bytes, 0, 1)",
        "words.fill(257).length",
        "buffer.resizable && buffer.resize(4)",
        "buffer.resizable && buffer.resize(16)",
        "buffer.transfer().byteLength",
        "structuredClone(buffer, { transfer: [buffer] }).byteLength",
        'Buffer.from(buffer).write("hi")',
        "Buffer.from(buffer).fill(3).length",
        "Buffer.from([4, 5]).copy(bytes)",
        "Buffer.from(buffer).writeUInt16LE(772, 0)",
      ],
      reads: [
        "bytes[0]",
        "bytes[1]",
        "words[0]",
        "floats[0]",
        "view.getUint8(0)",
        "view.getInt16(0, true)",
        "part[0]",
        "bytes.length",
        "buffer.byteLength",
        "words.length",
        "part.length",
        "bytes.join()",
        "view.byteLength",
        "bytes.byteOffset",
        "buffer.detached",
      ],
    },
    {
      setup: `const date = new Date(0);`,
      calls: [
        "date.setUTCFullYear(2000)",
        "date.setTime(5)",
        "date.setUTCHours(1)",
        "date.setUTCMonth(1, 2)",
        "date.setTime(NaN)",
        "date.setUTCMilliseconds(7)",
        "date.setUTCDate(40)",
      ],
      reads: [
        "date.getTime()",
        "date.getTime()",
        "date.getUTCFullYear()",
        "+date",
        "date.toISOString?.call(isNaN(date) ? new Date(0) : date)",
        "date.valueOf()",
        "date.getUTCDate()",
      ],
    },
    {
      setup: `const list = [1, 2, 3];\nconst walk = list[Symbol.iterator]();\nfunction* steps() {\nyield list.length;\nyield list.length;\n}\nconst made = steps();\nconst map = new Map([[1, 1]]);\nconst keys = map.keys();`,
      calls: [
        "walk.next().value",
        "list.push(4)",
        "list.pop()",
        "(list.length = 0)",
        "made.next().value",
        "made.return(7).value",
        "keys.next().value",
        "map.set(2, 2).size",
        "map.delete(1)",
        "walk.next().done",
      ],
      reads: [
        "walk.next().value",
        "walk.next().done",
        "made.next().value",
        "made.next().done",
        "keys.next().value",
        "list.length",
        "[...walk].length",
        "[...keys].join()",
      ],
    },
    {
      setup: `const held = { a: 1, b: "t" };\nconst source = { a: 2, c: 3 };`,
      calls: [
        "Object.keys(Object.assign(held, source)).length",
        'Object.defineProperty(held, "a", { value: 5 }).a',
        "Object.keys(Object.defineProperties(held, { c: { value: 6, enumerable: true } })).length",
        "Object.isFrozen(Object.freeze(held))",
        "Object.keys(Object.setPrototypeOf(held, source)).length",
        'Reflect.set(held, "a", 7)',
        'Reflect.deleteProperty(held, "a")',
        'Reflect.defineProperty(held, "d", { value: 8, enumerable: true })',
        "Object.entries(source).forEach(([name, each]) => (held[name] = each))",
        'JSON.parse(\'{"x":1,"y":2}\', function (name, each) {\nif (name === "x") delete this.y;\nheld.a = name;\nreturn each;\n}).y',
        "Object.isSealed(Object.seal(held))",
        "Object.keys(Object.assign(source, held)).length",
      ],
      reads: [
        "held.a",
        "held.a",
        "held.c",
        "typeof held.c",
        "Object.keys(held).join()",
        '"a" in held',
        "held.d",
        "JSON.stringify(held)",
        "source.a",
        "source.b",
        "Object.isExtensible(held)",
      ],
    },
    {
      setup: `delete process.env.FROM_THE_PROGRAM;`,
      calls: [
        '(process.env.FROM_THE_PROGRAM = "set")',
        "delete process.env.FROM_THE_PROGRAM",
        "(process.env.FROM_THE_PROGRAM = 5)",
        "(globalThis.fromTheProgram = 1)",
        "delete globalThis.fromTheProgram",
        'Object.assign(process.env, { FROM_THE_PROGRAM: "assigned" }).FROM_THE_PROGRAM',
        'Reflect.set(globalThis, "fromTheProgram", 2)',
        'Object.defineProperty(globalThis, "fromTheProgram", { value: 3, configurable: true, writable: true }) === globalThis',
      ],
      reads: [
        "process.env.FROM_THE_PROGRAM",
        "typeof process.env.FROM_THE_PROGRAM",
        '"FROM_THE_PROGRAM" in process.env',
        "globalThis.fromTheProgram",
        "typeof fromTheProgram",
        '"fromTheProgram" in globalThis',
        "Bun.env.FROM_THE_PROGRAM",
      ],
    },
    {
      setup: `const text = "${random.pick(["abc", "", "aé😀"])}";\nconst parts = [];\nlet built = "";`,
      calls: [
        "parts.push(text)",
        "(built += text)",
        "(built = text + built)",
        "parts.unshift(built)",
        "(built += parts.length)",
        "parts.splice(0).length",
        "(built = built.slice(1))",
        '(built = built.padEnd(4, "-"))',
      ],
      reads: [
        "built",
        "built.length",
        "parts.length",
        'parts.join("|")',
        "built[0]",
        "built.at(-1)",
        "built === text",
        "parts[0]",
      ],
    },
  ];
  const { setup, calls, reads } = random.pick(cases);
  const call = () => `(${random.pick(calls)})`;
  const read = () => `(${random.pick(reads)})`;
  const line = (): string =>
    random.pick<() => string>([
      () => `console.log(${call()}, ${read()});`,
      () => `console.log(${read()}, ${call()}, ${read()});`,
      () => `console.log(${call()} + " " + ${read()});`,
      (same = read()) => `console.log(${same} + " " + ${call()} + " " + ${same});`,
      (same = read()) => `console.log(\`\${${same}} \${${call()}} \${${same}}\`);`,
      (same = read()) => `console.log([${same}, ${call()}, ${same}].join(" "));`,
      (same = read()) => `console.log(String(${call()}) + typeof ${same} + String(${same}));`,
      (same = read()) =>
        `{\nconst before = ${same};\nconst answer = ${call()};\nconsole.log(before, answer, ${same});\n}`,
      () => `${call()};\nconsole.log(${read()}, ${read()});`,
      (same = read()) => `if (${call()}) console.log("then", ${same});\nelse console.log("else", ${same});`,
      (same = read()) => `for (let turn = 0; turn < 3; turn++) console.log(turn, ${same}, ${call()}, ${same});`,
      (same = read()) => `console.log(${same} === ${same}, ${call()}, ${same} === ${same}, ${same});`,
      (same = read()) =>
        `{\nlet seen = "";\nfor (let turn = 0; turn < 3; turn++) {\nseen += ${same} + ",";\nif (turn === 1) ${call()};\n}\nconsole.log(seen);\n}`,
      (same = read()) => `console.log(${call()} === ${same}, ${same});`,
      (same = read()) => `while (${call()} && count++ < 2) console.log("turn", ${same});`,
    ])();
  const body = `${setup}\nlet count = 0;\n${Array.from({ length: random.between(1, 5) }, line)
    .map(each => `try {\n${each}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`)
    .join(
      "\n",
    )}\ntry {\nconsole.log(${random.sample(reads, 3).join(", ")});\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  const place = random.pick(["top", "top", "once", "thrice", "async"] as const);
  if (place === "top") return `${body}\n`;
  if (place === "once") return `function run() {\n${body}\n}\nrun();\n`;
  if (place === "thrice") return `function run() {\n${body}\n}\nrun();\nrun();\nrun();\n`;
  return `async function run() {\nawait null;\n${body}\n}\nawait run();\n`;
}
