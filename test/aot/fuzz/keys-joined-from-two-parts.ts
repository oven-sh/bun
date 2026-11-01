// `table["on" + type]`: a property key joined from two parts. A compiler may remember the key for a pair of parts, so each
// scene joins the same and other pairs again and again in one small function. The parts are written strings, strings made
// at run time that die and whose memory is used again, slices, joined strings, numbers in both encodings, other primitives,
// and objects whose text changes from one turn to the next. Different pairs give the same key, and nearly equal pairs give
// different keys. About half of the scenes are the plain case: a written prefix and a suffix out of a short list.
import type { Random } from "./random";

interface Parts {
  type: string;
  /** Expressions, and the text each turns into when joined. */
  values: [string, string][];
}

const suffixes: Parts[] = [
  {
    type: "string",
    values: [
      ['"ket"', "ket"],
      ['"ce"', "ce"],
      ['"k0"', "k0"],
      ['""', ""],
      ['"to__"', "to__"],
      ['"gth"', "gth"],
      ['"0"', "0"],
      ['"12"', "12"],
      ['"\\u00e9"', "é"],
      ['"\\u4e16"', "世"],
    ],
  },
  {
    type: "number",
    values: [
      ["0", "0"],
      ["1", "1"],
      ["2", "2"],
      ["12", "12"],
      ["-1", "-1"],
      ["2147483647", "2147483647"],
    ],
  },
  {
    type: "number",
    values: [
      ["1.5", "1.5"],
      ["-0", "0"],
      ["0", "0"],
      ["NaN", "NaN"],
      ["1e21", "1e+21"],
      ["4294967296", "4294967296"],
      ["half * 2", "1"],
      ["1", "1"],
      ["-half * 0", "0"],
      ["0 / (half - half)", "NaN"],
    ],
  },
  {
    type: "string | number | boolean | null | undefined | bigint",
    values: [
      ["true", "true"],
      ["false", "false"],
      ["null", "null"],
      ["undefined", "undefined"],
      ["10n", "10"],
      ["10", "10"],
      ['"10"', "10"],
      ['"true"', "true"],
    ],
  },
];

const prefixes = ["bra", "bra", "k", "on", "", "1", "__pro", "len", "é", "世", "a longer prefix that is no name "];

/** What a scene does with the key `KEY` on `held`. Each is an expression. */
const uses = [
  "held[KEY]",
  "held[KEY]",
  "held[KEY]",
  "KEY in held",
  "Object.hasOwn(held, KEY)",
  "(held[KEY] = i)",
  "(held[KEY] = (held[KEY] ?? 0) + 1)",
  "delete held[KEY]",
  "typeof held[KEY]",
  "held[KEY] === held[KEY]",
  "Reflect.get(held, KEY)",
  "Object.getOwnPropertyDescriptor(held, KEY)?.value",
];

const quoted = (text: string) => JSON.stringify(text);

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const isPlain = random.chance(0.45);
    const prefix = isPlain ? random.pick(["bra", "k", "on"]) : random.pick(prefixes);
    const parts = isPlain ? suffixes[random.chance(0.7) ? 0 : 1]! : random.pick(suffixes);
    const values = random.shuffled(parts.values).slice(0, random.between(2, 6));
    const names = [...new Set(values.filter(() => random.chance(0.6)).map(([, text]) => prefix + text))];
    if (names.length === 0) names.push(prefix + values[0]![1]);
    const members = names.map((name, at) => `${quoted(name)}: ${at + 1}`).join(", ");
    const receiver = random.pick(
      isPlain
        ? [`{ ${members} }`]
        : [
            `{ ${members} }`,
            `{ ${members} }`,
            `Object.assign(Object.create(null), { ${members} })`,
            `Object.assign(new Held${scene}(), { ${members} })`,
            `Object.assign([10, 20, 30], { ${members} })`,
            `new Proxy({ ${members} }, { get: (target, key) => typeof key + ":" + String(key), has: (target, key) => String(key).length % 2 === 0 })`,
            `Object.create({ ${members} })`,
          ],
    );
    const way = isPlain
      ? random.pick(["plus", "template"])
      : random.pick(["plus", "plus", "template", "suffix first", "both vary", "concat"]);
    const rounds = random.pick(isPlain ? [40, 300] : [40, 300, 2000]);
    const use = (key: string) => random.pick(isPlain ? uses.slice(0, 5) : uses).replaceAll("KEY", key);
    const collect = !isPlain && random.chance(0.35) ? `if (i % ${random.pick([16, 64, 250])} === 3) Bun.gc(true);` : "";
    const key =
      way === "plus"
        ? `${quoted(prefix)} + part`
        : way === "template"
          ? "`" + prefix + "${part}`"
          : way === "suffix first"
            ? `part + ${quoted(prefix)}`
            : way === "concat"
              ? `${quoted(prefix)}.concat(String(part))`
              : "first + part";
    const isWrapped = way !== "template" && way !== "concat";
    const source = isPlain
      ? "listed"
      : random.pick([
          "listed",
          "listed",
          "sliced",
          "made from codes",
          "joined",
          "printed number",
          "changing object",
          "many numbers",
          "symbol",
        ]);
    const text = values.map(([, each]) => each).join("") + "ketce";
    const width = random.between(1, 3);
    const part =
      source === "sliced"
        ? `text${scene}.slice(i % ${text.length}, (i % ${text.length}) + ${width})`
        : source === "made from codes"
          ? `String.fromCharCode(${random.pick([97, 48, 0xe0, 0x4e00])} + (i % ${random.pick([3, 26, 300])}))`
          : source === "joined"
            ? `text${scene}.slice(0, i % 3) + listed${scene}[i % listed${scene}.length]`
            : source === "printed number"
              ? `(i % ${random.pick([7, 40, 5000])}).toString(${random.pick([10, 36, 2])})`
              : source === "changing object"
                ? `changing${scene}`
                : source === "many numbers"
                  ? `i % ${random.pick([300, 5000, 20000])}`
                  : source === "symbol"
                    ? `i % 5 === 4 ? Symbol.iterator : listed${scene}[i % listed${scene}.length]`
                    : `listed${scene}[i % listed${scene}.length]`;
    const isLoose = source !== "listed" || way === "both vary";
    const partType = isLoose ? "any" : parts.type;
    const manyRounds = source === "many numbers" ? random.pick([2000, 40000]) : rounds;
    const splits = [0, 1, 2, prefix.length].filter(at => at <= prefix.length);
    scenes.push(`class Held${scene} {
  ${quoted(prefix + "own")} = 70;
  get ${quoted(prefix + values[0]![1] + "got")}() {
    return 71;
  }
}
const held${scene}${as("any")} = ${receiver};
const listed${scene}${as(`(${parts.type})[]`)} = [${values.map(([expression]) => expression).join(", ")}];
const text${scene} = word(${quoted(text)});
const firsts${scene} = [${splits.map(at => quoted(prefix.slice(0, at))).join(", ")}];
const changing${scene} = {
  turn: 0,
  toString() {
    return ${quoted(values[0]![1])}.slice(0, this.turn++ % 3);
  },
};
function use${scene}(held${as("any")}, ${way === "both vary" ? `first${as("string")}, ` : ""}part${as(partType)}, i${as("number")})${as("unknown")} {
  return ${use(isWrapped && random.chance(0.3) ? `(${key})` : key)};
}
function scene${scene}()${as("string")} {
  for (let i = 0; i < ${manyRounds}; i++) {
    try {
      noted(String(use${scene}(held${scene}, ${way === "both vary" ? `firsts${scene}[i % firsts${scene}.length]${typed ? "!" : ""}, ` : ""}${part}, i)));
    } catch (error) {
      noted(${typed ? "(error as Error)" : "error"}.name);
    }
    ${collect}
  }
  return counted() + " " + Object.keys(held${scene}).length;
}
console.log("scene ${scene}", scene${scene}());
console.log("scene ${scene} again", scene${scene}());`);
  }
  return `const word${as("(text: string) => string")} = Function("text", "return text")${typed ? " as (text: string) => string" : ""};
const half${as("number")} = Number(word("0.5"));
const rounds = new Map${typed ? "<string, number>" : ""}();
function noted(answer${as("string")}) {
  rounds.set(answer, (rounds.get(answer) ?? 0) + 1);
}
function counted()${as("string")} {
  let sum = 0;
  let said = "";
  for (const [answer, times] of rounds) {
    sum = (sum * 31 + answer.length * times) % 1000003;
    if (said.length < 120) said += answer + "x" + times + ",";
  }
  const size = rounds.size;
  rounds.clear();
  return size + ":" + sum + ":" + said;
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
