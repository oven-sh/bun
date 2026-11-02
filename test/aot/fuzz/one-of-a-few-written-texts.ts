// `type Level = "low" | "mid" | "high"`: a parameter, field or variable that only ever holds one of a few texts written in the
// program. A compiler may keep the number of such a text in place of the string, and answer its length, a comparison or a
// switch from the number. Each scene has a set of two to fourteen texts (of one length, of many lengths, empty, outside
// ASCII), a place that holds one of them, and small functions that ask about it in a loop. The text arrives out of a written
// list, out of a condition, joined from halves at run time, through text made at run time, and sometimes it is none of the set.
import type { Random } from "./random";

const sets = [
  ["low", "mid", "high"],
  ["low", "mid", "high"],
  ["a", "b"],
  ["aa", "bb", "cc", "dd", "ee", "ff", "gg"],
  ["name0", "name1", "name2", "name3", "name4", "name5", "name6", "name7", "name8", "name9", "name10", "name11"],
  ["", "é", "😀", "four", "fives", "sevens!", "eight...", "nine.....", "aa", "bb"],
  ["red", "green", "yellow"],
  ["get", "put", "post", "head", "patch", "delete"],
  ["", "x"],
  ["0", "1", "10", "length", "constructor"],
  [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
  ],
  ["same", "Same", "SAME", "same "],
];

/** Expressions that ask about `text`. FIRST, LAST and NONE are written texts. */
const asks = [
  "text.length",
  "text.length",
  "text.length",
  "text === FIRST ? 10 : text === LAST ? 20 : 30",
  "text === FIRST ? 10 : text === LAST ? 20 : 30",
  "text !== LAST",
  "text.length === FIRST.length",
  "text.length + text.length * 2",
  'text + "|" + text',
  "`<${text}>`",
  "typeof text",
  'text ? "filled" : "empty"',
  "text[0]",
  "text.charCodeAt(1)",
  "text.toUpperCase()",
  "table[text]",
  "map.get(text)",
  "text < LAST",
  'text.includes("e")',
  "JSON.stringify(text)",
  "text === NONE",
  "[text].includes(FIRST)",
  "text.length > 4 ? text.slice(0, 4) : text",
  "Object.is(text, FIRST)",
  "text.at(-1)",
  "text.endsWith(LAST)",
];

const quoted = (text: string) => JSON.stringify(text);

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const set = random.pick(sets);
    const type = `Name${scene}`;
    const cast = typed ? ` as ${type}` : "";
    const fill = (code: string) =>
      code
        .replaceAll("FIRST", quoted(set[0]!))
        .replaceAll("LAST", quoted(set.at(-1)!))
        .replaceAll("NONE", typed ? `(${quoted("none of them")} as string)` : quoted("none of them"))
        .replace(/\b(table|map)\b/g, `$1${scene}`);
    const isPlain = random.chance(0.45);
    const cut = (text: string) =>
      `${quoted(text.slice(0, text.length >> 1))} + word(${quoted(text.slice(text.length >> 1))})`;
    const arrival = isPlain
      ? `names${scene}[i % ${set.length}]${typed ? "!" : ""}`
      : random.pick([
          `names${scene}[i % ${set.length}]${typed ? "!" : ""}`,
          `i % 2 ? ${quoted(set[0]!)} : ${quoted(set.at(-1)!)}`,
          `(i % 2 ? ${cut(set[0]!)} : ${cut(set.at(-1)!)})${cast}`,
          `word(names${scene}[i % ${set.length}]${typed ? "!" : ""})${cast}`,
          `(i % 7 === 6 ? word("a stranger") : names${scene}[i % ${set.length}])${cast}`,
          `JSON.parse(JSON.stringify(names${scene}))[i % ${set.length}]${cast}`,
          `(names${scene}[i % ${set.length}] + "").slice(0)${cast}`,
          `pick${scene}(i)`,
        ]);
    const place = isPlain
      ? random.pick(["parameter", "field"])
      : random.pick(["parameter", "parameter", "field", "class", "module", "optional"]);
    const picked = random.sample(asks, random.between(1, 3)).map(fill);
    const isSwitched = random.chance(0.3);
    const ways = `${picked.map(ask => `answers += String(${ask}) + ",";`).join("\n  ")}${
      isSwitched
        ? `\n  switch (text) {\n${random
            .sample(set, random.between(1, Math.min(set.length, 4)))
            .map((each, at) => `    case ${quoted(each)}:\n      answers += "case${at}";\n      break;`)
            .join("\n")}\n    default:\n      answers += "other";\n  }`
        : ""
    }`;
    const read =
      place === "field"
        ? `row${scene}.level = given;\n  const text = row${scene}.level;`
        : place === "class"
          ? `light${scene}.set(given);\n  const text = light${scene}.level;`
          : place === "module"
            ? `held${scene} = given;\n  const text = held${scene};`
            : place === "optional"
              ? `const text = given ?? ${quoted(set[0]!)};`
              : "const text = given;";
    scenes.push(`${typed ? `type ${type} = ${set.map(quoted).join(" | ")};` : ""}
const names${scene}${as(`${type}[]`)} = [${set.map(quoted).join(", ")}];
const table${scene}${as("Record<string, number>")} = { ${set
      .filter((each, at) => at % 2 === 0)
      .map((each, at) => `${quoted(each)}: ${at + 1}`)
      .join(", ")} };
const map${scene} = new Map${typed ? "<string, number>" : ""}(names${scene}.map((name, at) => [name, at]));
const row${scene} = { level: ${quoted(set[0]!)}${cast}, n: 0 };
let held${scene}${as(type)} = ${quoted(set.at(-1)!)};
class Light${scene} {
  level${as(type)} = ${quoted(set[0]!)};
  set(level${as(type)}) {
    this.level = level;
  }
}
const light${scene} = new Light${scene}();
function pick${scene}(i${as("number")})${as(type)} {
  return i % 3 === 0 ? ${quoted(set[0]!)} : i % 3 === 1 ? ${quoted(set[set.length >> 1]!)} : ${quoted(set.at(-1)!)};
}
function ask${scene}(given${place === "optional" ? (typed ? `?: ${type}` : "") : as(type)})${as("string")} {
  let answers = "";
  ${read}
  ${ways}
  return answers;
}
{
  const seen = new Map${typed ? "<string, number>" : ""}();
  for (let i = 0; i < ${random.pick([14, 60, 400])}; i++) {
    const said = ask${scene}(${place === "optional" ? `i % 5 === 4 ? undefined : ${arrival}` : arrival});
    seen.set(said, (seen.get(said) ?? 0) + 1);
  }
  console.log("scene ${scene}", [...seen].map(([said, times]) => said + "x" + times).join(" "));
}`);
  }
  return `const word${as("(text: string) => string")} = Function("text", "return text")${typed ? " as (text: string) => string" : ""};
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
