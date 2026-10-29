// A typed array, a DataView or a Buffer whose memory is detached, shrinks, grows or moves while something reads or writes through it.
//
//   kind      the eleven kinds of typed array, DataView, Buffer
//   memory    of a fixed size, resizable, shared and growable
//   window    the whole memory, from an offset, an offset and a length, a part of another view; over resizable memory with and without a length of its own
//   damage    resize to nothing, to less, to the window's edge, to more; transfer to the same size, to less, to more, to a fixed length; a structured clone that takes the memory along; grow
//   trigger   the valueOf of a stored value, of an index, of an argument; the callback, the comparator or the species of a built-in; and in the body of a loop a call, or a step that does not look like one:
//             a getter or a setter behind a declared field, a Proxy, a toString in a template, a number that is an object, Symbol.hasInstance, a closure out of a field or a list, the next() of a generator, an await
//   use       about ninety: loops that read, write and count with the length read once or each time, the methods of typed arrays, of Array.prototype, of DataView, Buffer, Atomics, Reflect, Object
//
// Each use is a function of its own. It runs on healthy memory first, often enough to count as hot where that is drawn, then once with the damage, then on healthy memory again.
// Behind the damage memory of the same sizes is allocated and filled, so that a read through a pointer that was kept prints something else than plain Bun does even where nothing watches the heap.
// Always TypeScript: the mode `erased` gives the untyped form.
import type { Random } from "./random";

interface Kind {
  name: string;
  size: number;
  isBig: boolean;
  isInteger: boolean;
}

// prettier-ignore
const kinds: Kind[] = [
  { name: "Int8Array", size: 1, isBig: false, isInteger: true }, { name: "Uint8Array", size: 1, isBig: false, isInteger: true }, { name: "Uint8ClampedArray", size: 1, isBig: false, isInteger: false },
  { name: "Int16Array", size: 2, isBig: false, isInteger: true }, { name: "Uint16Array", size: 2, isBig: false, isInteger: true }, { name: "Int32Array", size: 4, isBig: false, isInteger: true },
  { name: "Uint32Array", size: 4, isBig: false, isInteger: true }, { name: "Float32Array", size: 4, isBig: false, isInteger: false }, { name: "Float64Array", size: 8, isBig: false, isInteger: false },
  { name: "BigInt64Array", size: 8, isBig: true, isInteger: true }, { name: "BigUint64Array", size: 8, isBig: true, isInteger: true },
];

const prelude = `function show(value: any): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || value === undefined || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.name;
  if (value instanceof DataView) return "DataView(" + lengthOf(value) + ")";
  if (ArrayBuffer.isView(value)) return "view[" + Array.prototype.map.call(value, show).join(",") + "]";
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (value instanceof ArrayBuffer) return "memory(" + value.byteLength + ")";
  return typeof value;
}
function lengthOf(view: DataView): string {
  try {
    return String(view.byteLength);
  } catch {
    return "out of bounds";
  }
}
const kept: Uint8Array[] = [];
let moved: any = null;
function churn(): void {
  moved = null;
  (globalThis as any).Bun.gc(true);
  for (let i = 0; i < 96; i++) kept.push(new Uint8Array(8 << (i % 7)).fill(0xee));
  if (kept.length > 400) kept.length = 0;
}
let countdown = -1;
let hidden = 0;
let text = "";
`;

export function generate(random: Random): string {
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const text: string[] = [prelude];
  const notes: string[] = [];
  const uses = random.between(1, 3);

  for (let number = 0; number < uses; number++) {
    const kind = pick(kinds);
    const holder = random.weighted([[6, "view"], [2, "data"], [2, "buffer"]] as const);
    const element = holder === "view" ? kind : kinds[1];
    const size = element.size;
    const memoryKind = random.weighted([[3, "fixed"], [5, "resizable"], [1, "shared"]] as const);
    const bytes = pick([64, 64, 128, 256, 1024, 4096 + 64]);
    const most = bytes * pick([1, 2, 4]);
    const count = bytes / size;
    const offset = pick([0, 0, 1, 2, 3]) * 8;
    const tracksLength = memoryKind !== "fixed" && random.chance(0.5);
    const windowLength = Math.max(1, Math.floor((bytes - offset) / size) - pick([0, 0, 1, 2]));
    const one = element.isBig ? "1n" : "1";
    const zero = element.isBig ? "0n" : "0";
    const number_ = (value: number) => (element.isBig ? value + "n" : String(value));
    const type = holder === "view" ? (random.chance(0.8) ? kind.name : "any") : holder === "data" ? "DataView" : "Buffer";

    const make =
      memoryKind === "fixed" ? `new ArrayBuffer(${bytes})` : memoryKind === "resizable" ? `new (ArrayBuffer as any)(${bytes}, { maxByteLength: ${most} })` : `new (SharedArrayBuffer as any)(${bytes}, { maxByteLength: ${most} })`;
    const bounds = tracksLength ? (offset ? `, ${offset}` : "") : `, ${offset}, ${holder === "view" ? windowLength : bytes - offset}`;
    const window =
      holder === "view"
        ? random.chance(0.2)
          ? `new ${kind.name}(memory).subarray(${offset / size}${tracksLength ? "" : `, ${offset / size + windowLength}`})`
          : `new ${kind.name}(memory${bounds})`
        : holder === "data"
          ? `new DataView(memory${bounds})`
          : `Buffer.from(memory${tracksLength ? `, ${offset}` : bounds})`;

    // prettier-ignore
    const damages =
      memoryKind === "shared" ? [`memory.grow(${most})`, `memory.grow(${Math.min(most, bytes + 8)})`]
      : [
          `moved = memory.transfer()`, `moved = memory.transfer(8)`, `moved = memory.transfer(0)`, `moved = memory.transfer(${bytes * 4})`, `moved = memory.transferToFixedLength()`,
          `moved = structuredClone(memory, { transfer: [memory] })`,
          ...(memoryKind === "resizable" ? [`memory.resize(0)`, `memory.resize(0)`, `memory.resize(8)`, `memory.resize(${offset})`, `memory.resize(${offset + size})`, `memory.resize(${bytes >> 1})`, `memory.resize(${bytes - size})`, `memory.resize(${most})`, `memory.resize(0); memory.resize(${most})`] : []),
        ];
    const damage = pick(damages);
    const at = pick([1, 1, 2, 3, Math.max(1, count >> 1), Math.max(1, windowLength - 1)]);

    const direct = `strike${number}(memory)`;
    // prettier-ignore
    const strike = random.chance(0.35) ? direct : pick([
      `hidden += getter${number}.step`, `void getter${number}.step`, `setter${number}.last = 1`, `hidden += proxy${number}.step`, `proxy${number}.step = 1`, `hidden += +("step" in proxy${number})`,
      `text = \`\${thing${number}}\``, `text = "" + thing${number}`, `hidden += lie${number} * 1`, `hidden += +(lie${number} < 1)`, `hidden += +((hidden as any) instanceof Checker${number})`,
      `step${number}()`, `steps${number}[0]()`, `holder${number}.step()`, `ticking${number}.next()`, `[hidden] = striking${number}`, `hidden += Object.keys(proxy${number}).length`, `text = JSON.stringify(json${number})`,
      `try {\n      throw 1;\n    } catch {\n      ${direct};\n    }`, `await tick${number}()`, `await later${number}`,
    ]);
    const evil = (result: string) => `({ valueOf() { ${direct}; return ${result}; } } as any)`;
    const evilText = (result: string) => `({ toString() { ${direct}; return ${result}; } } as any)`;
    const evilIndex = evil(pick(["0", "1", "2", String(Math.max(0, windowLength - 1)), String(windowLength), "-1"]));
    const evilValue = evil(number_(7));
    const value = (index: string) => (element.isBig ? `BigInt(${index}) + 3n` : pick([`${index} + 3`, `${index} * 1.5`, `-${index}`, "255", "0.5"]));
    const bound = pick(["view.length", "view.length", "length", "length", String(windowLength), `${windowLength} + 2`]);
    const loop = (body: string, result = "sum") => `const length = view.length;\n  let sum = ${zero};\n  for (let i = 0; i < ${bound}; i++) {\n    ${body}\n  }\n  return [${result}, length];`;
    const any = "(view as any)";

    // prettier-ignore
    const viewUses: string[] = [
      loop(`${strike};\n    sum += view[i];`),
      loop(`sum += view[i];\n    ${strike};`),
      loop(`${strike};\n    view[i] = ${value("i")};`, "view.length"),
      loop(`view[i] = ${value("i")};\n    ${strike};\n    sum += view[i];`),
      loop(`view[i] = ${evilValue};`, "view.length"),
      loop(`view[i] += ${one};\n    ${strike};\n    view[i] += ${one};`, "view[0]"),
      loop(`${strike};\n    view[i]++;`, "view[0]"),
      loop(`const before = view[i];\n    ${strike};\n    sum += before + view[i];`),
      loop(`${strike};\n    if (i in view) sum += ${one};`),
      loop(`${strike};\n    sum += view[length - 1 - i];`),
      loop(`${strike};\n    sum += view[i] + view[(i + 1) % length];`),
      loop(`${strike};\n    sum += ${any}.at(i) ?? ${zero};`),
      `let sum = ${zero};\n  for (let i = view.length - 1; i >= 0; i--) {\n    ${strike};\n    sum += view[i];\n  }\n  return sum;`,
      `let sum = ${zero};\n  let i = 0;\n  while (i < view.length) {\n    sum += view[i++];\n    ${strike};\n  }\n  return [sum, i];`,
      `let sum = ${zero};\n  for (const each of view) {\n    ${strike};\n    sum += each;\n  }\n  return sum;`,
      `let sum = ${zero};\n  for (const [index, each] of view.entries()) {\n    ${strike};\n    sum += each + view[index];\n  }\n  return sum;`,
      `let sum = 0;\n  for (const index of view.keys()) {\n    ${strike};\n    sum += index;\n  }\n  return sum;`,
      `const values = view.values();\n  const first = values.next();\n  ${strike};\n  return [first.value, values.next().value, [...values].length];`,
      `const [a, b, c] = view;\n  ${strike};\n  const [d, e, f] = view;\n  return [a, b, c, d, e, f];`,
      `${strike};\n  return [...view].length;`,
      ...["forEach", "map", "filter", "some", "every", "find", "findIndex", "findLast", "findLastIndex"].map(method => `let seen = 0;\n  const result = ${any}.${method}((each: any, index: number) => {\n    ${strike};\n    seen++;\n    return ${method === "map" ? "each" : `index > ${at + 2}`};\n  });\n  return [result, seen];`),
      ...["reduce", "reduceRight"].map(method => `return ${any}.${method}((sum: any, each: any) => {\n    ${strike};\n    return each === undefined ? sum : sum + each;\n  }, ${zero});`),
      ...["sort", "toSorted"].map(method => `return ${any}.${method}((a: any, b: any) => {\n    ${strike};\n    return a < b ? 1 : a > b ? -1 : 0;\n  });`),
      `return view.fill(${evilValue});`, `return view.fill(${number_(5)}, ${evilIndex});`, `return view.fill(${number_(5)}, 0, ${evilIndex});`,
      `view.set([${number_(1)}, ${evilValue}, ${number_(3)}] as any);\n  return view;`, `view.set([${number_(1)}, ${number_(2)}] as any, ${evilIndex});\n  return view;`,
      `view.set({ length: 3, 0: ${number_(1)}, get 1() { ${strike}; return ${number_(2)}; }, 2: ${number_(3)} } as any);\n  return view;`,
      `view.set({ get length() { ${strike}; return 2; }, 0: ${number_(1)}, 1: ${number_(2)} } as any);\n  return view;`,
      `return view.copyWithin(${evilIndex}, 0);`, `return view.copyWithin(0, ${evilIndex});`, `return view.copyWithin(0, 1, ${evilIndex});`,
      `return view.slice(${evilIndex});`, `return view.slice(0, ${evilIndex});`, `return view.subarray(${evilIndex});`, `return view.subarray(0, ${evilIndex});`,
      `return view.indexOf(${number_(5)} as never, ${evilIndex});`, `return view.lastIndexOf(${number_(5)} as never, ${evilIndex});`, `return view.includes(undefined as never, ${evilIndex});`,
      `return view.join(${evilText('"-"')});`, `return ${any}.at(${evilIndex});`, `return ${any}.with(${evilIndex}, ${number_(9)});`, `return ${any}.with(0, ${evilValue});`,
      `${strike};\n  return [${any}.toReversed(), view.reverse()];`, `${strike};\n  return view.toString();`, `${strike};\n  return view.toLocaleString();`,
      `class Other extends ${kind.name} {\n    static get [Symbol.species]() {\n      ${strike};\n      return ${kind.name};\n    }\n  }\n  const other: any = new Other(view.buffer as any, view.byteOffset);\n  return other.${pick(["slice(1)", "map((each: any) => each)", "filter(() => true)", "subarray(1)"])};`,
      ...["map", "filter", "forEach", "indexOf", "join", "slice", "reverse", "fill", "includes", "copyWithin"].map(method => `return (Array.prototype.${method} as any).call(view, ${method === "join" ? evilText('"+"') : ["indexOf", "includes", "fill"].includes(method) ? `${number_(5)}, ${evilIndex}` : ["slice", "copyWithin"].includes(method) ? evilIndex + ", 1" : method === "reverse" ? "" : `(each: any) => {\n    ${strike};\n    return each;\n  }`});`),
      `return Array.from(view as any, (each: any) => {\n    ${strike};\n    return each;\n  });`,
      `return ${kind.name}.from(view as any, ((each: any) => {\n    ${strike};\n    return each;\n  }) as any);`,
      `${strike};\n  return new ${pick(kinds.filter(other => other.isBig === kind.isBig)).name}(view as any);`,
      `const target = new ${kind.name}(${windowLength + 2});\n  ${strike};\n  target.set(view as any);\n  return target;`,
      `${strike};\n  return [Object.keys(view).length, Reflect.ownKeys(view).length, JSON.stringify(${element.isBig ? "Object.keys(view)" : "view"}).length];`,
      `return [Reflect.set(view, 1, ${evilValue}), Reflect.get(view, 1), Reflect.has(view, 1)];`,
      `return [Reflect.defineProperty(view, 1, { value: ${evilValue} }), view[1]];`,
      `${strike};\n  return [Object.getOwnPropertyDescriptor(view, 0)?.value, Object.getOwnPropertyDescriptor(view, ${windowLength - 1})?.value, delete (view as any)[0], Object.isFrozen(view)];`,
      `return view[${evilText('"1"')}];`, `view[${evilText('"1"')}] = ${number_(4)};\n  return view[1];`,
      ...(element.isInteger ? [`return Atomics.add(view as any, ${evilIndex}, ${one} as never);`, `return Atomics.store(view as any, 0, ${evilValue});`, `return Atomics.compareExchange(view as any, 0, ${evilValue}, ${one} as never);`, loop(`${strike};\n    sum += Atomics.load(view as any, i) as never;`)] : []),
      ...(size === 1 ? [`${strike};\n  return new TextDecoder().decode(view as any).length;`, `const result = new TextEncoder().encodeInto("some text that is written", view as any);\n  ${strike};\n  return [result.written, view[0]];`] : []),
    ];
    const getter = pick(["getInt8", "getUint8", "getInt16", "getUint16", "getInt32", "getUint32", "getFloat32", "getFloat64", "getBigInt64", "getBigUint64"]);
    const setter = "s" + getter.slice(1);
    const stored = getter.includes("Big") ? "7n" : "7";
    // prettier-ignore
    const dataUses: string[] = [
      `let sum = 0;\n  for (let i = 0; i < ${bytes - offset}; i++) {\n    ${strike};\n    sum += view.getUint8(i);\n  }\n  return sum;`,
      `const length = view.byteLength;\n  let sum = 0;\n  for (let i = 0; i + 8 <= length; i += 8) {\n    sum += view.getFloat64(i);\n    ${strike};\n  }\n  return sum;`,
      `for (let i = 0; i + 4 <= view.byteLength; i += 4) {\n    ${strike};\n    view.setInt32(i, i, true);\n  }\n  return lengthOf(view);`,
      `return view.${getter}(${evilIndex});`, `return (view as any).${getter}(0, ${evil("1")});`, `view.${setter}(${evilIndex}, ${stored} as never);\n  return lengthOf(view);`,
      `view.${setter}(0, ${evil(stored)});\n  return lengthOf(view);`, `${strike};\n  return [lengthOf(view), view.byteOffset];`, `${strike};\n  return view.${getter}(0);`,
    ];
    // prettier-ignore
    const bufferUses: string[] = [
      loop(`${strike};\n    sum += view[i];`), loop(`${strike};\n    view[i] = i;`, "view.length"), loop(`${strike};\n    sum += view.readUInt8(i);`),
      `let sum = 0;\n  for (let i = 0; i + 4 <= view.length; i += 4) {\n    ${strike};\n    sum += view.readUInt32LE(i);\n  }\n  return sum;`,
      `for (let i = 0; i + 8 <= view.length; i += 8) {\n    ${strike};\n    view.writeDoubleLE(i, i);\n  }\n  return view.length;`,
      `return view.readUInt32LE(${evilIndex});`, `return view.writeUInt32BE(${evil("7")}, 0);`, `return view.writeUInt32BE(7, ${evilIndex});`, `return view.readDoubleBE(${evilIndex});`,
      `return view.toString("hex", ${evilIndex});`, `return view.toString("latin1", 0, ${evilIndex});`, `return view.write("text", ${evilIndex});`, `return view.fill(${evil("7")});`, `return view.fill("ab", ${evilIndex});`,
      `return view.copy(Buffer.alloc(${bytes}), ${evilIndex});`, `return view.copy(Buffer.alloc(${bytes}), 0, ${evilIndex});`, `return view.indexOf(5, ${evilIndex});`, `return view.includes("a", ${evilIndex});`,
      `return view.subarray(${evilIndex}).length;`, `return view.slice(${evilIndex}).length;`, `return view.compare(Buffer.alloc(8), ${evilIndex});`, `${strike};\n  return view.equals(Buffer.alloc(${bytes - offset}));`,
      `${strike};\n  return Buffer.concat([view, view]).length;`, `${strike};\n  return [view.toString("base64").length, view.toJSON().data.length, view.swap16 === undefined];`, `${strike};\n  return Buffer.from(view).length;`,
      `return Buffer.concat([view, Buffer.alloc(4)], ${evilIndex}).length;`, `return view.readBigUInt64LE(${evilIndex});`, `return view.readIntBE(${evilIndex}, 3);`, `return view.writeIntLE(5, 0, ${evil("3")});`,
    ];
    const drawn = pick(holder === "view" ? viewUses : holder === "data" ? dataUses : bufferUses);
    // An await stands only in the function's own body.
    const use = strike.startsWith("await") && /=> \{|get \w+\(\)|static get/.test(drawn) ? drawn.replaceAll(strike, direct) : drawn;
    const rounds = pick(bytes > 256 ? [3, 3, 5] : [3, 3, 5, 40, 300]);
    const struck = random.between(1, rounds - 2);
    const after =
      holder === "data" ? "[lengthOf(view), memory.byteLength]" : `[view.length, view.byteLength, view.byteOffset, view[0], view[${Math.max(0, windowLength - 1)}], memory.byteLength${memoryKind === "fixed" ? ", (memory as any).detached" : ""}]`;

    notes.push(`${strike === direct ? "" : strike.replace(/\s+/g, " ").slice(0, 40) + ": "}${type === "any" ? kind.name + " as any" : holder === "view" ? kind.name : type} ${memoryKind}${tracksLength ? " tracking" : ""} ${damage.replace(/moved = |memory\./g, "")} at ${at}`);
    text.push(`function strike${number}(memory: any): void {
  if (--countdown !== 0) return;
  ${damage};
  churn();
}
let target${number}: any = null;
const getter${number}: { step: number } = { get step() { strike${number}(target${number}); return 0; } };
const setter${number}: { last: number } = { get last() { return 0; }, set last(value: number) { strike${number}(target${number}); } };
const proxy${number}: { step: number } = new Proxy({ step: 0 }, { get() { strike${number}(target${number}); return 0; }, set() { strike${number}(target${number}); return true; }, has() { strike${number}(target${number}); return true; }, ownKeys() { strike${number}(target${number}); return []; } });
const thing${number}: { toString(): string } = { toString() { strike${number}(target${number}); return ""; } };
const lie${number}: number = { valueOf() { strike${number}(target${number}); return 0; } } as any;
class Checker${number} { static [Symbol.hasInstance](value: any) { strike${number}(target${number}); return false; } }
const step${number}: () => void = () => strike${number}(target${number});
const steps${number}: (() => void)[] = [step${number}];
const holder${number} = { step: step${number} };
function* ticks${number}(): Generator<number> { for (;;) { strike${number}(target${number}); yield 0; } }
const ticking${number} = ticks${number}();
const striking${number}: Iterable<number> = { [Symbol.iterator]() { strike${number}(target${number}); return [0][Symbol.iterator](); } };
const json${number} = { toJSON() { strike${number}(target${number}); return 0; } };
const tick${number} = () => Promise.resolve().then(() => strike${number}(target${number}));
const later${number} = { then(resolve: (value: number) => void) { strike${number}(target${number}); resolve(0); } };
${use.includes("await ") ? "async " : ""}function use${number}(view: ${type}, memory: any): ${use.includes("await ") ? "Promise<any>" : "any"} {
  ${use}
}
{
  let last = "";
  for (let round = 0; round < ${rounds}; round++) {
    const memory: any = ${make};
    new Uint8Array(memory).forEach((_, index, all) => (all[index] = (index * 37 + 11) & 255));
    const view: any = ${window};
    target${number} = memory;
    countdown = round === ${struck} ? ${at} : -1;
    let line: string;
    try {
      line = show(await use${number}(view, memory));
    } catch (error) {
      line = "threw " + show(error);
    }
    countdown = -1;
    try {
      line += " | " + show(${after});
    } catch (error) {
      line += " | threw " + show(error);
    }
    if (line !== last) console.log("use ${number} round " + round + ": " + line);
    last = line;
  }
}
`);
  }
  return `// ${notes.join(" . ")}\n${text.join("\n")}`;
}
