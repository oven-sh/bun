// A literal or a class has fields that no statement reads by name from an object of that kind: some are only stored, some hold
// functions that are only called, some are named nowhere else. The compiler may leave such a field out of the object. It must
// still be there for all who can find it some other way: a key made at run time, a list of the keys, a copy, JSON, `in`, a
// pattern with a rest, and a read by name from a receiver that may be any object, which the record reaches through a store
// or a function that the compiler cannot follow. Each scene has objects of its own at the top of the file.
import type { Random } from "./random";

/** Fields of the record: name and value. */
const fields: [name: string, value: string][] = [
  ["open", "null"],
  ["port", "80"],
  ["host", '"h"'],
  ["read", 'i => "record" + i'],
  ["count", "5"],
  ["ratio", "0.5"],
  ["tags", "[1, 2]"],
  ["inner", "{ deep: 1 }"],
  ["flag", "true"],
  ["nothing", "undefined"],
  ["write", 'function (i) {\n    return "wrote" + i + this.count;\n  }'],
  ["size", "2147483648"],
];

/** Statements that put `record` where `holder.part` is read. */
const arrivals = [
  'put(holder, pass("part"), record);',
  'put(holder, pass("part"), record);',
  'put(holder, "part", pass(record));',
  "holder.part = record;",
  'holder[word("part")] = record;',
  'Reflect.set(holder, "part", record);',
  "Object.assign(holder, { part: record });",
  "Object.assign(holder, pass({ part: record }));",
  "holder.part = pass(record);",
  "holder.part = [record][zero()];",
];

/** What else comes to stand in that place, before or after. */
const others = [
  "",
  "",
  'put(holder, pass("part"), pass(new Proxy({}, { get: (_, key) => (key === "read" ? i => "trap" + i : 5) })));',
  'put(holder, pass("part"), new Other());',
  'holder.part = Object.assign(new Other(), { ["read"]: i => "own" + i });',
  "holder.part = new Part();",
  'put(holder, pass("part"), null);',
  'put(holder, pass("part"), { read: 5 });',
  "holder.part = Object.create(record);",
];

/** Expressions that find NAME on `record` without reading it by name from the record. */
const finders = [
  "Object.keys(record).join()",
  "JSON.stringify(record)",
  'shown(record[word("NAME")])',
  'word("NAME") in record',
  'Object.hasOwn(record, word("NAME"))',
  "Object.entries(record).length",
  "Object.values(record).map(each => typeof each).join()",
  'shown({ ...record }[word("NAME")])',
  "Reflect.ownKeys(record).length",
  'shown(Object.getOwnPropertyDescriptor(record, "NAME")?.value)',
  "(({ count, ...rest }) => Object.keys(rest).join())(record)",
  '(() => {\n    let names = "";\n    for (const name in record) names += name + ";";\n    return names;\n  })()',
  "shown(pass(record).NAME)",
  "shown(anyone(record))",
  "shown(anyone(pass(record)))",
  'shown(Reflect.get(record, "NAME"))',
  'Object.assign({}, record).NAME === record[word("NAME")]',
  "shown(holder.part?.NAME)",
  "told(() => holder.part.read(1))",
  "told(() => holder.part.write(2))",
  "told(() => walk(holder, 3))",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const picked = random.sample(fields, random.between(3, 8));
    if (!picked.some(([name]) => name === "read")) picked.push(fields[3]);
    if (!picked.some(([name]) => name === "count")) picked.push(fields[4]);
    const name = () => random.pick(picked)[0];
    const typedValue = (value: string) =>
      typed
        ? value.replace(/^i =>/, "(i: number) =>").replace("function (i)", "function (this: any, i: number)")
        : value;
    const loose = (text: string) =>
      typed
        ? text.replaceAll("i => ", "(i: number) => ").replaceAll("(_, key)", "(_: any, key: any)").replace(/^holder\.part = (.*);$/, "holder.part = ($1) as any;") // prettier-ignore
        : text;
    // A second record has fields of the same names. It comes to the same place by a way of its own, later or never.
    const steps = random
      .shuffled([
        random.pick(arrivals),
        random.pick(others),
        random.chance(0.3) ? random.pick(others) : "",
        random.chance(0.6) ? random.pick(arrivals).replaceAll("record", "apart") : "",
      ])
      .filter(step => step);
    const asked = random.sample(finders, random.between(3, 6)).map(finder => finder.replaceAll("NAME", name));
    asked.push(
      ...random.sample(
        [
          "apart.read(1) + apart.read(2)",
          "walk(second, 2)",
          "Object.keys(apart).join()",
          "shown(anyone(apart))",
          typed ? "holder.part === (apart as any)" : "holder.part === apart",
        ],
        random.between(1, 3),
      ),
    );
    const shared = random.sample(picked, random.between(1, picked.length)).filter(([field]) => field !== "read");
    const isMade = random.chance(0.3);
    const literal = `{ ${random
      .shuffled(picked)
      .map(([field, value]) => `${field}: ${typedValue(value)}`)
      .join(", ")} }`;
    // In TypeScript the holder's type names the class, whatever comes to stand in that place.
    const text = `class Part {
  ${typed ? "[member: string]: any;" : ""}
  spare = 1;
  ${random.pick(["", "", "get read() {\n    return (i" + as("number") + ') => "part" + i;\n  }', "read(i" + as("number") + ') {\n    return "part" + i;\n  }'])}
}
${typed ? "type Holder = { id: number; part: Part; [member: string]: any };" : ""}
class Other {
  ${typed ? "[member: string]: any;" : ""}
  read(i${as("number")}) {
    return "other" + i;
  }
}
${isMade ? `const makeRecord = ()${as("any")} => (${literal});\nconst record${as("any")} = makeRecord();\nmakeRecord();` : `const record${as("any")} = ${literal};`}
const apart = { ${shared.map(([field, value]) => `${field}: ${typedValue(value)}`).join(", ")}${shared.length ? ", " : ""}read: (i${as("number")}) => "apart" + i };
const holder${as("Holder")} = { id: ${scene}, part: new Part() };
const second${as("Holder")} = { id: ${scene}, part: ${random.pick(["new Part()", "new Other()", "apart", "pass(apart)"])}${typed ? " as any" : ""} };
function walk(holder${as("Holder")}, turns${as("number")})${as("string")} {
  let text = "";
  for (let i = 0; i < turns; i++) text += (holder.part.count > 100 ? "" : holder.part.read(i)) + ",";
  return text;
}
function anyone(it${as("any")})${as("unknown")} {
  return it.${name()};
}
anyone({ ${name()}: "of another object" });
${random.pick(["", "", `record.${name()} = record.count;`, `if (zero()) console.log(record.${name()});`])}
function asked()${as("string")} {
  return [${asked.map(finder => `told(() => ${finder})`).join(", ")}].join(" | ");
}
console.log("scene ${scene} at first", asked());
${steps.map((step, at) => `try {\n  ${loose(step)}\n} catch (error) {\n  console.log("scene ${scene} step ${at} threw", ${typed ? "(error as Error)" : "error"}.name);\n}\nconsole.log("scene ${scene} after step ${at}", asked());`).join("\n")}`;
    scenes.push(text.replace(/\b(Part|Other|Holder|makeRecord|record|apart|second|holder|walk|anyone|asked)\b(?!")/g, `$1${scene}`).replaceAll(`function walk${scene}(holder${scene}`, `function walk${scene}(holder`).replace(/(function walk\d+\(holder[^]*?return text;\n\})/, body => body.replaceAll(`holder${scene}.`, "holder."))); // prettier-ignore
  }
  return `const pass${as("any")} = Function("value", "return value");
const word = (text${as("string")})${as("string")} => process.argv[9] ?? text;
const zero = ()${as("number")} => (process.argv[9] ? 1 : 0);
function put(target${as("any")}, key${as("string")}, value${as("unknown")}) {
  target[key] = value;
}
function shown(value${as("unknown")})${as("string")} {
  return typeof value === "function" ? "function" : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value);
}
function told(ask${as("() => unknown")})${as("string")} {
  try {
    return String(ask());
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name;
  }
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
