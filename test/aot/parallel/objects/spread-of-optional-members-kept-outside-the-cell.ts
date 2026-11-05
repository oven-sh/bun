// Optional members that are stored late lie outside the cell. A spread into the same type copies them without a call into the run time.
// COUNT: operation:operationAOTCopyDataProperties <= 32
// COUNT: operation:operationAOTCopyObject <= 8
type Options = { name: string; a?: number; b?: string; c?: number; d?: boolean; e?: number[]; f?: number; g?: Options };
function make(i: number): Options {
  const made: Options = { name: "n" + i };
  if (i & 1) made.a = i;
  if (i & 2) made.b = "b" + i;
  if (i & 4) made.c = i / 2;
  if (i & 8) made.d = (i & 16) !== 0;
  if (i & 16) made.e = [i, i + 1];
  if (i & 32) made.f = -i;
  if (i & 64) made.g = { name: "inner", a: i };
  return made;
}
const list: Options[] = [];
for (let i = 0; i < 256; i++) list.push(make(i));

function copyAll(from: Options[]): Options[] {
  const copies: Options[] = [];
  for (const each of from) copies.push({ ...each });
  return copies;
}
let copies = list;
for (let round = 0; round < 40; round++) copies = copyAll(copies);

let text = "";
for (let i = 0; i < 256; i += 17) text += JSON.stringify(copies[i]) + "\n";
console.log(text);
let same = 0;
for (let i = 0; i < 256; i++) {
  if (JSON.stringify(copies[i]) === JSON.stringify(list[i]) && copies[i] !== list[i] && copies[i].e === list[i].e && copies[i].g === list[i].g) same++;
}
console.log(same);

// A copy has storage of its own.
const first = copies[127];
const second: Options = { ...first };
second.a = -1;
second.g = undefined;
delete second.b;
second.b = "again";
console.log(JSON.stringify(first), JSON.stringify(second));
const bare: Options = { ...copies[0] };
bare.f = 6;
console.log(JSON.stringify(copies[0]), JSON.stringify(bare));
