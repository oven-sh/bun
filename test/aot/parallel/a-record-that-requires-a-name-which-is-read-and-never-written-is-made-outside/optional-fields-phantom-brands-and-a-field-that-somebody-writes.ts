// Beside the record above: a field that may be left out and that nobody writes; a phantom brand, required, that nobody writes or reads; a record whose every field somebody writes; one whose field is written in another function only.
interface Loose { kind: string; extra?: number[] }
interface Branded { kind: string; _brand: any; size: number }
interface Whole { kind: string; size: number }
interface Late { kind: string; later: number[] }
const said: (string | number)[] = [];
function loose(value: Loose): number { return value.extra ? value.extra.length : -1; }
function branded(value: Branded): number { return value.size + value.kind.length; }
function whole(value: Whole): number { return value.size * 2 + value.kind.length; }
function late(value: Late): number { return value.later ? value.later.length : -2; }
function fill(value: any): void { value.later = [1, 2, 3]; }
const table: Record<string, (value: any) => number> = { loose, branded, whole, late };
const call = (name: string, value: any) => table[JSON.parse(JSON.stringify(name)) as string]!(value);
for (let round = 0; round < 3; round++) {
  said.push(call("loose", { kind: "a" }), call("loose", JSON.parse('{"kind":"b","extra":[1,2]}')), call("branded", { kind: "c", size: 3 }), call("branded", JSON.parse('{"kind":"dd","size":4}')), call("whole", { kind: "e", size: 5 }), call("whole", JSON.parse('{"kind":"f","size":6}')));
  const one: any = { kind: "g" }; said.push(call("late", one)); fill(one); said.push(call("late", one), call("late", JSON.parse('{"kind":"h","later":[1]}')));
}
console.log(said.join(" "));
export {};
