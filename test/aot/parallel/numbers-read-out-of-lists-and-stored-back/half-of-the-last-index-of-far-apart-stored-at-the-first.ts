// Made by test/aot/tools/generate-numbers-read-out-of-lists-and-stored-back.py.
const one: number = +process.argv[2] || 1;
let told = "";
function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : String(x);
}
function describe(list: any): string {
  let text = list.length + " [";
  for (const key of Object.keys(list)) text += " " + key + "=" + show(list[key]);
  return text + " ]" + (told && " told:" + told);
}
function make(): number[] {
  const list: number[] = [];
  for (let i = 0; i < 4; i++) list.push(i + 1);
  list[70000] = 5;
  (globalThis as any).keptOutside = list;
  return list;
}
function put(list: number[], at: number): void {
  list[0] = list[at] / 2;
}
const list = make();
console.log(describe(list));
for (let turn = 0; turn < 3; turn++) {
  try {
    put(list, 4294967294);
  } catch (error: any) {
    console.log("thrown: " + error.name);
  }
  console.log(describe(list));
}
told = "";
console.log(describe(make()));
