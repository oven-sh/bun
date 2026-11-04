// Made by test/aot/tools/generate-lists-of-numbers.py.
function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : typeof x === "object" && x !== null ? "object" : String(x);
}
function make(minus: number): number[] {
  const list: number[] = [3, 1, 4, 1, 5, 9];
  return list;
}
function read(list: number[]): string {
  let s = 0;
  for (let i = 0; i < list.length; i++) s ^= list[i];
  return show(s);
}
function safely(): string {
  try {
    return read(make(-1));
  } catch (error: any) {
    return "thrown: " + error.name;
  }
}
for (let turn = 0; turn < 3; turn++) console.log(safely());
