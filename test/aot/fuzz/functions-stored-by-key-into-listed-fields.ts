// A literal lists its fields, and functions are stored into them under keys made at run time, as an event emitter keeps its
// listeners. Where the compiler knows every writer, a field holds one known function, a list of it, or undefined, and a store
// by key has to test that the value is that function. Each scene stores the usual function often and then something else: the
// same function with other captures, with properties of its own, bound, wrapped in a proxy, another function of the same
// form, a class, a method, an async function, a generator, a list of other things. Then every field is read, called and
// described, so a value taken for another one shows.
import type { Random } from "./random";

/** Declarations of `usual`, the function that is stored often. */
const usuals = [
  'function usual() {\n    return "usual";\n  }',
  'const usual = () => "usual";',
  'const usual = function () {\n    return "usual";\n  };',
  'const word = key("usual");\n  const usual = () => word;',
  'const made = CAST(text => () => text);\n  const usual = made("usual");',
  'let calls = 0;\n  const usual = () => "usual " + (++calls > 0);',
];

/** Expressions for what is stored in its place once. A bound function or a proxy among the writers widens the field to any value. */
const others = [
  '() => "another arrow"',
  'function () {\n      return "another function";\n    }',
  'function usual() {\n      return "a namesake";\n    }',
  'class {\n      static label = "a class";\n    }',
  "[usual]",
  "[usual, usual]",
  '[() => "listed other"]',
  "[1, 2]",
  "again()",
  "usual.bind(null)",
  "new Proxy(usual, {})",
  'new Proxy(usual, { apply: () => "trapped" })',
  'Object.assign(() => "with a property", { extra: 1 })',
  '{ method() {\n      return "a method";\n    } }.method',
  'async () => "async"',
  'function* () {\n      yield "generator";\n    }',
  "[]",
  "undefined",
  "null",
  "5",
  '"text"',
  "{ call: usual }",
  "Math.max",
];

/** With the first so many of them among its writers, a field is still typed by the functions it holds. */
const closures = 9;

/** Statements that store VALUE under a key of `events`. */
const stores = [
  "events[name] = VALUE;",
  "events[name] = VALUE;",
  "events[name] = VALUE;",
  "Reflect.set(events, name, VALUE);",
  "Object.assign(events, { [name]: VALUE });",
  "Object.defineProperty(events, name, { value: VALUE, writable: true, enumerable: true, configurable: true });",
  "events.close = VALUE;",
  "hide(events)[name] = VALUE;",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  // The fields keep their exact types, or the compiler has nothing to test. A value of another kind is passed off as a listener.
  const any = (text: string) => (typed ? `((${text}) as any)` : `(${text})`);
  const passedOff = (text: string) => (typed ? `((${text}) as unknown as Listener)` : `(${text})`);
  let isHidden = false;
  const scenes: string[] = [];
  const types = ["type Listener = () => unknown;", "type Held = Listener | Listener[] | undefined;"];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const isPlain = random.chance(0.5);
    const listed = random.sample(["close", "error", "data", "end", "readable"], random.between(2, 5));
    const asked = random.shuffled([
      ...listed,
      ...random.sample(isPlain ? ["finish", "drain"] : ["finish", "drain", "0", "__proto__"], random.between(0, 2)),
    ]);
    const usual = random
      .pick(usuals)
      .replace("CAST(text => () => text)", typed ? "(text: string) => () => text" : "text => () => text");
    const isChanged = !isPlain && random.chance(0.3);
    const picked = random.sample(isPlain ? others.slice(0, closures) : others, random.between(0, 3));
    const store = isPlain ? stores[0] : random.pick(stores);
    isHidden ||= store.includes("hide(");
    if (typed)
      types.push(
        `interface Events${scene} {\n  [name: string]: Held;\n${listed.map(name => `  ${name}: Held;\n`).join("")}}`,
      );
    scenes.push(`{
  ${usual}
  const again = () => ${usual.includes("made(") ? 'made("other captures")' : "usual"};
  const names${as("string[]")} = ${JSON.stringify(asked)}.map(key);
  const room = ()${as(`Events${scene}`)} => ({ ${listed.map(name => `${name}: undefined`).join(", ")} });
  function add(events${as(`Events${scene}`)}, name${as("string")}, value${as("Listener")}) {
    const existing = events[name];
    if (existing === undefined) ${store.replace("VALUE", "value")}
    else events[name] = typeof existing === "function" ? [existing, value] : Array.isArray(existing) ? [...existing, value] : value;
  }
  let events = room();
  for (let turn = 0; turn < ${random.pick([1, 3, 300, 3000])}; turn++) {
    events = room();
    for (const name of names) add(events, name, usual);
    add(events, names[turn % names.length], usual);
  }
  console.log("scene ${scene} usual", described(events));
  ${isChanged ? `${any("usual")}.extra = "a property of its own";\n  told(() => add(events, names[0], usual));\n  console.log("scene ${scene} changed", described(events));` : ""}
${picked
  .map(
    (other, at) => `  events = room();
  told(() => add(events, names[${at} % names.length], ${passedOff(other)}));
  told(() => add(events, names[${at + 1} % names.length], usual));
  ${random.chance(0.5) ? `told(() => add(events, names[${at} % names.length], usual));` : ""}
  console.log("scene ${scene} other ${at}", described(events));`,
  )
  .join("\n")}
}`);
  }
  return `${typed ? types.join("\n") + "\n" : ""}const key = (name${as("string")})${as("string")} => process.argv[9] ?? name;
${isHidden ? `const hide = new Function("value", process.argv[9] ?? "return value")${typed ? " as <V>(value: V) => V" : ""};\n` : ""}function told(ask${as("() => unknown")})${as("unknown")} {
  try {
    return ask();
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name;
  }
}
function one(value${as("any")})${as("string")} {
  if (typeof value === "function") {
    const answer = told(() => value());
    return "function " + (typeof answer === "string" ? answer : typeof answer) + (value.extra ? " extra" : "");
  }
  // A loop, not value.map(one): a method called on a value of unknown kind makes the compiler give up what it knows of the fields.
  if (Array.isArray(value)) {
    let text = "[";
    for (let at = 0; at < value.length; at++) text += (at ? ", " : "") + one(value[at]);
    return text + "]";
  }
  return value === null ? "null" : typeof value === "object" ? "{" + Object.keys(value).join() + "}" : typeof value + " " + String(value);
}
function described(events${as("any")})${as("string")} {
  return Object.keys(events).map(name => name + ": " + one(events[name])).join("; ");
}
${scenes.join("\n")}
`;
}
