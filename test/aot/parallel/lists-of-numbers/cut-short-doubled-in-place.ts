// Made by test/aot/tools/generate-lists-of-numbers.py.
function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : typeof x === "object" && x !== null ? "object" : String(x);
}
function make(minus: number): number[] {
  const list: number[] = [];
  for (let i = 0; i < 6; i++) list.push(i);
  list.length = 2;
  return list;
}
function read(list: number[]): string {
  try {
    for (let i = 0; i < list.length; i++) list[i] = list[i] * 2;
  } catch (error: any) {
    return error.name + " " + list.map(show).join();
  }
  return list.map(show).join();
}
function safely(): string {
  try {
    return read(make(-1));
  } catch (error: any) {
    return "thrown: " + error.name;
  }
}
for (let turn = 0; turn < 3; turn++) console.log(safely());
