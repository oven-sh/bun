// Where a type names a number, every spelling of that number is taken, and the value is the one JSON.parse gives: -0 stays -0 under the type 0.
import { validate } from "bun:bundle";
const plainParse: (text: string) => any = JSON.parse;

function show(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (typeof value === "string") return JSON.stringify(value) + value.length;
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
  return "{" + Object.getOwnPropertyNames(value).map(key => JSON.stringify(key) + ":" + show(value[key])).join(",") + "}" + (Object.getPrototypeOf(value) === Object.prototype ? "" : "!");
}

function outcome(parse: (text: string) => unknown, text: string): string {
  try {
    return show(parse(text));
  } catch (error: any) {
    return error.name === "TypeError" && error.issues?.length > 0 ? "refused" : error.name + ": " + error.message;
  }
}

let shown = 0;
function differs(parse: (text: string) => unknown, text: string): number {
  const typed = outcome(parse, text);
  const plain = outcome(plainParse, text);
  if (typed === plain || (typed === "refused" && !plain.startsWith("SyntaxError"))) return 0;
  if (shown++ < 12) console.log("DIFFERENT on " + JSON.stringify(text).slice(0, 300) + "\n  typed: " + typed.slice(0, 300) + "\n  plain: " + plain.slice(0, 300));
  return 1;
}

type Constant = { n: 0 | 1 | -1 | 1.5 | 100 };
type Zero = { n: 0 };

const roads: [string, (text: string) => unknown, (number: string) => string][] = [
  ["a member", text => JSON.parse<Constant>(text), number => '{"n":' + number + "}"],
  ["a member that is zero", text => JSON.parse<Zero>(text), number => '{ "n" : ' + number + " }"],
  ["the root", text => JSON.parse<0 | 1>(text), number => number],
  ["elements", text => JSON.parse<(0 | 1.5)[]>(text), number => "[" + number + "," + number + "]"],
  ["a tuple", text => JSON.parse<[0, 0 | 100]>(text), number => "[" + number + "," + number + "]"],
  ["a dictionary", text => JSON.parse<Record<string, 0 | 1>>(text), number => '{"a":' + number + "}"],
  ["a tag", text => JSON.parse<{ k: 0; a: number } | { k: 1; b: number }>(text), number => '{"k":' + number + ',"a":1,"b":2}'],
  ["a value", text => validate<Constant>(JSON.parse(text)), number => '{"n":' + number + "}"],
];
const spellings = ["0", "-0", "0.0", "-0.0", "-0e0", "0e5", "-0e5", "-0E-5", "-0e400", "-1e-400", "1e-400", "-0e99999999999999999999", "1", "1.0", "10e-1", "0.1e1", "-1", "-1.0", "1.5", "15e-1", "1.50", "100", "1e2", "1E+2", "100.0", "2", "-1.5", "1e400"];
for (const [label, parse, wrap] of roads) {
  let different = 0;
  for (const spelling of spellings) different += differs(parse, wrap(spelling));
  console.log(label + ": " + spellings.length + " spellings: " + different + " differ");
}
