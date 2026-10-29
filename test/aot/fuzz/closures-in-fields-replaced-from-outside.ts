// Closures kept in fields. A program has 2 to 4 kinds of holder: classes with arrow functions in field initializers, classes that assign
// closures in the constructor, and factories that return object literals. The kinds share their field names. Functions that know nothing
// about their target then replace those fields: by name, by key, with Object.assign, Reflect.set, Object.defineProperty, a destructuring
// pattern, or through a parameter typed as another class. What goes in is the closure of another holder, a new function, or something
// that is no function at all. Typed readers call the field, add up a list, compare two fields, and put a property on the closure and
// read it back. A program has one to three ways to write and a few ways to read, and holds no code for the others. In two programs of
// five only one field of one kind is written, and only with the same field of other holders of that kind: the same function over another
// object. The steps run once or in a loop, and the program prints every answer of the first turns and a digest of all of them.
import type { Random } from "./random";

type Place = { kind: number; key: string; text: string };
type Way = { name: string; step: (to: Place, label: string, other: string) => string };

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const any = typed ? " as any" : "";
  const keys = random.sample(["get", "run", "step", "next"], random.between(1, 3));
  const kinds = random.between(2, 4);
  const count = random.pick([2, 3, 8, 40, 300]);
  // Half of the programs put nothing but functions into the fields.
  const onlyFunctions = random.chance(0.5);
  const out: string[] = [];

  const keysOf: string[][] = [];
  for (let kind = 0; kind < kinds; kind++)
    keysOf.push(kind === 0 ? keys : random.sample(keys, random.between(1, keys.length)));
  const at = () =>
    random.pick([`0`, `1`, `${count - 1}`, `turn % ${count}`, `(turn * 7 + ${random.below(5)}) % ${count}`]);
  const holder = (): Place => {
    const kind = random.below(kinds);
    return { kind, key: random.pick(keysOf[kind]), text: `all${kind}[${at()}]` };
  };
  // Where only one field is written, and only with the same field of its own kind.
  const only = random.chance(0.4) ? holder() : undefined;
  const value = (to: Place) => {
    if (only) return `all${only.kind}[${at()}].${only.key}`;
    const from = random.chance(0.6) ? { ...to, text: `all${to.kind}[${at()}]` } : holder();
    return random.weighted<string>([
      [8, `${from.text}.${from.key}`],
      [2, `() => ${random.between(10, 99)}`],
      [2, `() => turn`],
      [1, `bound(${from.text}.${from.key})`],
      [1, `function named() { return ${random.between(10, 99)}; }`],
      [1, `Math.abs`],
      [1, `class {}`],
      [1, `async () => 1`],
      [
        onlyFunctions ? 0 : 3,
        random.pick([
          `${random.between(1, 9)}`,
          `0.5`,
          `"text"`,
          `null`,
          `undefined`,
          `{ kept: 1 }`,
          `[1]`,
          `true`,
          `Symbol.iterator`,
        ]),
      ],
    ]);
  };

  const writers: (readonly [number, Way])[] = [
    [4, { name: "putByName", step: to => `putByName_${to.key}(${to.text}, ${value(to)});` }],
    [
      4,
      {
        name: "putAsOther",
        step: (to, _, other) => `putAsOther_${to.key}(${to.text}${any}, { from: ${other} }${any});`,
      },
    ],
    [2, { name: "putByKey", step: to => `putByKey(${to.text}, "${to.key}", ${value(to)});` }],
    [1, { name: "putByKey", step: to => `putByKey(${to.text}, ["${to.key}"].join(""), ${value(to)});` }],
    [1, { name: "putByAssign", step: to => `putByAssign(${to.text}, "${to.key}", ${value(to)});` }],
    [1, { name: "putByReflect", step: to => `putByReflect(${to.text}, "${to.key}", ${value(to)});` }],
    [1, { name: "putByDefine", step: to => `putByDefine(${to.text}, "${to.key}", ${value(to)});` }],
    [1, { name: "putByPattern", step: to => `putByPattern_${to.key}(${to.text}, ${value(to)});` }],
    [1, { name: "delete", step: to => `delete (${to.text}${any}).${to.key};` }],
    [1, { name: "make", step: to => `all${to.kind}[${at()}] = make${to.kind}(turn);` }],
  ];
  const of = (to: Place) => `${to.kind}_${to.key}`;
  const call: Way = { name: "call", step: (to, label) => `attempt(${label}, () => call${of(to)}(${to.text}));` };
  const readers: (readonly [number, Way])[] = [
    [5, call],
    [3, { name: "sum", step: (to, label) => `attempt(${label}, () => sum${of(to)}(all${to.kind}));` }],
    [3, { name: "same", step: (to, label, other) => `attempt(${label}, () => same${of(to)}(${to.text}, ${other}));` }],
    [
      2,
      {
        name: "mark take",
        step: (to, label, other) =>
          `attempt(${label}, () => mark${of(to)}(${to.text}, turn) + " " + (take${of(to)}(${other})${any}).mark);`,
      },
    ],
    [2, { name: "take", step: (to, label) => `attempt(${label}, () => take${of(to)}(${to.text}));` }],
    [
      1,
      {
        name: "take",
        step: (to, label) => `attempt(${label}, () => take${of(to)}(${to.text}) === take${of(to)}(${to.text}));`,
      },
    ],
    [
      1,
      {
        name: "take",
        step: (to, label) => `attempt(${label}, () => (take${of(to)}(${to.text})${any}).call({ kept: -1 }));`,
      },
    ],
    [
      1,
      {
        name: "take",
        step: (to, label) => `attempt(${label}, () => [1, 2].map(take${of(to)}(${to.text})${any}).join());`,
      },
    ],
    [1, { name: "", step: (to, label) => `attempt(${label}, () => ({ ...${to.text} }).${to.key}());` }],
    [1, { name: "", step: (to, label) => `attempt(${label}, () => Object.keys(${to.text}).join());` }],
    [1, { name: "", step: (to, label) => `attempt(${label}, () => ${to.text}.kept);` }],
  ];
  const drawn = (ways: (readonly [number, Way])[], most: number) => {
    const some = new Set<Way>();
    for (let left = random.between(1, most); left > 0; left--) some.add(random.weighted(ways));
    return [...some];
  };
  // Half of the programs that write one field do it through the parameter typed as another class and in no other way.
  const narrow = only !== undefined && random.chance(0.5);
  const written = narrow ? [writers[1][1]] : drawn(writers, 3);
  const read = [...new Set([call, ...drawn(readers, 3)])];
  const has = (name: string) => [...written, ...read].some(way => way.name.split(" ").includes(name));

  if (typed) out.push("type Step = (more?: number) => number;");
  out.push(
    `let digest = 0, printed = 0;`,
    `function note(text${as("string")}) {`,
    `  for (let i = 0; i < text.length; i++) digest = (Math.imul(digest, 31) + text.charCodeAt(i)) | 0;`,
    `  if (printed++ < 400) console.log(text);`,
    `}`,
    `function say(value${as("unknown")})${as("string")} {`,
    `  if (typeof value === "function") return "function/" + value.length;`,
    `  if (typeof value === "symbol") return "symbol";`,
    `  if (typeof value === "object" && value !== null) return "object " + Object.keys(value).join();`,
    `  return typeof value + " " + String(value);`,
    `}`,
    `function bound(value${as("unknown")}) {`,
    `  return typeof value === "function" ? value.bind(null) : value;`,
    `}`,
    `function attempt(label${as("string")}, take${as("() => unknown")}) {`,
    `  try {`,
    `    note(label + " " + say(take()));`,
    `  } catch (error) {`,
    `    note(label + " throws " + (error${any}).name);`,
    `  }`,
    `}`,
  );

  // What a closure does with what it captures. `self` is how the body names its holder; `local` is a captured local.
  const bodies = (self: string, local: string) => [
    `() => ${self}.kept`,
    `() => ${self}.kept + ${random.between(1, 9)}`,
    `() => ++${self}.kept`,
    `(more${as("number")} = 1) => ${self}.kept * more`,
    `() => ${local}`,
    `() => ${local} + ${self}.kept`,
    `(more${as("number")} = 2) => ${local} * more`,
  ];

  for (let kind = 0; kind < kinds; kind++) {
    const mine = keysOf[kind];
    const declared = () => (typed && random.chance(0.5) ? ": Step" : "");
    const shape =
      narrow && kind === only!.kind
        ? "initializers"
        : random.pick(["initializers", "initializers", "constructor", "factory", "factory with a counter"]);
    if (shape === "initializers") {
      out.push(`class Holder${kind} {`, `  kept${as("number")};`);
      for (const key of mine) out.push(`  ${key}${declared()} = ${random.pick(bodies("this", "7").slice(0, 4))};`);
      out.push(`  constructor(kept${as("number")}) {`, `    this.kept = kept;`, `  }`, `}`);
      out.push(`const make${kind} = (kept${as("number")}) => new Holder${kind}(kept);`);
    } else if (shape === "constructor") {
      out.push(`class Holder${kind} {`, `  kept${as("number")};`);
      if (typed) for (const key of mine) out.push(`  ${key}: Step;`);
      out.push(`  constructor(kept${as("number")}) {`, `    this.kept = kept;`, `    const local = kept * 3;`);
      for (const key of mine) out.push(`    this.${key} = ${random.pick(bodies("this", "local"))};`);
      out.push(`  }`, `}`, `const make${kind} = (kept${as("number")}) => new Holder${kind}(kept);`);
    } else {
      const counts = shape === "factory with a counter";
      if (typed) out.push(`interface Holder${kind} {`, `  kept: number;`, ...mine.map(key => `  ${key}: Step;`), `}`);
      out.push(`function make${kind}(kept${as("number")}) {`, `  let local = kept * 5;`);
      out.push(`  const made${as(`Holder${kind}`)} = {`, `    kept,`);
      for (const key of mine)
        out.push(
          `    ${key}: ${counts && random.chance(0.5) ? `() => local++` : random.pick(bodies("made", "local"))},`,
        );
      out.push(`  };`, `  return made;`, `}`);
    }
    out.push(
      `const all${kind}${as(`Holder${kind}[]`)} = [];`,
      `for (let i = 0; i < ${count}; i++) all${kind}.push(make${kind}(i + ${kind * 100}));`,
    );
  }

  // Typed readers, for each kind and key.
  for (let kind = 0; kind < kinds; kind++)
    for (const key of keysOf[kind]) {
      const name = `${kind}_${key}`;
      const one = `holder${as(`Holder${kind}`)}`;
      out.push(`function call${name}(${one}) {`, `  return holder.${key}();`, `}`);
      if (has("sum"))
        out.push(
          `function sum${name}(list${as(`Holder${kind}[]`)}) {`,
          `  let sum = 0;`,
          `  for (const holder of list) sum += holder.${key}();`,
          `  return sum;`,
          `}`,
        );
      if (has("same"))
        out.push(
          `function same${name}(${one}, other${as(`Holder${kind}`)}) {`,
          `  return holder.${key} === other.${key};`,
          `}`,
        );
      if (has("mark"))
        out.push(
          `function mark${name}(${one}, value${as("number")}) {`,
          `  (holder.${key}${any}).mark = value;`,
          `  return (holder.${key}${any}).mark;`,
          `}`,
        );
      if (has("take")) out.push(`function take${name}(${one}) {`, `  return holder.${key};`, `}`);
    }

  // Writers that know nothing about their target. Each also gets targets that are no holders, one of them out of JSON.parse.
  const target = as("any");
  const strangers = [`{}`, `[]`, `function () {}`, `Object.create(null)`, `{ kept: 1 }`];
  const harmless = () => (only ? value(only) : onlyFunctions ? "() => 1" : random.pick(["1", "() => 1", "null"]));
  const source = (key: string) => (only ? `all${only.kind}[${at()}]` : `new Other_${key}()`);
  out.push(`const turn = 0;`);
  for (const key of only ? [only.key] : keys) {
    if (has("putByName")) {
      out.push(`function putByName_${key}(target${target}, value${target}) {`, `  target.${key} = value;`, `}`);
      out.push(
        `putByName_${key}(${random.pick(strangers)}, ${harmless()});`,
        `putByName_${key}(JSON.parse("{}"), ${harmless()});`,
      );
    }
    if (has("putByPattern")) {
      out.push(
        `function putByPattern_${key}(target${target}, value${target}) {`,
        `  ({ ${key}: target.${key} } = { ${key}: value });`,
        `}`,
      );
      out.push(
        `putByPattern_${key}(${random.pick(strangers)}, ${harmless()});`,
        `putByPattern_${key}(JSON.parse("{}"), ${harmless()});`,
      );
    }
    if (has("putAsOther")) {
      out.push(`class Other_${key} {`, `  ${key}${as("Step")} = () => 0;`, `}`);
      out.push(
        `function putAsOther_${key}(target${as(`Other_${key}`)}, source${as(`{ from: { ${key}: Step } }`)}) {`,
        `  target.${key} = source.from.${key};`,
        `}`,
      );
      out.push(
        `putAsOther_${key}(new Other_${key}(), { from: ${source(key)} });`,
        `putAsOther_${key}(JSON.parse("{}"), { from: ${source(key)} });`,
      );
    }
  }
  const byKey: Record<string, string> = {
    putByKey: `target[key] = value;`,
    putByAssign: `Object.assign(target, { [key]: value });`,
    putByReflect: `Reflect.set(target, key, value);`,
    putByDefine: `Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });`,
  };
  for (const [name, body] of Object.entries(byKey))
    if (has(name)) {
      out.push(`function ${name}(target${target}, key${as("string")}, value${target}) {`, `  ${body}`, `}`);
      out.push(
        `${name}(${random.pick(strangers)}, "${only ? only.key : random.pick(keys)}", ${harmless()});`,
        `${name}(JSON.parse("{}"), "${only ? only.key : random.pick(keys)}", ${harmless()});`,
      );
    }

  const steps: string[] = [];
  const total = random.between(8, 30);
  for (let step = 0; step < total; step++) {
    const writes = random.chance(0.4);
    const to = only && (writes || random.chance(0.7)) ? { ...only, text: `all${only.kind}[${at()}]` } : holder();
    steps.push(random.pick(writes ? written : read).step(to, `"${step}"`, `all${to.kind}[${at()}]`));
  }
  // One program in three runs its steps once, outside every loop.
  const turns = narrow && random.chance(0.5) ? 0 : random.pick([0, 0, 0, 1, 2, 5, 60, 60, 700]);
  if (turns === 0) out.push(...steps);
  else out.push(`for (let turn = 0; turn < ${turns}; turn++) {`, ...steps.map(step => "  " + step), `}`);
  out.push(`console.log("digest", digest, printed);`);
  return out.join("\n") + "\n";
}
