// STATISTIC: TypedResultsSelected >= 2
interface Holder {
  first: unknown;
  second: any;
}

const scalars = [
  "0", "7", "10", "123456789", "1234567890", "2147483647", "2147483648", "4294967296", "9007199254740993", "12345678901234567890",
  "-0", "-1", "-2147483648", "-2147483649", "00", "01", "-01", "1.", ".5", "1.5", "1.0", "0.1e1", "1e3", "1E3", "1e+3", "1e-3", "1e", "1e400", "-1e400", "+1", "0x10", "1_000", "١",
  "true", "false", "null", "tru", "fals", "nul", "truex", "falsey", "nullx", "True", "NULL", "undefined", "NaN", "Infinity", "-Infinity",
  '""', '"a"', '"row 1"', '"' + "x".repeat(31) + '"', '"' + "x".repeat(32) + '"', '"' + "x".repeat(33) + '"', '"' + "y".repeat(300) + '"',
  '"\\n"', '"\\u0041"', '"\\ud83d\\ude00"', '"\\ud83d"', '"\\x41"', '"\\"', '"é"', '"😀"', '"a\tb"', '"a\nb"', '"unterminated', "'single'", '"a""b"',
  "[]", "[1]", "{}", '{"a":1}', "[", "{", "]", "}", ",", ":", "", " ", " 1", "1 ", "\t2\n", "1 2", "//1", "1//",
];

function describe(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + value.length + " " + JSON.stringify(value.slice(0, 40));
  return typeof value + " " + JSON.stringify(value);
}

function parseTyped(text: string): string {
  const holder = JSON.parse(text) as Holder;
  return describe(holder.first) + " | " + describe(holder.second);
}
function parseList(text: string): string {
  const holders = JSON.parse(text) as Holder[];
  return holders.map(holder => describe(holder.first) + " | " + describe(holder.second)).join(" ; ");
}
function parsePlain(text: string): string {
  const holder = (0, JSON.parse)(text);
  if (Array.isArray(holder)) return holder.map(one => describe(one.first) + " | " + describe(one.second)).join(" ; ");
  return describe(holder.first) + " | " + describe(holder.second);
}
function attempt(parse: (text: string) => string, text: string): string {
  try {
    return parse(text);
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}

let differing = 0;
for (let round = 0; round < 3; round++) {
  for (const scalar of scalars) {
    for (const other of ["1", '"s"', scalar]) {
      const object = `{"first":${scalar},"second":${other}}`;
      const swapped = `{"second":${scalar},"first":${other}}`;
      const list = `[${object},${swapped}]`;
      for (const [parse, text] of [[parseTyped, object], [parseTyped, swapped], [parseList, list]] as const) {
        const answer = attempt(parse, text);
        if (answer !== attempt(parsePlain, text)) {
          differing++;
          console.log("differs", text.slice(0, 80), answer.slice(0, 120));
        }
        if (!round && other === "1" && parse === parseTyped && text === object) console.log(answer.slice(0, 160));
      }
    }
  }
}
console.log(differing);
