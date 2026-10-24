// Code that reads a field of small integers goes on to use it where an integer is at home: as an index of an array, a string and a typed array, as a length, a count, a shift, a case of a switch, a key of a map.
// A store that the build cannot attribute has put a fraction, -0, NaN, an infinity or a large integer there. Each use must do what JavaScript says for that number.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Cursor { at = 0; }
const list = ["a", "b", "c", "d"];
const text = "wxyz";
const bytes = new Uint8Array([10, 20, 30, 40]);
const table = new Map<number, string>([[0, "zero"], [1, "one"], [NaN, "nan"]]);
function attempt(run: () => unknown) {
  try {
    const value = run();
    return typeof value === "number" ? exact(value) : String(value);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function uses(cursor: Cursor): string[] {
  return [
    attempt(() => list[cursor.at]),
    attempt(() => text[cursor.at]),
    attempt(() => text.charAt(cursor.at)),
    attempt(() => text.charCodeAt(cursor.at)),
    attempt(() => bytes[cursor.at]),
    attempt(() => list.at(cursor.at)),
    attempt(() => list.slice(cursor.at).join("")),
    attempt(() => cursor.at in list),
    attempt(() => new Array(cursor.at).length),
    attempt(() => "ab".repeat(cursor.at).length),
    attempt(() => cursor.at.toFixed(1)),
    attempt(() => cursor.at.toString(2).length),
    attempt(() => 1 << cursor.at),
    attempt(() => cursor.at >> 1),
    attempt(() => cursor.at >>> 0),
    attempt(() => ~cursor.at),
    attempt(() => cursor.at % 2),
    attempt(() => cursor.at / 2),
    attempt(() => cursor.at * cursor.at),
    attempt(() => -cursor.at),
    attempt(() => (cursor.at ? "truthy" : "falsy")),
    attempt(() => cursor.at === 0),
    attempt(() => cursor.at < 1),
    attempt(() => cursor.at >= 0),
    attempt(() => cursor.at == cursor.at),
    attempt(() => { switch (cursor.at) { case 0: return "case 0"; case 1: return "case 1"; case 2147483647: return "case max"; default: return "default"; } }),
    attempt(() => table.get(cursor.at)),
    attempt(() => [cursor.at].includes(cursor.at)),
    attempt(() => [cursor.at].indexOf(cursor.at)),
    attempt(() => Object.is(cursor.at, 0)),
    attempt(() => `${cursor.at}`),
    attempt(() => JSON.stringify([cursor.at])),
    attempt(() => Math.sign(cursor.at)),
    attempt(() => Number.isSafeInteger(cursor.at)),
    attempt(() => BigInt(cursor.at)),
    attempt(() => ({ [cursor.at]: 1 })),
    attempt(() => Object.keys({ [cursor.at]: 1 })[0]),
  ];
}
function walk(cursor: Cursor) {
  let seen = "";
  for (let i = cursor.at; i < list.length && seen.length < 8; i++) seen += list[i] ?? "-";
  return seen;
}
let length = 0;
for (let i = 0; i < 1500; i++) {
  const cursor = new Cursor();
  handOver(cursor);
  cursor.at = i & 3;
  length += uses(cursor).join().length + walk(cursor).length;
}
console.log("warm", length);
const key: string = JSON.parse('"at"');
for (const value of [...odd, Number("1"), Number("3"), Number("-1"), Number("1.0000000000000002")]) {
  const cursor = new Cursor();
  handOver(cursor);
  (cursor as any)[key] = value;
  console.log(`${exact(value)}: ${uses(cursor).join(" ")} | ${walk(cursor)}`);
}
