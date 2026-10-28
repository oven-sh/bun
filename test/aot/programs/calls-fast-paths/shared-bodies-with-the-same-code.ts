// Equal calls of a built-in share a body for each combination of operand types. Where the types make no difference to the machine code the image keeps one body for all of them. What a caller sees stays its own: the result, an exception caught by its own handler, its own line in a stack trace.
// CALLS+ keysOfPoint f:;
// CALLS+ keysOfName f:;
// CALLS+ isListOfNumbers f:;
// CALLS+ isListOfTexts f:;
interface Point {
  x: number;
  y: number;
}
interface Name {
  first: string;
  last: string;
}

export function keysOfPoint(value: Point): string {
  return Object.keys(value).join();
}
export function keysOfPointAgain(value: Point): string {
  return Object.keys(value).join("+");
}
export function keysOfName(value: Name): string {
  return Object.keys(value).join();
}
export function keysOfNameAgain(value: Name): string {
  return Object.keys(value).join("+");
}

export function isListOfNumbers(value: number[] | number): boolean {
  return Array.isArray(value);
}
export function isListOfNumbersAgain(value: number[] | number): boolean {
  return !Array.isArray(value);
}
export function isListOfTexts(value: string[] | string): boolean {
  return Array.isArray(value);
}
export function isListOfTextsAgain(value: string[] | string): boolean {
  return !Array.isArray(value);
}

function callers(error: Error): string {
  return (error.stack ?? "")
    .split("\n")
    .map(line => /\bown\w*/.exec(line)?.[0])
    .filter(name => name)
    .join(" < ");
}

export function ownKeysOfRecord(value: Record<string, number>): string {
  try {
    return Object.keys(value).join();
  } catch (error) {
    return "record: " + (error as Error).message + ": " + callers(error as Error);
  }
}
export function ownKeysOfRecordAgain(value: Record<string, number>): string {
  return Object.keys(value).join("+");
}
export function ownKeysOfTable(value: Record<string, string>): string {
  try {
    return Object.keys(value).join();
  } catch (error) {
    return "table: " + (error as Error).message + ": " + callers(error as Error);
  }
}
export function ownKeysOfTableAgain(value: Record<string, string>): string {
  return Object.keys(value).join("+");
}
export function ownOuter(value: Record<string, string>): string {
  try {
    return ownKeysOfTableAgain(value);
  } catch (error) {
    return "outer: " + (error as Error).message + ": " + callers(error as Error);
  }
}

const f: any = {
  keysOfPoint, keysOfPointAgain, keysOfName, keysOfNameAgain, isListOfNumbers, isListOfNumbersAgain, isListOfTexts, isListOfTextsAgain,
  ownKeysOfRecord, ownKeysOfRecordAgain, ownKeysOfTable, ownKeysOfTableAgain, ownOuter,
};
console.log(f.keysOfPoint({ x: 1, y: 2 }), f.keysOfPointAgain({ x: 1, y: 2 }), f.keysOfName({ first: "a", last: "b" }), f.keysOfNameAgain({ first: "a", last: "b" }));
console.log(f.isListOfNumbers([1]), f.isListOfNumbers(1), f.isListOfNumbersAgain([1]), f.isListOfTexts(["a"]), f.isListOfTexts("a"), f.isListOfTextsAgain("a"));
const refusing: any = new Proxy({}, { ownKeys() { throw new Error("no keys"); } });
console.log(f.ownKeysOfRecord({ a: 1 }), "|", f.ownKeysOfRecord(refusing));
console.log(f.ownKeysOfTable({ b: "1" }), "|", f.ownKeysOfTable(refusing));
console.log(f.ownOuter({ c: "1" }), "|", f.ownOuter(refusing));
