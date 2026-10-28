// JSON.stringify is given records and lists that hold themselves, hold one object twice, or hold neither, with members around them that run the program's own code.
//
//   shapes    records in records, lists in records, records in lists, one to five levels, or a chain of up to three thousand records of one type
//   closed    by a member or an element that holds the outermost value, one in the middle, or its own holder; by what a toJSON returns; not at all; one object held twice side by side
//   around    a toJSON in a literal and in a class, a getter, a proxy, a date, a big integer, a function, plain values, a toJSON that takes a member away from its holder or gives it one
//   types     unknown, any, an interface that names itself
//   asked     alone, with a replacer function, with a list of names, with an indent
//   from      the top level, a loop, a function called twice, a callback, an async function
//
// Each call prints its answer or its error, how often the program's code ran, and in which order.
import type { Random } from "./random";

const prelude = `export {};
const log: string[] = [];
function note(text: string): void {
  log.push(text);
}
function print(name: string, answer: unknown): void {
  const text = String(answer);
  console.log(name, text.length > 300 ? text.length + " characters" : text, log.length, log.slice(0, 16).join());
  log.length = 0;
}
class Stamp {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
  toJSON(key: string): unknown {
    note("stamp " + this.id + " at " + key);
    return this.id;
  }
}
function watched(id: number): object {
  return new Proxy(
    { p: id },
    {
      ownKeys(target) {
        note("keys " + id);
        return Reflect.ownKeys(target);
      },
      get(target, key, receiver) {
        note("get " + id + " " + String(key));
        return Reflect.get(target, key, receiver);
      },
    },
  );
}
`;

type Level = "record" | "list";

export function generate(random: Random): string {
  const text: string[] = [prelude];
  const scenes = random.between(5, 9);
  let mayIndentACycle = true;

  for (let scene = 1; scene <= scenes; scene++) {
    let nextId = scene * 100;
    const memberType = random.pick(["unknown", "any"]);
    const lines: string[] = [];
    const root = `root${scene}`;

    // What stands beside the way down. `holder` is an expression for the record or the list that holds it.
    const beside = (holder: string, isInList: boolean): string => {
      const id = ++nextId;
      return random.weighted<() => string>([
        [5, () => `{ toJSON() { note("json ${id}"); return ${id}; } }`],
        [3, () => `new Stamp(${id})`],
        [3, () => `{ get g() { note("getter ${id}"); return ${id}; } }`],
        [2, () => `watched(${id})`],
        [4, () => random.pick(["1", "2.5", '"text"', "null", "undefined", "true", "[]", "{}", "[1, 2]", '{ k: "v" }'])],
        [1, () => "new Date(86400000)"],
        [1, () => "10n"],
        [1, () => "() => 1"],
        [1, () => `{ toJSON() { note("json ${id}"); return undefined; } }`],
        [1, () => `{ toJSON() { note("json ${id}"); return ${root}; } }`],
        [
          1,
          () =>
            isInList
              ? `{ toJSON() { note("json ${id}"); (${holder} as unknown[]).length = 1; return ${id}; } }`
              : `{ toJSON() { note("json ${id}"); delete (${holder} as any).z; return ${id}; } }`,
        ],
        [
          1,
          () =>
            isInList
              ? `{ toJSON() { note("json ${id}"); (${holder} as unknown[]).push(${id}); return ${id}; } }`
              : `{ toJSON() { note("json ${id}"); (${holder} as any).added = ${id}; return ${id}; } }`,
        ],
      ])();
    };

    let type: string;
    let isClosed: boolean;
    const shape = random.weighted([
      [5, "levels"],
      [3, "chain"],
      [2, "tree"],
    ] as const);
    if (shape === "levels") {
      const levels: Level[] = Array.from({ length: random.between(1, 5) }, () =>
        random.weighted([
          [3, "record"],
          [2, "list"],
        ] as const),
      );
      type = levels[0] === "record" ? `{ a: ${memberType}; next: ${memberType}; z: ${memberType} }` : `${memberType}[]`;
      const name = (level: number) => (level === 0 ? root : `${root}level${level}`);
      for (let level = 0; level < levels.length; level++) {
        const declared =
          levels[level] === "record"
            ? `{ a: ${memberType}; next: ${memberType}; z: ${memberType} }`
            : `${memberType}[]`;
        lines.push(
          `const ${name(level)}: ${declared} = ${levels[level] === "record" ? "{ a: null, next: null, z: null }" : "[null, null, null]"};`,
        );
      }
      const ending = random.weighted([
        [6, "cycle"],
        [2, "none"],
        [2, "twice"],
      ] as const);
      isClosed = ending === "cycle";
      for (let level = 0; level < levels.length; level++) {
        const isList = levels[level] === "list";
        const [a, next, z] = isList ? ["[0]", "[1]", "[2]"] : [".a", ".next", ".z"];
        const isLast = level + 1 === levels.length;
        const child = !isLast
          ? name(level + 1)
          : ending === "cycle"
            ? name(random.below(levels.length))
            : ending === "twice"
              ? `shared${scene}`
              : "0";
        if (isLast && ending === "twice") lines.push(`const shared${scene} = { s: ${beside(name(level), false)} };`);
        lines.push(
          `${name(level)}${a} = ${isLast && ending === "twice" ? `shared${scene}` : beside(name(level), isList)};`,
        );
        lines.push(`${name(level)}${next} = ${child};`);
        lines.push(`${name(level)}${z} = ${beside(name(level), isList)};`);
      }
    } else if (shape === "chain") {
      type = `Link${scene}`;
      const length = random.pick([1, 2, 3, 5, 17, 300, 3000]);
      const target = random.below(length);
      isClosed = random.chance(0.7);
      const watchedLink = random.below(length);
      const hasLongText = length <= 17 && random.chance(0.25);
      lines.push(
        `interface Link${scene} { a: ${memberType}; text: string; next: Link${scene} | null; z: ${memberType} }`,
      );
      lines.push(`const links${scene}: Link${scene}[] = [];`);
      lines.push(
        `for (let i = 0; i < ${length}; i++) links${scene}.push({ a: i, text: ${hasLongText ? '"t".repeat(50000)' : '"t" + i'}, next: null, z: i });`,
      );
      lines.push(`for (let i = 0; i + 1 < ${length}; i++) links${scene}[i].next = links${scene}[i + 1];`);
      lines.push(`const ${root} = links${scene}[0];`);
      if (isClosed) lines.push(`links${scene}[${length - 1}].next = links${scene}[${target}];`);
      if (random.chance(0.8))
        lines.push(
          `links${scene}[${watchedLink}].${random.pick(["a", "z"])} = ${beside(`links${scene}[${watchedLink}]`, false)};`,
        );
    } else {
      type = `Branch${scene}`;
      isClosed = random.chance(0.7);
      lines.push(`interface Branch${scene} { a: ${memberType}; list: Branch${scene}[]; z: ${memberType} }`);
      lines.push(`const ${root}: Branch${scene} = { a: null, list: [], z: null };`);
      lines.push(`const ${root}left: Branch${scene} = { a: null, list: [], z: null };`);
      lines.push(`const ${root}right: Branch${scene} = { a: null, list: [], z: null };`);
      for (const branch of [root, `${root}left`, `${root}right`]) {
        lines.push(`${branch}.a = ${beside(branch, false)};`);
        lines.push(`${branch}.z = ${beside(branch, false)};`);
      }
      lines.push(`${root}.list.push(${root}left, ${root}right);`);
      lines.push(
        isClosed
          ? `${root}${random.pick(["left", "right"])}.list.push(${random.pick([root, `${root}left`, `${root}right`])});`
          : `${root}right.list.push(${root}left);`,
      );
    }

    let rest = random.weighted([
      [6, ""],
      [2, `, (key: string, value: unknown) => { note("replacer " + key); return value; }`],
      [1, `, ["a", "next", "z", "list", "text", "g", "p", "s"]`],
      [1, `, null, 2`],
    ]);
    if (rest === ", null, 2" && isClosed) {
      if (!mayIndentACycle) rest = "";
      mayIndentACycle = false;
    }

    const call = (value: string) => `JSON.stringify(${value}${rest})`;
    const name = JSON.stringify(`scene ${scene}`);
    switch (random.pick(["top", "loop", "twice", "callback", "async"] as const)) {
      case "top":
        lines.push(`try { print(${name}, ${call(root)}); } catch (error) { print(${name}, error); }`);
        break;
      case "loop":
        lines.push(
          `for (const value of [${root}, ${root}]) {`,
          `  try { print(${name}, ${call("value")}); } catch (error) { print(${name}, error); }`,
          `}`,
        );
        break;
      case "twice":
        lines.push(
          `function write${scene}(value: ${type}): void {`,
          `  try { print(${name}, ${call("value")}); } catch (error) { print(${name}, error); }`,
          `}`,
          `write${scene}(${root});`,
          `write${scene}(${root});`,
        );
        break;
      case "callback":
        lines.push(
          `[${root}].forEach(value => {`,
          `  try { print(${name}, ${call("value")}); } catch (error) { print(${name}, error); }`,
          `});`,
        );
        break;
      case "async":
        lines.push(
          `async function write${scene}(value: ${type}): Promise<string | undefined> {`,
          `  await null;`,
          `  return ${call("value")};`,
          `}`,
          `await write${scene}(${root}).then(answer => print(${name}, answer), error => print(${name}, error));`,
        );
        break;
    }
    text.push(lines.join("\n"));
  }
  return text.join("\n") + "\n";
}
