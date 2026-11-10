// Generates random programs in which loops read and store number fields of objects. Classes with the same fields exist beside the objects, constructed or not, and start the fields at values of other kinds.
// The objects come from literals, from a JSON.parse reviver, from JSON text, from copies or from a class, so the compiler knows their fields to a different degree.
// Each program prints the result of every call and all fields of the object after it. The program number is the random seed.
//
//   bun write-random-field-loop-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<classes>-classes--<loops>-loops--<source>--<construction>.mjs or .ts
//   bun write-random-field-loop-sweep.ts count
import { mkdirSync, writeFileSync } from "fs";

const total = 4_000_000;

function createRandom(seed: number) {
  let state = (seed * 2654435761 + 12345) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let hash = Math.imul(state ^ (state >>> 15), state | 1);
    hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
    return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
  };
  const below = (end: number) => Math.floor(next() * end);
  return { below, chance: (of: number) => next() < of, pick: <T>(from: readonly T[]): T => from[below(from.length)] };
}

const fields = ["n", "sum", "last"] as const;
const sources = ["literal", "reviver", "json", "spread", "object-assign", "global", "array-element", "class"] as const;
const constructions = ["never", "in-unreached-loop", "in-uncalled-function", "once"] as const;

function write(seed: number): { name: string; text: string } {
  const random = createRandom(seed);
  const isTyped = random.chance(0.25);
  const anyType = isTyped ? ": any" : "";
  const value = () =>
    random.pick(["0", "1", "2", "7", "0.5", "1.5", "-1", "-0", "2147483647", "true", "false", '"7"', "null"]);
  const number = () => random.pick(["0", "1", "1", "7", "0.5", "2.5", "-1", "1000"]);
  const list = `[${Array.from({ length: 4 + random.below(5) }, () => random.pick(["1", "2", "3", "4", "18", "62", "0.5"])).join(", ")}]`;

  // Classes that share fields with the object.
  const classCount = random.pick([0, 1, 2, 4, 4, 4]);
  const lines: string[] = [];
  const source = random.chance(0.4) ? "reviver" : random.pick(sources);
  const classes: string[][] = [];
  for (let index = 0; index < classCount; index++) {
    const own: string[] = fields.filter(() => random.chance(index === 0 ? 0.6 : 0.1));
    classes.push(own);
    const members = isTyped ? `list: any; ${own.map(name => `${name}: any; `).join("")}` : "";
    lines.push(
      `class C${index} { ${members}constructor(list${anyType}) { this.list = list; ${own.map(name => `this.${name} = ${number()};`).join(" ")} } }`,
    );
  }
  const construction = !classCount ? "never" : random.chance(0.4) ? "in-unreached-loop" : random.pick(constructions);
  if (source === "reviver")
    lines.push(`function revive(value${anyType})${anyType} { return JSON.parse("0", () => value); }`);

  // The function that loops.
  const loopCount = 1 + random.below(3);
  const body: string[] = [];
  const operand = (index: string) =>
    random.pick([`o.list[${index}]`, `o.list[${index} >> 1]`, index, number(), "o.n", "o.sum", "o.last"]);
  const statement = (index: string) => {
    const field = random.pick(fields);
    const other = random.pick(fields);
    switch (random.below(10)) {
      case 0:
        return `o.${field} = (o.${field} + ${number()}) | 0;`;
      case 1:
        return `o.${field} += ${number()};`;
      case 2:
        return `o.${field} = (o.${field} * 31 + ${operand(index)}) | 0;`;
      case 3:
        return `o.${field} = o.${other} + ${operand(index)};`;
      case 4:
        return `total += o.${field};`;
      case 5:
        return `if (o.${field} > o.${other}) o.${field} = ${operand(index)};`;
      case 6:
        return `o.${field} = ${index};`;
      case 7:
        return `const kept = o.${field}; o.${field} = (kept + 1) | 0; total += kept;`;
      case 8:
        return `o.${field} = Math.floor(o.${field} / 2) + ${operand(index)};`;
      default:
        return `o.${field}++;`;
    }
  };
  // Half of the programs begin with a loop that makes one field a fraction and a loop that stores another field and then computes the first as an integer.
  const startsWithPair = random.chance(0.5);
  if (startsWithPair) {
    const field = random.pick(fields);
    const other = random.pick(fields.filter(name => name !== field));
    const step = random.pick(["+= 0.5", "+= 0.5", "/= 2", "+= 2 ** 40", "+= 1", '+= "x"']);
    const store = random.pick([`(o.${other} + 1) | 0`, `(o.${other} + 1) | 0`, "i", `o.${other} + 0.5`, `o.${field}`]);
    const compute = random.pick([`(o.${field} * 31 + o.list[i >> 1]) | 0`, `(o.${field} + o.list[i >> 1]) | 0`, `(o.${field} * 31 + i) | 0`, `Math.floor(o.${field} * 31 + o.list[i >> 1])`]); // prettier-ignore
    const stores = [`o.${other} = ${store};`, `o.${field} = ${compute};`];
    if (random.chance(0.2)) stores.reverse();
    body.push(
      `  for (let j = 0; j < ${random.pick(["1", "3", "3", "4"])}; j++) o.${field} ${step};`,
      `  for (let i = 0; i < ${random.pick(["1", "8", "8"])}; i++) {\n    ${stores.join("\n    ")}\n  }`,
    );
  }
  for (let loop = 0; loop < (startsWithPair ? loopCount - 1 : loopCount); loop++) {
    const index = "i" + loop;
    const end = random.pick(["1", "3", "4", "8", "o.list.length"]);
    const statements = Array.from({ length: 1 + random.below(3) }, () => `{ ${statement(index)} }`);
    body.push(
      random.chance(0.8)
        ? `  for (let ${index} = 0; ${index} < ${end}; ${index}++) {\n    ${statements.join("\n    ")}\n  }`
        : `  let ${index} = 0;\n  while (${index} < ${end}) {\n    ${statements.join("\n    ")}\n    ${index}++;\n  }`,
    );
  }
  lines.push(`function run(o${anyType}) {\n  let total${anyType} = 0;\n${body.join("\n")}\n  return total;\n}`);

  // Classes are constructed, or could be.
  const made = classes.map((_, index) => `new C${index}([1])`);
  if (construction === "in-unreached-loop")
    lines.push(`const rows${isTyped ? ": any[]" : ""} = [];\nfor (const row of rows) console.log(typeof new C0(row));`);
  else if (construction === "in-uncalled-function")
    lines.push(`function unused() {\n  return [${made.join(", ")}];\n}`);
  else if (construction === "once") lines.push(`console.log(typeof ${random.pick(made)});`);

  // The objects and the calls.
  const calls = 1 + random.below(2);
  for (let call = 0; call < calls; call++) {
    const order = random.chance(0.8) ? ["list", ...fields] : ["sum", "n", "list", "last"];
    const extra = random.chance(0.2) ? ", more: 0" : "";
    const literal = `{ ${order.map(name => `${name}: ${name === "list" ? list : random.chance(0.7) ? number() : value()}`).join(", ")}${extra} }`;
    const made = {
      literal,
      reviver: `revive(${literal})`,
      json: `JSON.parse(JSON.stringify(${literal}))`,
      spread: `{ ...${literal} }`,
      "object-assign": `Object.assign({}, ${literal})`,
      global: `((globalThis${isTyped ? " as any" : ""}).state${call} = ${literal})`,
      "array-element": `[${literal}][process.argv.length - 2]`,
      class: classCount ? `Object.assign(new C0(${list}), ${literal})` : literal,
    }[source];
    lines.push(
      `const object${call}${anyType} = ${made};`,
      `try {\n  console.log(run(object${call}));\n} catch (error) {\n  console.log("threw");\n}`,
      `console.log(Object.keys(object${call}).map(name => name + "=" + (Object.is(object${call}[name], -0) ? "-0" : object${call}[name])).join(" "));`,
    );
  }
  if (isTyped) lines.push("export {};");
  return {
    name: `${classCount}-classes--${loopCount}-loops--${source}--${construction}.${isTyped ? "ts" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
