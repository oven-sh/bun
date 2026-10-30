// One function makes two to four objects, each under a try of its own, so each may be missing behind it. Each holds the one made
// before it and something of its own: a rest list, a list, an object, a closure. The last one leaves the function on some ways only.
// A program draws how the objects are made, how and in which order their fields are stored, what they hold and how the last one
// leaves. The caller goes through the ways in which the stores and the objects may fail and prints what it gets.
import type { Random } from "./random";

type Store = (bit: number, target: string, name: string, value: string) => string;

const stores: Store[] = [
  (_, target, name, value) => `try { ${target}.${name} = ${value}; } catch (e) {}`,
  (bit, target, name, value) => `try { if (flags & ${bit}) throw 0; ${target}.${name} = ${value}; } catch (e) {}`,
  (bit, target, name, value) => `if (flags & ${bit}) ${target}.${name} = ${value};`,
];

const payloads: { parameter: string; arguments: string; inConstructor: string; inPlace: string }[] = [
  { parameter: ", ...rest", arguments: ", seed, 2", inConstructor: `rest`, inPlace: `[seed, 2]` },
  { parameter: "", arguments: "", inConstructor: `[seed, 1]`, inPlace: `[seed, 1]` },
  { parameter: "", arguments: "", inConstructor: `{ seed }`, inPlace: `{ seed }` },
  { parameter: "", arguments: "", inConstructor: `() => seed`, inPlace: `() => seed` },
  { parameter: "", arguments: "", inConstructor: `[[seed], { seed }]`, inPlace: `[[seed], { seed }]` },
];

type Field = "payload" | "held" | "extra" | "again";

const orders: Field[][] = [
  ["payload", "held"],
  ["held", "payload"],
  ["held", "payload", "extra"],
  ["extra", "held", "payload"],
  ["held", "again", "payload"],
];

const ways: ((last: string) => { end: string; read: string; throws?: boolean })[] = [
  last => ({ end: `function read() { return ${last}; }\n  if (leaves) return { read };`, read: `made.read()` }),
  last => ({ end: `if (leaves) return { value: ${last} };`, read: `made.value` }),
  last => ({
    end: `if (leaves) kept = ${last};\n  return leaves ? { read: () => kept } : undefined;`,
    read: `made.read()`,
  }),
  last => ({
    end: `try { if (leaves) throw 1; } catch (e) { const value = ${last}; return { read: () => value }; }`,
    read: `made.read()`,
  }),
  last => ({
    end: `let found;\n  for (let i = 0; i < 3; i++) { if (leaves && i === 1) found = ${last}; }\n  return leaves ? { read: () => found } : undefined;`,
    read: `made.read()`,
  }),
  last => ({ end: `if (leaves) throw { read: () => ${last} };`, read: `made.read()`, throws: true }),
  last => ({
    end: `let count = 0;\n  for (let i = 0; i < seed; i++) count += i;\n  if (leaves) return { value: ${last}, count };`,
    read: `made.value`,
  }),
  last => ({
    end: `for (let i = 0; i < 2; i++) { if (leaves && i) kept = ${last}; }\n  return leaves ? { read: () => kept } : undefined;`,
    read: `made.read()`,
  }),
  last => ({
    end: `if (leaves) return { value: ${last} };\n  if (seed === 3) return { value: [${last}] };`,
    read: `made.value`,
  }),
  last => ({
    end: `switch (leaves ? seed : -1) {\n    case 0: return { value: ${last} };\n    case 1: return { value: [${last}] };\n    case 2: kept = ${last}; return { value: kept };\n    case 3: case 4: return { value: { last: ${last} } };\n  }`,
    read: `made.value`,
  }),
];

const makers = ["constructor", "class", "literal", "holder first"] as const;

export function generate(random: Random): string {
  const depth = random.between(2, 4);
  const store = random.pick(stores);
  const payload = random.pick(payloads);
  const order = random.pick(orders);
  const maker = random.pick(makers);
  const mayFail = random.chance(0.5);
  const levels = Array.from({ length: depth }, (_, level) => level);
  const { end, read, throws } = random.pick(ways)(`n${depth - 1}`);

  const fields = (target: string, ownPayload: string) =>
    order
      .map((field, index) => {
        const [name, value] = {
          payload: ["rest", ownPayload],
          held: ["head", "head"],
          extra: ["extra", "seed + 1"],
          again: ["again", "head"],
        }[field];
        return store(1 << index, target, name, value);
      })
      .join("\n    ");
  const flagsOf = (level: number) => `(allFlags >> ${4 * level}) & 15`;
  const heldBy = (level: number) => (level ? `n${level - 1}` : `seed`);
  const failure = mayFail ? `if (flags & 8) throw new Error("no");` : ``;

  const lines: string[] = [];
  const parameters = `head, seed, flags${payload.parameter}`;
  if (maker === "constructor")
    lines.push(`function Node(${parameters}) {\n    ${failure}\n    ${fields("this", payload.inConstructor)}\n  }`);
  if (maker === "class")
    lines.push(
      `class Node {\n    constructor(${parameters}) {\n    ${failure}\n    ${fields("this", payload.inConstructor)}\n    }\n  }`,
    );
  if (maker === "constructor" || maker === "class") {
    for (const level of levels)
      lines.push(
        `let n${level};\n  try { n${level} = new Node(${heldBy(level)}, seed + ${level}, ${flagsOf(level)}${payload.arguments}); } catch (e) {}`,
      );
  }
  if (maker === "literal") {
    for (const level of levels)
      lines.push(
        `let n${level};\n  try {\n    const flags = ${flagsOf(level)}, head = ${heldBy(level)};\n    ${failure}\n    const made = {};\n    ${fields("made", payload.inPlace)}\n    n${level} = made;\n  } catch (e) {}`,
      );
  }
  if (maker === "holder first") {
    for (const level of levels.toReversed())
      lines.push(
        `let n${level};\n  try { ${mayFail ? `if ((${flagsOf(level)}) & 8) throw 0; ` : ``}n${level} = {}; } catch (e) {}`,
      );
    for (const level of levels)
      lines.push(
        `if (n${level}) {\n    const flags = ${flagsOf(level)}, head = ${heldBy(level)};\n    ${fields(`n${level}`, payload.inPlace)}\n  }`,
      );
  }
  lines.push(end);

  const call = throws
    ? `let made;\n    try { made = make(flags % 5, flags, leaves); } catch (e) { made = e; }`
    : `const made = make(flags % 5, flags, leaves);`;
  return `let kept;
function make(seed, allFlags, leaves) {
  ${lines.join("\n  ")}
}
function show(value) {
  return JSON.stringify(value, (key, part) => (typeof part === "function" ? "function" : part));
}
for (let flags = 0; flags < ${1 << (4 * depth)}; flags += ${depth === 2 ? 1 : 37}) {
  for (const leaves of [false, true]) {
    ${call}
    console.log(flags, leaves, made ? show(${read}) : "nothing");
  }
}
`;
}
