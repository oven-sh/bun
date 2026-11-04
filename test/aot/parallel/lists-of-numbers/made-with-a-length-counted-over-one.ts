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
  let s = 0;
  for (let i = 0; i < list.length; i++) if (list[i] > 1) s++;
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
