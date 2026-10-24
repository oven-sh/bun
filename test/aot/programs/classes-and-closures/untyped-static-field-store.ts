// Untyped code stores a value of another type in a typed static field. A typed read then throws a TypeError in compiled code, and plain Bun returns the value: neither crashes.
class Counter {
  static count: number = 1;
  static label: string = "first";
}

function readCount(): number {
  return Counter.count;
}
function readLabel(): string {
  return Counter.label;
}
function readCountOrError(): boolean {
  try {
    return typeof readCount() === "string";
  } catch (error) {
    return error instanceof TypeError;
  }
}

let total = 0;
for (let round = 0; round < 3; round++) {
  Counter.count = round;
  total += readCount();
}
console.log(total, readLabel());

(Counter as any).count = "x";
console.log(readCountOrError(), (Counter as any).count);

Counter.count = 5;
console.log(readCount());

Counter.label = "second";
(Counter as any).label = undefined;
console.log(readLabel());
