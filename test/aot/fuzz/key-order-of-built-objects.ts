// The order of an object's keys is the order in which they were added. Each scene builds an object with a known key
// order in one of many ways (a literal, Object.assign, spread, stores, a class, Object.fromEntries, JSON.parse, delete
// and add again ..) next to other objects that have the same keys in another order, and lists its keys in every way the
// language has: once, in a loop, and in a function that is called often.
import type { Random } from "./random";

type Entry = [key: string, value: string];
const literal = (entries: Entry[]) => `{ ${entries.map(([key, value]) => `${key}: ${value}`).join(", ")} }`;
const stores = (entries: Entry[], to = "made") => entries.map(([key, value]) => `${to}.${key} = ${value};`).join(" ");

/** Each returns an expression for an object whose keys are in the order of `entries`. `id` is unique in the program. */
const makers: Record<string, (entries: Entry[], id: string) => string> = {
  "a literal": entries => literal(entries),
  "Object.assign onto a literal": entries =>
    `Object.assign(${literal(entries.slice(0, 1))}, ${literal(entries.slice(1))})`,
  "Object.assign onto an empty literal": entries =>
    `Object.assign({}, ${entries.map(entry => literal([entry])).join(", ")})`,
  "a spread first": entries => `{ ...${literal(entries.slice(0, -1))}, ${entries.at(-1)!.join(": ")} }`,
  "a spread last": entries => `{ ${entries[0].join(": ")}, ...${literal(entries.slice(1))} }`,
  "two spreads": entries => `{ ...${literal(entries.slice(0, 1))}, ...${literal(entries.slice(1))} }`,
  "stores": entries => `(() => { const made = {}; ${stores(entries)} return made; })()`,
  "stores after a literal": entries =>
    `(() => { const made = ${literal(entries.slice(0, 1))}; ${stores(entries.slice(1))} return made; })()`,
  "class fields": (entries, id) =>
    `new (class Fields${id} { ${entries.map(([key, value]) => `${key} = ${value};`).join(" ")} })()`,
  "a constructor": (entries, id) => `new (class Built${id} { constructor() { ${stores(entries, "this")} } })()`,
  "a constructor function": (entries, id) => `new (function Made${id}() { ${stores(entries, "this")} })()`,
  "Object.fromEntries": entries =>
    `Object.fromEntries([${entries.map(([key, value]) => `["${key}", ${value}]`).join(", ")}])`,
  "JSON.parse": entries => `JSON.parse('{${entries.map(([key], at) => `"${key}":${at}`).join(",")}}')`,
  "structuredClone": entries => `structuredClone(${literal(entries)})`,
  "delete and add again": entries =>
    `(() => { const made = ${literal([entries.at(-1)!, ...entries.slice(0, -1)])}; delete made.${entries.at(-1)![0]}; made.${entries.at(-1)!.join(" = ")}; return made; })()`,
  "Object.defineProperty": entries =>
    `(() => { const made = {}; ${entries.map(([key, value]) => `Object.defineProperty(made, "${key}", { value: ${value}, writable: true, enumerable: true, configurable: true });`).join(" ")} return made; })()`,
  "the rest of a pattern": entries => `(({ dropped, ...rest }) => rest)(${literal([["dropped", "0"], ...entries])})`,
  "computed keys": entries => `{ ${entries.map(([key, value]) => `["${key}"]: ${value}`).join(", ")} }`,
  "a literal with a computed value": entries =>
    `{ ${entries.map(([key, value], at) => `${key}: ${at ? value : `pass(${value})`}`).join(", ")} }`,
};

/** Expressions that list the keys or values of `IT` in order. */
const listings = [
  "Object.keys(IT).join()",
  "Object.values(IT).join()",
  'Object.entries(IT).join("|")',
  "JSON.stringify(IT)",
  "Reflect.ownKeys(IT).join()",
  "Object.getOwnPropertyNames(IT).join()",
  "Object.keys({ ...IT }).join()",
  "Object.keys(Object.assign({}, IT)).join()",
  "Object.keys(Object.getOwnPropertyDescriptors(IT)).join()",
  "keysByForIn(IT)",
  "[...new Map(Object.entries(IT)).keys()].join()",
];

/** Statements that evaluate `LIST` and leave the result in `listed`. */
const contexts = [
  "listed = LIST;",
  "for (let i = 0; i < 3; i++) listed = LIST;",
  "for (let i = 0; i < 300; i++) listed = LIST;",
  'for (let i = 0; i < 3; i++) listed += LIST + " ";',
  "try {\n  listed = LIST;\n} catch (error) {\n  listed = error.name;\n}",
  'listed = [0, 1].map(() => LIST).join(" ");',
  "do listed = LIST;\nwhile (listed === undefined);",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, count = random.between(3, 7); scene < count; scene++) {
    // Make the random choices first.
    const keys = random.sample(["a", "b", "c", "d", "e"], random.between(2, 4));
    const valueOf = () => random.pick(["1", "2.5", '"s"', "null", "undefined", "true", "[]", "{ inner: 1 }", "-0"]);
    const build = (name: string, order: string[]) =>
      `const ${name} = ${random.pick(Object.values(makers))(
        order.map(key => [key, valueOf()]),
        `${scene}${name}`,
      )};`;
    const siblings = Array.from({ length: random.between(0, 2) }, (_, at) =>
      build(`sibling${at}`, random.chance(0.8) ? random.shuffled(keys) : [...keys].reverse()),
    );
    const isFirst = random.chance(0.5);
    const subject = build("subject", keys);
    const lists = Array.from({ length: random.between(1, 4) }, () =>
      random
        .pick(contexts)
        .replace("LIST", random.pick(listings).replaceAll("IT", random.chance(0.85) ? "subject" : "sibling0")),
    ).filter(list => siblings.length || !list.includes("sibling0"));
    const change = random.pick(["", "", "", `subject.${keys[0]} = "changed";`, "subject.late = 1;", `delete subject.${keys[0]};`]); // prettier-ignore
    const body = [
      ...(isFirst ? [subject, ...siblings] : [...siblings, subject]),
      'let listed = "";',
      ...lists.map(list => `${list}\nout.push(listed);`),
      change && `${change}\n${lists[0] ?? ""}\nout.push(listed);`,
      // The siblings are used, so that they are not removed.
      ...siblings.map((_, at) => `out.push(typeof sibling${at}.${keys[0]});`),
    ]
      .filter(Boolean)
      .join("\n");
    const calls = random.pick([1, 1, 2, 200]);
    scenes.push(`function scene${scene}() {
const out = [];
${body}
return out.join(" ; ");
}
${calls === 1 ? "" : `for (let call = 1; call < ${calls}; call++) scene${scene}();\n`}console.log("scene ${scene}", scene${scene}());`);
  }
  return `const pass = value => value;
function keysByForIn(object) {
  let keys = "";
  for (const key in object) keys += key;
  return keys;
}
${scenes.join("\n")}
`;
}
