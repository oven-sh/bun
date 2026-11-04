// Made by test/aot/tools/generate-lists-of-numbers.py.
function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : typeof x === "object" && x !== null ? "object" : String(x);
}
function make(minus: number): number[] {
  const list: number[] = [];
  for (let i = 0; i < 6; i++) list.push(i / 4);
  (list as any)[3] = undefined;
  return list;
}
function read(list: number[]): string {
  let s = 0;
  for (const x of list) s += x;
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
