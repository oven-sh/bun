// Made by test/aot/tools/generate-lists-of-numbers.py.
function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : typeof x === "object" && x !== null ? "object" : String(x);
}
function make(minus: number): number[] {
  const list: number[] = [];
  for (let i = 0; i < 6; i++) list.push(i);
  (list as any)[3] = "7";
  return list;
}
function read(list: number[]): string {
  let zeros = 0, minusZeros = 0, notItself = 0, nothing = 0;
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (Object.is(x, 0)) zeros++;
    if (Object.is(x, -0)) minusZeros++;
    if (x !== x) notItself++;
    if (x === undefined) nothing++;
  }
  return [zeros, minusZeros, notItself, nothing].join();
}
function safely(): string {
  try {
    return read(make(-1));
  } catch (error: any) {
    return "thrown: " + error.name;
  }
}
for (let turn = 0; turn < 3; turn++) console.log(safely());
