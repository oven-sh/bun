// When validation fails, error.issues lists at most the first 100 mismatches, for JSON.parse<T> and validate<T> alike, even when a million values do not match their type.
import { validate } from "bun:bundle";
type Row = { id: number; name: string; tags: string[] };
type Shape = { kind: "a"; a: number } | { kind: "b"; b: string };
type Either = { a: number } | { b: string };

function outcome(run: () => unknown): string {
  const start = Date.now();
  let result = "";
  try {
    run();
    result = "accepted";
  } catch (error: any) {
    if (error.name !== "TypeError" || !error.issues) result = error.name + ": " + error.message;
    else result = error.issues.length + " issues, from " + JSON.stringify(error.issues[0].path) + " to " + JSON.stringify(error.issues.at(-1).path);
  }
  return result + (Date.now() - start > 30000 ? " TOO SLOW" : "");
}
const list = (count: number, item: (at: number) => string) => "[" + Array.from({ length: count }, (_, at) => item(at)).join(",") + "]";

const cases: [string, (text: string) => unknown, (value: unknown) => unknown, (count: number) => string][] = [
  ["numbers", text => JSON.parse<number[]>(text), value => validate<number[]>(value), count => list(count, () => "null")],
  ["every second number", text => JSON.parse<number[]>(text), value => validate<number[]>(value), count => list(2 * count, at => (at % 2 ? '"s"' : "1"))],
  ["rows with three mismatches each", text => JSON.parse<Row[]>(text), value => validate<Row[]>(value), count => list(Math.ceil(count / 3), () => '{"id":"no","name":1,"tags":[1]}')],
  ["rows with a missing field", text => JSON.parse<Row[]>(text), value => validate<Row[]>(value), count => list(count, at => '{"id":' + at + ',"tags":[]}')],
  ["a dictionary", text => JSON.parse<Record<string, number>>(text), value => validate<Record<string, number>>(value), count => "{" + Array.from({ length: count }, (_, at) => '"k' + at + '":"s"').join(",") + "}"],
  ["arrays of arrays", text => JSON.parse<number[][]>(text), value => validate<number[][]>(value), count => list(Math.ceil(count / 10), () => list(10, () => "true"))],
  ["a tagged union", text => JSON.parse<Shape[]>(text), value => validate<Shape[]>(value), count => list(count, at => (at % 2 ? '{"kind":"a","a":"no"}' : '{"kind":"c"}'))],
  ["a union without a tag", text => JSON.parse<Either[]>(text), value => validate<Either[]>(value), count => list(count, () => '{"a":"no","b":1}')],
];
for (const [label, parse, validate, text] of cases) {
  for (const count of [1, 99, 100, 101, 1000, 1_000_000]) {
    const given = text(count);
    const parsed = outcome(() => parse(given));
    const validated = outcome(() => validate(JSON.parse(given)));
    console.log(label + ", count " + count + ": " + parsed + (validated === parsed ? "" : "; validate: " + validated));
  }
}
