// Made by test/aot/tools/generate-lists-of-numbers.py.
function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : typeof x === "object" && x !== null ? "object" : String(x);
}
function make(minus: number): number[] {
  const list: number[] = new Array<number>(6);
  for (let i = 0; i < 4; i++) list[i] = i;
  return list;
}
function read(list: number[]): string {
  return [list[0], list[list.length - 1], list[list.length], list[-1], list[1.5]].map(show).join();
}
function safely(): string {
  try {
    return read(make(-1));
  } catch (error: any) {
    return "thrown: " + error.name;
  }
}
for (let turn = 0; turn < 3; turn++) console.log(safely());
