// Made by test/aot/tools/generate-numbers-in-lists-of-every-storage.py.
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
  for (let i = 0; i < 4; i++) list.push(i + 0.5);
  delete (list as any)[1];
  return list;
}
function put(list: number[], from: number): void {
  for (let i = 0; i < list.length && i < 9; i++) list[i] = i;
}
const list = make();
console.log(describe(list));
for (let turn = 0; turn < 3; turn++) {
  try {
    put(list, one);
  } catch (error: any) {
    console.log("thrown: " + error.name);
  }
  console.log(describe(list));
}
told = "";
console.log(describe(make()));
