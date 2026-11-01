// Only who writes `int32` asks the build for the proof. A union that has `number` beside it holds every number, so there is nothing to prove: a variable that a minifier uses for a status and then for a time takes both.
import type { int32 } from "bun";

type Status = int32;
type Milliseconds = number;
const given: number[] = JSON.parse("[1.5, 3]");
function either(first: boolean): number {
  var status: Status | Milliseconds | null = first ? 1 : null;
  status = given[0] + 0 - given[1];
  return status;
}
function counter(): number {
  var tag: Status | number = 2;
  var sum = 0;
  while (tag < 5) sum += given[1] * tag++;
  return sum;
}
function alone(value: Status | null): int32 {
  return value === null ? -1 : value;
}

console.log(either(true), counter(), alone(7), alone(null));
