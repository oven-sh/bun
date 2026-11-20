// A test leaves nothing of the parameter's type, and a loop reads the parameter again. TypeScript reports nothing here.
let checks = 0;
function condition(value: string, repeat: boolean): number {
  if (typeof value === "number") {
    do {
      if (repeat) checks++;
    } while (value instanceof Date);
    return 1;
  }
  return 2;
}
function body(value: { size: number }, repeat: boolean): number {
  if (typeof value === "string") {
    while (repeat) {
      if (repeat) checks++;
      if (value instanceof Date) return 3;
      repeat = false;
    }
    return 4;
  }
  return 5;
}
function nested(value: number | undefined, rows: number[]): number {
  let sum = 0;
  if (typeof value === "string") {
    for (const row of rows) {
      do {
        if (row > 1) sum += row;
      } while (value instanceof Map);
    }
  }
  return sum + (value ?? 7);
}
console.log(condition("a", true), condition("", false), body({ size: 1 }, true), nested(1, [1, 2]), nested(undefined, [3]), checks);
