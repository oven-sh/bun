// Thrown values: a catch clause that treats what it caught as the program's own error class gets the errors that native code throws: `code` is missing, or a string, or a number of another meaning.
import { readFileSync } from "node:fs";

class Failure extends Error {
  code = 7;
}

let total = 0;

function weigh(failure: Failure): number {
  return typeof failure.code === "number" ? failure.code + 1 : typeof failure.code === "string" ? 1000 : failure.code === undefined ? 100000 : 0;
}

const nothing: any = null;
const attempts: (() => unknown)[] = [
  () => { throw new Failure("own"); },
  () => nothing.x,
  () => JSON.parse("{"),
  () => new Array(-1),
  () => "a".repeat(-1),
  () => BigInt(1.5),
  () => decodeURIComponent("%"),
  () => structuredClone(() => 0),
  () => atob("*"),
  () => new URL("not a url"),
  () => readFileSync("/no/such/file/anywhere"),
  () => Buffer.alloc(-1),
  () => (Symbol() as any) + "",
  () => new (nothing ?? 5)(),
];
const names: string[] = [];
for (const attempt of attempts) {
  try {
    attempt();
  } catch (error) {
    total += weigh(error as Failure);
    names.push((error as Failure).name);
  }
}
console.log(total, names.join());
