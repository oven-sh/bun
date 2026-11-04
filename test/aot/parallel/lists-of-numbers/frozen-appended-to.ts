// Made by test/aot/tools/generate-lists-of-numbers.py.
function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : typeof x === "object" && x !== null ? "object" : String(x);
}
function make(minus: number): number[] {
  const list: number[] = Object.freeze([3, 1, 4, 1, 5, 9]) as number[];
  return list;
}
function read(list: number[]): string {
  try {
    list.push(1);
    list.push(0.25);
  } catch (error: any) {
    return error.name + " " + list.length;
  }
  return list.length + " " + show(list[list.length - 2]) + " " + show(list[list.length - 1]);
}
function safely(): string {
  try {
    return read(make(-1));
  } catch (error: any) {
    return "thrown: " + error.name;
  }
}
for (let turn = 0; turn < 3; turn++) console.log(safely());
