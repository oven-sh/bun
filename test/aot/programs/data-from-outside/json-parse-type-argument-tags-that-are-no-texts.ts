// Unions told apart by numbers, booleans, null and a mix of them: the tag in every spelling, in every place, twice, missing, of another kind: JSON.parse<T> gives what JSON.parse gives, or refuses it.
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

type ByNumber = { kind: 0; a: number } | { kind: 1; b: string } | { kind: 2; c: boolean } | { kind: 10; d: null } | { kind: -1; e: number[] } | { kind: 1.5; f: { g: number } } | { kind: 100; h?: number } | { kind: 1e21; i: number };
type ByFlag = { on: true; a: number } | { on: false; b: string };
type ByNull = { v: null; a: number } | { v: 1; b: string } | { v: "one"; c: boolean } | { v: true; d: number };
type Nested = { kind: 1; below: Nested | null } | { kind: 2; below: Nested | null; more: ByFlag };
type WithRest = { kind: 1; a: number } | { kind: 2; b: number } | { other: string };
type Tuples = [1, string] | [2, number] | [true, null];

const tags = ["0", "-0", "0.0", "0e5", "1", "1.0", "1e0", "10e-1", "0.1e1", "1.00", "01", "+1", "2", "2.0", "20e-1", "10", "1e1", "100e-1", "-1", "-1.0", "-10e-1", "1.5", "15e-1", "1.50", "100", "1e2", "1E+2", "1e21", "1000000000000000000000", "1e+21", "10e20", "3", "1.0000000000000001", "0.9999999999999999999", "1e400", "-1e400", "1e-400", "true", "false", "null", '"1"', '"one"', '"\\u006fne"', '"true"', "[1]", "{}", '{"kind":1}', "tru", "nul", "", "1 ", " 1", "1,", "1}"];
const rests = ['"a":1', '"b":"s"', '"c":true', '"d":null', '"e":[1]', '"f":{"g":1}', '"h":1', '"i":1', '"b":1', '"a":"s"', '"u":{"kind":2}', '"below":null', '"more":{"on":true,"a":1}', '"other":"o"'];
const roads: [string, string, (text: string) => unknown][] = [
  ["numbers", "kind", text => JSON.parse<ByNumber>(text)],
  ["numbers in a list", "kind", text => JSON.parse<ByNumber[]>("[" + text + "," + text + "]")],
  ["flags", "on", text => JSON.parse<ByFlag>(text)],
  ["null, a number, a text, true", "v", text => JSON.parse<ByNull>(text)],
  ["nested", "kind", text => JSON.parse<Nested>(text)],
  ["with an arm without a tag", "kind", text => JSON.parse<WithRest>(text)],
];
for (const [label, name, parse] of roads) {
  const plainRoad = label === "numbers in a list";
  let different = 0;
  let texts = 0;
  const ask = (text: string) => {
    texts++;
    if (!plainRoad) {
      different += differs(parse, text);
      return;
    }
    const typed = outcome(parse, text);
    const plain = outcome(plainParse, "[" + text + "," + text + "]");
    if (typed !== plain && !(typed === "refused" && !plain.startsWith("SyntaxError"))) different++;
  };
  for (const tag of tags) {
    for (const rest of rests) {
      const member = '"' + name + '":' + tag;
      ask("{" + member + "," + rest + "}");
      ask("{" + rest + "," + member + "}");
      ask('{"z":[{"' + name + '":9}],' + rest + "," + member + ',"y":1}');
      ask("{ " + member.replace(":", " : ") + " , " + rest + " }");
      ask("{" + member + "," + rest + ',"' + name + '":1}');
      ask('{"' + name + '":2,' + rest + "," + member + "}");
      ask('{"\\u00' + name.charCodeAt(0).toString(16) + name.slice(1) + '":' + tag + "," + rest + "}");
    }
    ask('{"' + name + '":' + tag + "}");
    ask('{"' + name + '":' + tag);
  }
  console.log(label + ": " + texts + " texts: " + different + " differ");
}
{
  let different = 0;
  let texts = 0;
  for (const tag of tags) for (const second of ['"s"', "1", "null", "true", "[]"]) for (const text of ["[" + tag + "," + second + "]", "[ " + tag + " , " + second + " ]", "[" + tag + "]", "[" + tag + "," + second + ",1]"]) {
    texts++;
    different += differs(text => JSON.parse<Tuples>(text), text);
  }
  console.log("tuples: " + texts + " texts: " + different + " differ");
}
