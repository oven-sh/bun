// What is handed to JSON.parse<T> is no string: JSON.parse converts it to one first.
type Point = { x: number; y: number };
const plainParse: (text: any) => any = JSON.parse;
function say(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error: any) {
    return error.name === "TypeError" && error.issues ? "refused" : error.name + ": " + error.message;
  }
}
let calls = 0;
const given: [string, () => any][] = [
  ["bytes of 1", () => new Uint8Array([49])],
  ["bytes of a record", () => new Uint8Array([...'{"x":1,"y":2}'].map(c => c.charCodeAt(0)))],
  ["bytes of [1]", () => new Uint8Array([91, 49, 93])],
  ["no bytes", () => new Uint8Array(0)],
  ["Uint8ClampedArray", () => new Uint8ClampedArray([49])],
  ["Int8Array", () => new Int8Array([49])],
  ["ArrayBuffer", () => new Uint8Array([49]).buffer],
  ["a number", () => 7],
  ["null", () => null],
  ["undefined", () => undefined],
  ["true", () => true],
  ["an array", () => [1]],
  ["an array of two", () => [1, 2]],
  ["an object", () => ({})],
  ["an object with toString", () => ({ toString: () => (calls++, '{"x":1,"y":2}') })],
  ["an object with valueOf", () => ({ valueOf: () => "1", toString: () => "2" })],
  ["a String object", () => new String('{"x":1,"y":2}')],
  ["a symbol", () => Symbol("s")],
  ["a bigint", () => 12n],
  ["a throwing toString", () => ({ toString() { throw new RangeError("mine"); } })],
];
for (const [label, make] of given) {
  const answers = [say(() => JSON.parse<number>(make())), say(() => JSON.parse<Point>(make())), say(() => JSON.parse<number[]>(make())), say(() => JSON.parse<{ v: unknown }>(make()))];
  const plain = say(() => plainParse(make()));
  console.log(label + ": plain " + plain + " | " + answers.map(answer => (answer === plain ? "same" : answer === "refused" && !plain.includes("Error") ? "refused" : "DIFFERENT: " + answer)).join(" | "));
}
console.log("toString was called " + calls + " times");
