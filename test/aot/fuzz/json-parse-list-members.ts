// `JSON.parse(text) as Row` where Row declares a member that holds a list and the JSON has members around it that Row does
// not declare. A parser that has learned the shape of such a text may read the next one whole, lists included. Each scene
// picks the list's declared type (numbers, strings, records, lists of lists up to five deep, rows inside rows), several
// texts for it (empty, long, of mixed kinds, odd number formats, escapes, white space, values the type does not allow,
// malformed in many ways) and parses them in turns, several times each. The result, its key order, each element's kind
// and what the list does when it is stored to afterwards are printed.
import type { Random } from "./random";

const numbers = ["[]", "[1]", "[1,2,3]", "[1.5,2.5]", "[1,2.5,3]", "[-0]", "[0,-0,0]", "[1e3,1E+2,1e-2]", "[0.1,0.2]", "[123456789012345678901]", "[1e400,-1e400]", "[2147483647,2147483648,-2147483649]", "[ 1 , 2 ]", "[\\n1,\\t2\\r]", "LONG15", "LONG16", "LONG17", "LONG33", "LONG100", "LONGHALVES"]; // prettier-ignore
const strings = ['[]', '["a"]', '["a","b","a"]', '[""]', '["\\\\n","\\\\u0041","\\\\\\\\","\\\\""]', '["\\\\ud83d\\\\ude00","\\\\ud83d"]', '["\\u00e9","\\u2713"]', '["a" , "b"]', "TEXTS20"]; // prettier-ignore
const records = ["[]", '[{"x":1}]', '[{"x":1},{"x":2}]', '[{"x":1,"more":2},{"more":3,"x":4}]', "[{}]", '[{"x":1.5},{"x":"text"}]', '[{"x":1},null]', '[{"x":1,"x":2}]', '[{"__proto__":1,"x":2}]']; // prettier-ignore
const nested = ["[]", "[[]]", "[[1],[2,3]]", "[[1],[]]", "[[[1]]]", "[[[[1]]]]", "[[[[[1]]]]]", "[[[[[[1]]]]]]", "[[1.5],[2]]", "[[1],2]", "[1,[2]]", "[[],[[]]]"]; // prettier-ignore
const rows = ["[]", '[{"id":1,"list":[],"name":"in"}]', '[{"u":0,"id":1,"v":0,"list":[{"id":2,"list":[],"name":"deep"}],"name":"in"}]', '[{"id":1}]', "[null]"]; // prettier-ignore

/** Lists that no type here allows, or that are no JSON. */
const wrong = [
  '["a",1]',
  "[null]",
  "[true,false]",
  "[{}]",
  "[[1]]",
  '"no list"',
  "5",
  "null",
  "{}",
  '{"0":1,"length":1}',
];
const malformed = ["[1,]", "[,1]", "[1 2]", "[1,,2]", "[", "[1", "[1}", "]", "[01]", "[1.]", "[.5]", "[+1]", "[1e]", "[-]", "[NaN]", "[undefined]", "['a']", '["a]', "[tru]", "[nul]", "[1]]", "[[1]", '["\\\\x"]', '["\\\\u12"]', "[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,]"]; // prettier-ignore

const kinds: [type: string, values: string[]][] = [
  ["number[]", numbers],
  ["number[]", numbers],
  ["Array<number>", numbers],
  ["string[]", strings],
  ["(number | null)[]", [...numbers, "[null]", "[1,null,2.5]", "[null,null]"]],
  ["(string | number)[]", [...numbers.slice(0, 8), ...strings.slice(0, 5), '[1,"a"]', '["a",1.5]']],
  ["boolean[]", ["[]", "[true]", "[true,false,true]", "[false]"]],
  ["{ x: number }[]", records],
  ["number[][]", nested],
  ["number[][][]", nested],
  ["number[][][][]", nested],
  ["number[][][][][]", nested],
  ["ROW[]", rows],
  ["unknown[]", [...numbers.slice(0, 6), ...records.slice(0, 4), ...nested.slice(0, 6)]],
  ["readonly number[]", numbers],
  ["number[] | undefined", numbers],
  ["[number, number]", ["[1,2]", "[1.5,2]", "[1]", "[1,2,3]", "[]"]],
];

/** Texts around the list. LIST is the list's text. Members named u.. are not declared. */
const frames = [
  '{"u1":1,"id":7,"u2":"x","list":LIST,"u3":null,"name":"row"}',
  '{"u1":1,"id":7,"u2":"x","list":LIST,"u3":null,"name":"row","u4":[1]}',
  '{"id":7,"u1":1,"list":LIST,"u2":2,"name":"row"}',
  '{"id":7,"list":LIST,"u1":1,"name":"row","u2":2}',
  '{"id":7,"list":LIST,"name":"row"}',
  '{"u1":{"deep":[1]},"id":7,"u2":[[]],"list":LIST,"name":"row","u3":"end"}',
  '{"name":"row","u1":1,"list":LIST,"u2":2,"id":7}',
  '{"u1":1,"id":7,"u2":2,"list":LIST,"u3":3,"list":[9],"name":"row"}',
  '{ "u1" : 1 , "id" : 7 , "u2" : 2 , "list" : LIST , "name" : "row" }',
  '{"u1":1,"id":7,"u2":2,"name":"row","u3":3,"list":LIST}',
  '{"u1":1,"id":7,"u2":2,"list":LIST',
  '{"u1":1,"id":7,"u2":2,"list":LIST,"name":"row"}}',
];

/** What stands in place of the closing brace of a text whose shape is known by then. */
const endings = [
  ",}",
  " , }",
  ",",
  ",,",
  ",]",
  ',"u9"}',
  ',"u9":}',
  ',"u9":1',
  ',"name"}',
  "",
  "]",
  "}}",
  "} ",
  "}x",
  ',"u4":[1]',
  ',"u4":[1]}',
];

export function generate(random: Random): string {
  const long = (count: number, item: (at: number) => string) =>
    `[${Array.from({ length: count }, (_, at) => item(at)).join(",")}]`;
  const written = (value: string) =>
    value
      .replace(/^LONG(\d+)$/, (_, count) => long(Number(count), at => String(at * 3)))
      .replace(
        "LONGHALVES",
        long(40, at => (at === 20 ? "0.5" : String(at))),
      )
      .replace(
        "TEXTS20",
        long(20, at => `"t${at}"`),
      );
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const row = `Row${scene}`;
    const [type, values] = random.pick(kinds);
    const frame = random.pick(frames);
    const lists = [
      ...random.sample(values, Math.min(values.length, random.between(2, 4))),
      ...(random.chance(0.5) ? [random.pick(wrong)] : []),
      ...(random.chance(0.5) ? [random.pick(malformed)] : []),
    ];
    // Most texts of a scene have one frame, so that a shape learned from one text meets the next.
    const texts = random
      .shuffled(lists)
      .map(list => (random.chance(0.8) ? frame : random.pick(frames)).replace("LIST", () => written(list)));
    // A shape and the same shape with one member more are both learned, and then a text of either ends in another way.
    if (random.chance(0.5)) {
      const whole = frames[0].replace("LIST", () => written(random.pick(values)));
      texts.push(whole, whole.slice(0, -1) + ',"u4":[1]}');
      for (const ending of random.sample(endings, random.between(1, 4)))
        texts.push((random.chance(0.5) ? whole.slice(0, -1) : whole.slice(0, -1) + ',"u4":[1]') + ending);
    }
    scenes.push(`type ${row} = { id: number; list: ${type.replace("ROW", row)}; name: string };
{
  const texts = [
    ${texts.map(text => `part(\`${text.replaceAll("`", "\\`")}\`)`).join(",\n    ")},
  ];
  const seen = new Set<string>();
  for (let round = 0; round < ${random.pick([2, 3, 5, 40])}; round++) {
    for (let at = 0; at < texts.length; at++) {
      seen.add(
        at +
          ": " +
          told(() => {
            const parsed = JSON.parse(texts[at]) as ${row};
            return shown(parsed) + " # " + used(parsed.list);
          }),
      );
    }
  }
  console.log("scene ${scene}\\n" + [...seen].join("\\n"));
}`);
  }
  return `const part = (text: string): string => process.argv[9] ?? text;
function told(ask: () => string): string {
  try {
    return ask();
  } catch (error) {
    return "threw " + (error as Error).name;
  }
}
function kind(value: unknown, depth = 0): string {
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let at = 0; at < value.length; at++) parts.push(at in value ? (depth > 6 ? "deep" : kind(value[at], depth + 1)) : "hole");
    return "[" + (parts.length > 24 ? parts.slice(0, 20).join() + ".." + parts.length + ".." + parts.slice(-2).join() : parts.join()) + "]";
  }
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).map(name => name + ":" + kind((value as Record<string, unknown>)[name], depth + 1)).join() + "}";
  return String(value);
}
function shown(parsed: unknown): string {
  return kind(parsed) + " " + JSON.stringify(parsed)?.length;
}
// Stores to the list, so that storage of the wrong kind or length shows.
function used(list: unknown): string {
  if (!Array.isArray(list)) return "no list";
  const before = list.length;
  list.push(0.5);
  list.push("text");
  list[0] = { stored: true };
  list.length = Math.min(list.length, 4);
  list.reverse();
  return before + ">" + kind(list) + Object.getPrototypeOf(list).constructor.name;
}
${scenes.join("\n")}
`;
}
