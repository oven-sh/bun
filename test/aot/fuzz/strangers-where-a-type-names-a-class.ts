// `holder.part.get(i)`: the type of `part` names a class, and a hot loop reads a member of it by name. What arrives there is an instance of the class, and later things that only look like one.
//
//   the member    a method, a field that holds a function, a getter that answers a function, a method of a class above; beside it a number that is a field, a getter or a member of the prototype
//   the holder    a record, an instance, a list, a Map, a parameter, an optional field, a field whose type is a union of two classes
//   the strangers one to six records with a field of that name, early or late among their fields; a class below that overrides; another class with the same members; an instance with a member of its own;
//                 an object without a prototype, a frozen one, a proxy, a function and a list with such a member, an object that inherits it from a record; null, undefined, nothing at all
//   they come in  by a store under a key that nobody knows, by a cast, by Object.assign, through a function made at run time
//   pass by       some strangers are only stored elsewhere under an unknown key and never arrive
//   changed       between the walks the method of the class is replaced, deleted, put back; a field is added to the instance that is being read
//   then          each walk folds what the member answers over some thousand turns
import type { Random } from "./random";

const prelude = `const pass = new Function("value", "return value") as <T>(value: T) => T;
function put(target: any, key: string, value: unknown): void {
  target[key] = value;
}
function attempt(act: () => unknown): string {
  try {
    return String(act());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}`;

function scene(random: Random, index: number): string {
  const n = String(index);
  const member = random.pick(["get", "get", "at", "read", "size", "name"]);
  const count = random.pick(["count", "length", "width"]);
  const memberKind = random.weighted([[5, "method"], [1, "field"], [1, "getter"], [1, "above"]] as const); // prettier-ignore
  const countKind = random.pick(["field", "field", "getter", "prototype"] as const);
  const method = `${member}(i: number): string {\n    return this.words[i % this.words.length] + this.${count};\n  }`;
  const above =
    memberKind === "above"
      ? `class Above${n} {\n  words: string[] = ["a", "b", "c"];\n  ${countKind === "field" ? `${count}: number = 3;` : `declare ${count}: number;`}\n  ${method}\n}\n`
      : "";
  const part = `${above}class Part${n}${above ? ` extends Above${n}` : ""} {
${above ? "" : `  words: string[] = ["a", "b", "c"];\n`}${above ? "" : countKind === "field" ? `  ${count}: number = 3;\n` : countKind === "getter" ? `  get ${count}(): number {\n    return this.words.length;\n  }\n` : `  declare ${count}: number;\n`}${
    memberKind === "method" ? `  ${method}\n`
    : memberKind === "field" ? `  ${member} = (i: number): string => this.words[i % this.words.length] + this.${count};\n`
    : memberKind === "getter" ? `  get ${member}(): (i: number) => string {\n    return i => this.words[i % this.words.length] + this.${count};\n  }\n`
    : `  extra: number = 1;\n`
  }}
${countKind !== "field" && (above || countKind === "prototype") ? `(${above ? `Above${n}` : `Part${n}`}.prototype as any).${count} = 3;\n` : ""}class Below${n} extends Part${n} {
  ${memberKind === "field" ? `${member} = (i: number): string => "below" + i;` : memberKind === "getter" ? `get ${member}(): (i: number) => string {\n    return i => "below" + i;\n  }` : `${member}(i: number): string {\n    return super.${member}(i) + "!";\n  }`}
}
class Alike${n} {
  ${count}: number = 7;
  ${member}(i: number): string {
    return "alike" + (i & 1) + this.${count};
  }
}`; // prettier-ignore

  const holderKind = random.weighted([[4, "record"], [2, "instance"], [1, "list"], [1, "map"], [1, "parameter"], [1, "optional"], [1, "union"]] as const); // prettier-ignore
  const partType = holderKind === "union" ? `Part${n} | Alike${n}` : `Part${n}`;
  const holderType =
    holderKind === "instance" ? `class Holder${n} {\n  id: number = ${index};\n  part: ${partType} = new Part${n}();\n}`
    : holderKind === "list" ? `type Holder${n} = ${partType}[];`
    : holderKind === "map" ? `type Holder${n} = Map<string, ${partType}>;`
    : holderKind === "parameter" ? `type Holder${n} = { part: unknown };`
    : `type Holder${n} = { id: number; part${holderKind === "optional" ? "?" : ""}: ${partType} };`; // prettier-ignore
  const made =
    holderKind === "instance"
      ? `new Holder${n}()`
      : holderKind === "list"
        ? `[new Part${n}()]`
        : holderKind === "map"
          ? `new Map([["part", new Part${n}()]])`
          : holderKind === "parameter"
            ? `{ part: new Part${n}() }`
            : `{ id: ${index}, part: new Part${n}() }`;
  const reach =
    holderKind === "list"
      ? "holder[0]!"
      : holderKind === "map"
        ? `holder.get("part")!`
        : holderKind === "parameter"
          ? "part"
          : holderKind === "optional"
            ? "holder.part!"
            : "holder.part";
  const use = random.weighted([
    [5, `${reach}.${member}(i)`],
    [1, `${reach}.${member}(i) + ${reach}.${count}`],
    [1, `${reach}.${member}?.(i)`],
    [1, `(${reach}.${count} > 100 ? "" : ${reach}.${member}(i))`],
    [1, `String(${reach}.${count})`],
  ] as const); // prettier-ignore
  const walk = `function walk${n}(holder: Holder${n}, turns: number): string {
  let text = "";
  let sum = 0;${holderKind === "parameter" ? `\n  return inner${n}(holder.part as Part${n}, turns);\n}\nfunction inner${n}(part: Part${n}, turns: number): string {\n  let text = "";\n  let sum = 0;` : ""}
  for (let i = 0; i < turns; i++) {
    const said = ${use};
    if (i < 3) text += said + ",";
    sum += String(said).length;
  }
  return text + sum;
}`;

  const fields = ["port: 80", "secure: true", `host: "h"`, "weight: 1.5", "tags: [1]", "open: null"];
  const record = (k: number) => {
    const others = random.shuffled(fields).slice(0, random.between(0, 4));
    const own = random.pick([
      `${member}(i: number) {\n    return "r${k}-" + i;\n  }`,
      `${member}: (i: number) => "r${k}-" + i`,
      `${member}: (i: number) => i * ${k + 2}`,
    ]);
    const at = random.between(0, others.length);
    return `{ ${[...others.slice(0, at), own, ...others.slice(at), random.chance(0.7) ? `${count}: ${k}` : ""].filter(one => one !== "").join(", ")} }`;
  };
  const records = Array.from({ length: random.between(1, 6) }, (_, k) => `const record${n}_${k} = ${record(k)};`);
  const strangers = [
    ...records.map((_, k) => `record${n}_${k}`),
    `new Below${n}()`,
    `new Alike${n}()`,
    `Object.assign(new Part${n}(), { ${member}: (i: number) => "own" + i })`,
    `Object.assign(new Part${n}(), { added: 1, ${count}: 9 })`,
    `Object.assign(Object.create(null), { ${member}: (i: number) => "bare" + i, ${count}: 1 })`,
    `Object.freeze({ ${member}: (i: number) => "frozen" + i, ${count}: 2 })`,
    `new Proxy(new Part${n}(), {})`,
    `new Proxy({}, { get: (_, key) => (key === "${member}" ? (i: number) => "trap" + i : 5) })`,
    `Object.assign(() => 0, { ${member === "name" || member === "length" ? "other" : member}: (i: number) => "function" + i })`,
    `Object.assign([1, 2], { ${member === "at" ? "other" : member}: (i: number) => "list" + i })`,
    `Object.create(record${n}_0)`,
    `Object.create(new Part${n}())`,
    `{ ${member}: 5 }`,
    `{ get ${member}() { return (i: number) => "got" + i; }, ${count}: 4 }`,
    `new Part${n}()`,
    `new Part${n}()`,
    "null",
    "undefined",
    `"text"`,
    "7",
  ];
  const key = holderKind === "list" ? `"0"` : `"part"`;
  const store = (value: string) =>
    holderKind === "map"
      ? `(holder${n} as Map<string, any>).set(pass("part"), ${value});`
      : random.weighted([
          [4, `put(holder${n}, pass(${key}), ${value});`],
          [2, `(holder${n} as any)[${key}] = ${value};`],
          [1, `Object.assign(holder${n}, { [${key}]: ${value} });`],
          [1, `put(holder${n}, pass(${key}), pass(${value}));`],
        ] as const);
  const turns = () => random.pick(["3", "40", "2000", "2000", "5000"]);
  const told = (label: string) => `console.log("${n} ${label}", attempt(() => walk${n}(holder${n}, ${turns()})));`;
  const owner = above ? `Above${n}` : `Part${n}`;
  const changes = [
    ...(memberKind === "method" || memberKind === "above"
      ? [
          `${owner}.prototype.${member} = function (i: number) {\n  return "<" + i + ">";\n};`,
          `const kept${n} = ${owner}.prototype.${member};\ndelete (${owner}.prototype as any).${member};\n${told("deleted")}\n${owner}.prototype.${member} = kept${n};`,
          `Object.defineProperty(${owner}.prototype, "${member}", { get: () => (i: number) => "late" + i, configurable: true });`,
        ]
      : []),
    `(${owner}.prototype as any).${count === "length" ? "other" : count + "s"} = 1;`,
    ...(holderKind === "map" || holderKind === "list"
      ? []
      : [
          `delete (holder${n} as any).part;\n${told("gone")}\nObject.setPrototypeOf(holder${n}, { part: record${n}_0 });`,
          `Object.defineProperty(holder${n}, "part", { get: () => record${n}_0, configurable: true });`,
        ]),
  ];
  const lines = [
    part,
    holderType,
    walk,
    ...records,
    `const elsewhere${n}: Record<string, unknown> = {};`,
    ...records.filter(() => random.chance(0.6)).map((_, k) => `put(elsewhere${n}, pass("k${k}"), record${n}_${k});`),
    `const holder${n}: Holder${n} = ${made};`,
    told("first"),
  ];
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\n  console.log("${n} threw", (error as Error).constructor.name);\n}`;
  let changed = 0;
  for (let step = random.between(3, 9); step > 0; step--) {
    if (changed < 1 && random.chance(0.15)) {
      changed++;
      lines.push(guarded(random.pick(changes)), told("changed"));
    } else {
      const value = random.pick(strangers);
      lines.push(
        guarded(store(value)),
        told(
          value
            .replace(/[^A-Za-z]+/g, " ")
            .trim()
            .slice(0, 24),
        ),
      );
    }
  }
  return lines.join("\n");
}

export function generate(random: Random): string {
  return (
    [prelude, ...Array.from({ length: random.between(1, 3) }, (_, index) => scene(random, index)), "export {};"].join(
      "\n",
    ) + "\n"
  );
}
