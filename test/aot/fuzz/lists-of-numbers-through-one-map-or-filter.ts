// A list of numbers goes through one map, filter, flatMap or Array.from that stands by itself, in code that runs often, and the list that comes out is read. How the new list keeps its numbers is chosen ahead of the
// traversal from what the callback is seen to store and from what the reader asks for; the numbers that then come decide otherwise.
//
//   the list     whole numbers, fractions, both; written out, pushed, filled, parsed, spread out of bytes, made by Array.from; empty, of one, of a thousand; with holes, nothing but holes, an element far out; frozen;
//                of a class below Array; with -0, NaN, the ends of the 32 bits, 2 ** 53
//   changes      after so many turns another kind of list comes through the same code, and then the first kind again
//   the callback whole to whole, whole to fraction, past 32 bits, to -0, to NaN; one element in many gives a fraction, nothing at all, what lies behind the end of the list; it asks for the index and for the list;
//                it grows, cuts, empties, reverses the list under the traversal or stores another kind into it; it throws half way; written in place, declared elsewhere, handed in as a value
//   comes out    returned, read element by element, kept in a field, spread, one of two that meet in one variable
//   read         as whole numbers, as fractions, by index, by for-of, holes asked for, -0 and NaN told apart, searched, sorted, joined, stored into, grown
import type { Random } from "./random";

const prelude = `function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    let text = "";
    for (let i = 0; i < value.length && i < 10; i++) text += (i ? "," : "") + (i in value ? show(value[i]) : "hole");
    return "[" + text + (value.length > 10 ? ",.." + value.length : "") + "]";
  }
  return String(value);
}
function digest(list: number[]): string {
  let whole = 0;
  let sum = 0;
  let holes = 0;
  let odd = "";
  for (let i = 0; i < list.length; i++) {
    if (!(i in list)) {
      holes++;
      continue;
    }
    const each = list[i];
    if (typeof each !== "number") odd += " " + typeof each + "@" + i;
    else if (each !== each) odd += " NaN@" + i;
    else if (Object.is(each, -0)) odd += " -0@" + i;
    else {
      sum += each;
      whole = (whole + (each | 0)) | 0;
    }
  }
  return list.length + " " + sum + " " + whole + " " + holes + odd.slice(0, 60);
}
function fail(): number {
  throw new RangeError("half way");
}
class Mine extends Array<number> {
  sum(): number {
    let sum = 0;
    for (const each of this) sum += each;
    return sum;
  }
}
function holed(): number[] {
  const list = [1, 2, 3, 4, 5];
  delete list[1];
  return list;
}
function frozen(): number[] {
  const list = [3, 1, 2];
  Object.freeze(list);
  return list;
}
function farOut(): number[] {
  const list = [1, 2];
  list[3000] = 3;
  return list;
}
function pushed(count: number, step: number): number[] {
  const list: number[] = [];
  for (let i = 0; i < count; i++) list.push(i * step);
  return list;
}
function parsed(text: string): number[] {
  return JSON.parse(text);
}
let counter = 0;
const holder: { kept: number[] } = { kept: [] };`;

const births = [
  "[1, 2, 3, 4, 5, 6]",
  "[1, 2, 3, 4, 5, 6]",
  "[0.5, 1.5, 2.5, 3.5]",
  "[1, 2.5, 3]",
  "[]",
  "[7]",
  "[0.25]",
  "holed()",
  "new Array<number>(5)",
  "new Array<number>(6).fill(2)",
  "new Array<number>(4).fill(0.5)",
  "Array.from({ length: 6 }, (_, i) => i)",
  "Array.from({ length: 6 }, (_, i) => i / 2)",
  "Array.from({ length: 1000 }, (_, i) => i)",
  `parsed("[1,2,3,4]")`,
  `parsed("[1.5,2,3e10]")`,
  `parsed("[]")`,
  "[...new Uint8Array([1, 2, 3, 250])]",
  "[...new Float64Array([1, 2.5])]",
  "Array.of(4, 5, 6)",
  "pushed(9, 3)",
  "pushed(9, 0.5)",
  "pushed(70, 1)",
  "[2147483647, -2147483648, 0, 1]",
  "[1073741824, 1073741823, -1073741825]",
  "[-0, 0, 1]",
  "[NaN, 1, Infinity, -Infinity]",
  "[2 ** 53, 1, 2 ** 31, 2 ** 32]",
  "frozen()",
  "farOut()",
  "Mine.from([1, 2, 3])",
  "[1, 2, 3].concat([4.5])",
  "[5, 4, 3, 2, 1].slice(1)",
  `"1,2,3".split(",").map(Number)`,
];

const toNumbers = [
  "each + 1",
  "each * 2",
  "each / 2",
  "each * each",
  "each * 65536 * 65536",
  "each + 2147483647",
  "-each",
  "each | 0",
  "each >>> 0",
  "~each",
  "Math.floor(each / 2)",
  "Math.sqrt(each)",
  "Math.round(each)",
  "Math.max(each, 0.5)",
  "Math.abs(each)",
  "each % 2",
  "each * -1 * 0",
  "each ** 2",
  "each && 1 / each",
  "index",
  "index + each",
  "index * 0.5",
  "list.length",
  "list.length - index",
  "list[index + 1]",
  "list[list.length - 1 - index]",
  "list[index] + list[0]",
  "each === 3 ? 0.5 : each",
  "index === 2 ? NaN : each",
  "index === 2 ? -0 : each",
  "index === 1 ? list[99] : each",
  "index === 3 ? 2 ** 31 : each",
  "each > 2 ? each : each / 4",
  "(counter += each)",
  "(counter++ & 63) === 63 ? 0.5 : each",
  "(counter++ & 127) === 127 ? list[-1] : each",
  "Number(String(each))",
  "(index === 1 && list.push(9), each)",
  "(index === 1 && list.pop(), each)",
  "(index === 0 && (list[2] = 0.5), each)",
  "(index === 0 && (list.length = 1), each)",
  "(index === 0 && delete list[2], each)",
  "(index === 1 && list.reverse(), each)",
  "(index === 0 && list.unshift(0.5), each)",
  "(index === 0 && (list[40] = 1), each)",
  "index === 2 ? fail() : each",
];

const tests = ["each > 1", "each % 2 === 0", "index & 1", "each === each", "Number.isInteger(each)", "list.length > index + 1", "!Object.is(each, -0)", "each", "each < list[0]", "true", "false", "(counter++ & 3) !== 0", "(index === 0 && list.pop(), true)", "(index === 0 && (list[1] = 0.5), true)", "index === 2 ? fail() > 0 : true", "each !== undefined"];

const toLists = ["[each, each * 2]", "each", "index & 1 ? [] : [each / 2]", "[list.length]", "list.length > 3 ? [each] : each", "[each, index, list.length]", "index === 1 ? [0.5] : [each]", "[list[index + 1]]", "[]", "index === 0 ? list : each", "[[each].length, each]", "(index === 0 && list.push(7), [each])", "new Array<number>(2)", "index === 2 ? [fail()] : each"];

const reads = [
  "digest(r)",
  "digest(r)",
  "r.length",
  "r[0]",
  "r[r.length - 1]",
  "r.at(-1)",
  "r.indexOf(2)",
  "r.includes(NaN)",
  "r.lastIndexOf(0.5)",
  "r.join()",
  "JSON.stringify(r)",
  "r.reduce((sum, each) => sum + each, 0)",
  "r.reduce((sum, each) => (sum + each) | 0, 0)",
  "Math.max(...r.slice(0, 50))",
  "r.slice().sort((a, b) => a - b)[0]",
  "(r.push(0.5), digest(r))",
  "(r.push(1), digest(r))",
  "((r[0] = 0.25), digest(r))",
  "((r[r.length + 2] = 1), digest(r))",
  "r.constructor === Array",
  "Object.keys(r).length",
  "1 in r",
  "r.every(each => Number.isInteger(each))",
  "r.some(each => each !== each)",
  "new Float64Array(r).length",
  "new Int32Array(r)[0]",
  "[...r].length",
  "r.concat(r).length",
  "r.fill(1.5, 1).length",
  "typeof r[1]",
];

function traversal(random: Random, list: string, name: string): { text: string; declared: string } {
  const [method, bodies] = random.weighted([[7, ["map", toNumbers]], [3, ["filter", tests]], [3, ["flatMap", toLists]], [1, ["from", toNumbers]]] as const); // prettier-ignore
  const body = random.pick(bodies);
  const result = method === "filter" ? "unknown" : method === "flatMap" ? "number | number[]" : "number";
  const parameters = method === "from" ? "(each: number, index: number)" : /\blist\b/.test(body) ? "(each: number, index: number, list: number[])" : /\bindex\b/.test(body) ? "(each: number, index: number)" : "(each: number)";
  const usable = method === "from" ? body.replace(/\blist\b/g, list) : body;
  const drawn = random.weighted([[5, "in place"], [2, "declared"], [1, "a value"], [1, "a function expression"]] as const); // prettier-ignore
  // Array.from hands its callback no list: the callback reads the one of the function around it.
  const how = method === "from" && /\blist\b/.test(body) ? "in place" : drawn;
  const callback = how === "in place" ? `${parameters.replace(/: number(\[\])?/g, "").replace(/^\((\w+)\)$/, "$1")} => ${usable.startsWith("{") ? `(${usable})` : usable}` : how === "a function expression" ? `function ${parameters}: ${result} {\n    return ${usable};\n  }` : name;
  const declared = how === "declared" ? `function ${name}${parameters}: ${result} {\n  return ${usable};\n}\n` : how === "a value" ? `const ${name} = [${parameters}: ${result} => ${usable}][0];\n` : "";
  return { text: method === "from" ? `Array.from(${list}, ${callback})` : `${list}.${method}(${callback})`, declared };
}

function scene(random: Random, index: number): string {
  const first = traversal(random, "list", `callback${index}a`);
  const second = traversal(random, "list", `callback${index}b`);
  const read = random.sample(reads, random.between(1, 3));
  const printed = `[${read.join(", ")}].map(show).join(" | ")`;
  const shape = random.weighted([[3, "returned"], [3, "read"], [2, "meet"], [1, "kept"], [1, "spread"], [1, "read as whole numbers"]] as const); // prettier-ignore
  const body =
    shape === "returned"
      ? `function made${index}(list: number[]): number[] {\n  return ${first.text};\n}\nfunction run${index}(list: number[], turn: number): string {\n  const r = made${index}(list);\n  return ${printed};\n}`
      : shape === "read"
        ? `function run${index}(list: number[], turn: number): string {\n  const r = ${first.text};\n  let sum = 0;\n  for (let i = 0; i < r.length; i++) sum += r[i];\n  return show(sum) + " " + ${printed};\n}`
        : shape === "read as whole numbers"
          ? `function run${index}(list: number[], turn: number): string {\n  const r = ${first.text};\n  let sum = 0;\n  for (const each of r) sum = (sum + each) | 0;\n  return show(sum) + " " + ${printed};\n}`
          : shape === "meet"
            ? `function run${index}(list: number[], turn: number): string {\n  const r = (turn & ${random.pick([1, 3, 7])}) === 0 ? ${first.text} : ${second.text};\n  let sum = 0;\n  for (let i = 0; i < r.length; i++) sum += r[i] * 0.5;\n  return show(sum) + " " + ${printed};\n}`
            : shape === "kept"
              ? `function run${index}(list: number[], turn: number): string {\n  holder.kept = ${first.text};\n  const r = holder.kept;\n  return ${printed};\n}`
              : `function run${index}(list: number[], turn: number): string {\n  const r = [${random.pick(["", "0, ", "0.5, "])}...${first.text}];\n  return ${printed};\n}`;
  const [usual, other] = [random.pick(births), random.pick(births)];
  const turns = random.pick([40, 300, 3000]);
  const from = random.between(1, turns - 3);
  const span = random.pick([1, 2, turns]);
  return `${first.declared}${shape === "meet" ? second.declared : ""}${body}
{
  let last = "";
  let lines = 0;
  let all = 0;
  for (let turn = 0; turn < ${turns}; turn++) {
    let said: string;
    try {
      said = run${index}(turn >= ${from} && turn < ${from + span} ? ${other} : ${usual}, turn);
    } catch (error) {
      said = "throws " + (error instanceof Error ? error.constructor.name : typeof error);
    }
    if (said !== last && lines++ < 30) console.log(${index}, turn, said);
    for (let i = 0; i < said.length; i++) all = (Math.imul(all, 31) + said.charCodeAt(i)) | 0;
    last = said;
  }
  console.log(${index}, "at the end", last, counter, all);
}`;
}

export function generate(random: Random): string {
  return [prelude, ...Array.from({ length: random.between(1, 4) }, (_, index) => scene(random, index))].join("\n") + "\n";
}
