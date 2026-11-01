// Eight interfaces with the same fields, each met first as the type of a field of the one before; the last gives a field another type. No round is made over the fields.
// Flags: --aot-limit=MaxRoundsOfFieldTypes:0
interface Ring1 {
  next: Ring2 | null;
  v: number;
}
interface Ring2 {
  next: Ring3 | null;
  v: number;
}
interface Ring3 {
  next: Ring4 | null;
  v: number;
}
interface Ring4 {
  next: Ring5 | null;
  v: number;
}
interface Ring5 {
  next: Ring6 | null;
  v: number;
}
interface Ring6 {
  next: Ring7 | null;
  v: number;
}
interface Ring7 {
  next: Ring8 | null;
  v: number;
}
interface Ring8 {
  next: Ring1 | null;
  v: number | string;
}

function walk(first: Ring1, steps: number): string {
  let at: { next: any; v: number | string } = first;
  let told = "";
  for (let step = 0; step < steps && at; step++) {
    told += typeof at.v + ":" + at.v + " ";
    at = at.next;
  }
  return told;
}
function second(first: Ring1): number {
  return first.next ? first.next.v + first.v : -1;
}
function parsed(text: string): Ring1 {
  return JSON.parse(text);
}
let text = '{"next":null,"v":"last"}';
for (let level = 7; level >= 1; level--) text = '{"next":' + text + ',"v":' + level + "}";
const first = parsed(text);
console.log(walk(first, 10) + "| " + second(first));
