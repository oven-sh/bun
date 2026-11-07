// The third element of a shorter list is undefined, and the read of its field is the last thing the function does in its frame. The caller's caller catches the TypeError.
// Flags: --aot-check=MovedLoads
function show(value: unknown): string {
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}
function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}
class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}
function thirdText(strings: string[]): number {
  const [, , third] = strings;
  return third.length;
}
function thirdPoint(points: Point[]): number {
  const [, , third] = points;
  return third.x;
}
function thirdFunction(functions: (() => number)[]): number {
  const [, , third] = functions;
  return third();
}
attempt("the length of a text", () => thirdText(["a", "b"]));
attempt("a field of a point", () => thirdPoint([new Point(1)]));
attempt("a call of a function", () => thirdFunction([() => 1]));
attempt("all three are there", () => [
  thirdText(["a", "b", "cd"]),
  thirdPoint([new Point(1), new Point(2), new Point(3)]),
  thirdFunction([() => 1, () => 2, () => 3]),
]);
