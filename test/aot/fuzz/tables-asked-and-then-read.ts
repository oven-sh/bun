// `if (m.has(k)) { n.delete(k); t += m.get(k); }`: a Map is asked for a key and then read under it, in a loop over a list of keys. One search
// can answer both, and a key that is an object can be searched for without a call, as long as nothing changes the table in between. Here
// something may: the second table is the first one under another name, a helper changes it, it grows or is emptied in mid-loop. What varies:
// how the question and the read are spelled, what stands between them, whether the two names mean one table, what the keys are (objects, with
// null, undefined, numbers and texts among them or not), which keys the table holds and whether a value is undefined, and what kind of table
// it is: a Map, a Set, or an heir of Map with a `get` of its own.
import type { Random } from "./random";

export interface Shape {
  name: string;
  text: string;
  calls: string[];
}

export function helpers(typed: boolean): string {
  const any = typed ? ": any" : "";
  return `function shown(v${any})${typed ? ": string" : ""} {
  return v === undefined ? "u" : v === null ? "n" : typeof v === "object" ? "o" + v.id : String(v);
}
function touched(table${any}, key${any}, how${typed ? ": number" : ""})${typed ? ": void" : ""} {
  if (how === 1) table.delete(key);
  else if (how === 2) table.set(key, "t");
  else if (how === 3) table.clear();
}
class Doubled${typed ? "<K, V>" : ""} extends Map${typed ? "<K, V>" : ""} {
  get(key${typed ? ": K" : ""})${any} {
    return "d" + shown(super.get(key));
  }
}
`;
}

export function shapeOf(random: Random, name: string, typed: boolean): Shape {
  const any = typed ? ": any" : "";
  const isSet = random.chance(0.15);
  const keys = `${name}K`;
  const count = random.pick([3, 5, 8, 13, 40]);
  const odd = random.weighted([
    [5, [] as string[]],
    [2, ["null"]],
    [2, ["undefined"]],
    [2, ["7", '"s"']],
    [1, ["NaN", "-0", "0"]],
    [1, ["null", "undefined", "1.5"]],
  ] as const);
  const listed = `const ${keys}${any} = [${[...Array.from({ length: count }, (_, id) => `{ id: ${id} }`), ...odd].join(", ")}];\n`;
  const between = random.weighted([
    [6, ""],
    [3, "n.delete(k);"],
    [isSet ? 0 : 3, "n.set(k, i);"],
    [isSet ? 3 : 0, "n.add({ id: 100 + i });"],
    [2, "n.clear();"],
    [isSet ? 0 : 3, "touched(n, k, w);"],
    [2, "n.delete(keys[i + 1]);"],
    [2, "if (i === w) n.delete(k);"],
    [isSet ? 0 : 2, "n.set({ id: 100 + i }, i);"],
    [isSet ? 0 : 1, "n.set(k, undefined);"],
    // What only reads a table. One search may still answer both questions across these, so a search that left something behind would show.
    [3, 't += n.has(keys[i + 1]) ? "h" : "a";'],
    [isSet ? 0 : 3, "t += shown(n.get(keys[i + 1]));"],
    [2, "t += n.size;"],
    [2, "void n.keys().next();"],
    [isSet ? 0 : 1, "t += shown(n.get(keys[i + 1])) + n.size; void n.values().next();"],
  ] as const);
  const otherwise = random.weighted([
    [4, ""],
    [3, isSet ? "m.add(k);" : "m.set(k, i);"],
    [1, isSet ? "n.add(k);" : "n.set(k, -i);"],
  ] as const);
  const read = isSet ? '"+" + m.has(k)' : "shown(m.get(k))";
  const form = random.weighted([
    [4, `if (m.has(k)) { ${between} t += ${read}; } else { t += "-"; ${otherwise} }`],
    [between ? 0 : 3, `t += m.has(k) ? ${read} : "-";`],
    [3, `if (!m.has(k)) { t += "-"; ${otherwise} continue; } ${between} t += ${read};`],
    [between || isSet ? 0 : 2, "t += shown(m.has(k) && m.get(k));"],
    [isSet ? 0 : 1, `const was = m.has(k); ${between} t += was ? ${read} : "-";`],
    [isSet ? 0 : 1, `if (m.has(k)) { ${between} t += ${read} + shown(m.get(keys[i + 1])); }`],
  ] as const);
  const table = typed ? (isSet ? ": Set<any>" : ": Map<any, any>") : "";
  const text = `${listed}function ${name}(m${table}, n${table}, keys${typed ? ": any[]" : ""}, w${typed ? ": number" : ""}) {
  let t = "";
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    ${form}
  }
  return t + "|" + m.size + "|" + n.size;
}
`;
  const held = () => {
    const step = random.pick([1, 2, 3]);
    const value = random.pick(["i", "i", '"v" + i', "i % 3 ? i : undefined", "k"]);
    return isSet
      ? `new Set(${keys}.filter((k${any}, i${typed ? ": number" : ""}) => i % ${step} === 0))`
      : `new ${random.weighted([
          [6, "Map"],
          [1, "Doubled"],
        ] as const)}(${keys}.filter((k${any}, i${typed ? ": number" : ""}) => i % ${step} === 0).map((k${any}, i${typed ? ": number" : ""}) => [k, ${value}]))`;
  };
  const w = () => random.pick([0, 1, 2, 3]);
  const same = () => `((m${table}) => ${name}(m, m, ${keys}, ${w()}))(${held()})`;
  const apart = () => `${name}(${held()}, ${held()}, ${keys}, ${w()})`;
  return { name, text, calls: random.shuffled([same(), apart(), same(), apart()]) };
}

export function generate(random: Random, typed: boolean): string {
  const shapes = Array.from({ length: random.between(4, 8) }, (_, number) => shapeOf(random, `k${number}`, typed));
  return `${helpers(typed)}${shapes.map(shape => shape.text).join("")}${shapes
    .map(shape => `console.log("${shape.name}", [${shape.calls.join(", ")}].join(" "));`)
    .join("\n")}
${typed ? "export {};\n" : ""}`;
}
