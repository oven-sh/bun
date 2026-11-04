// Made by test/aot/tools/generate-lists-of-numbers.py.
function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : typeof x === "object" && x !== null ? "object" : String(x);
}
function make(minus: number): number[] {
  const list: number[] = JSON.parse("[3, 1.5, 4, -0, 5e300, 9]");
  return list;
}
function read(list: number[]): string {
  const [a, b, , c, ...rest] = list;
  return [a, b, c, rest.length, rest[rest.length - 1]].map(show).join();
}
function safely(): string {
  try {
    return read(make(-1));
  } catch (error: any) {
    return "thrown: " + error.name;
  }
}
for (let turn = 0; turn < 3; turn++) console.log(safely());
