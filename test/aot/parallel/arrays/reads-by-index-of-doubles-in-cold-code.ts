// Flags: --aot-heat=everything-is-cold
// Reads by index in cold code of arrays in Double storage: fractions, whole numbers, -0, NaN, holes, and indexes outside the array.
const out: string[] = [];
const show = (label: string, value: unknown) => out.push(`${label}: ${Object.is(value, -0) ? "-0" : String(value)} ${typeof value}`);

function read(list: number[], index: number): number | undefined {
  return list[index];
}
function readAny(list: any, index: any): unknown {
  return list[index];
}

const doubles: number[] = [0.5, 2, -0, NaN, 1e300, -2147483649, 4294967296, Infinity];
for (let i = -1; i <= doubles.length; i++) {
  show(`typed ${i}`, read(doubles, i));
  show(`any ${i}`, readAny(doubles, i));
}
show("fraction index", readAny(doubles, 0.5));
show("text index", readAny(doubles, "1"));
show("large index", readAny(doubles, 4294967294));

const holes: number[] = [1.5, , 2.5] as number[];
for (let i = 0; i < 4; i++) show(`hole ${i}`, read(holes, i));
Object.setPrototypeOf(holes, { __proto__: Array.prototype, 1: "inherited" });
for (let i = 0; i < 4; i++) show(`hole below an object with that index ${i}`, readAny(holes, i));

const grown: number[] = [];
for (let i = 0; i < 40; i++) grown.push(i / 4);
let sum = 0;
for (let i = 0; i < 44; i++) sum += read(grown, i) ?? 1000;
show("sum", sum);
grown.length = 3;
show("behind a shorter length", read(grown, 3));
console.log(out.join("\n"));
