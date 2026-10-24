// Doubles that leave typed code for code that knows nothing of them: each is boxed as an int32 where it is one, and only there.
const values: number[] = [0, -0, 1, -1, 0.5, -0.5, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, -4294967296, 4294967295, 1e300, -1e300, 5e-324, NaN, Infinity, -Infinity, 9007199254740991, 1.0000000000000002, 123456789, -123456789];
class Holder { value: number = 0.5; optional?: number; }
function describe(value: unknown): string {
  return `${typeof value} ${Object.is(value, -0) ? "-0" : String(value)} ${Number.isInteger(value)} ${(value as number) | 0} ${JSON.stringify([value])} ${1 / (value as number)}`;
}
const sink: unknown[] = [];
function box(value: number): unknown { return value; }
function twice(value: number): number { return value * 2 / 2; }
const holder = new Holder();
const anyHolder: any = holder;
const key = ["val", "ue"].join("");
const optionalKey = ["opt", "ional"].join("");
const doubles = values.map(value => value + 0.5 - 0.5);
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    sink.length = 0;
    sink.push(box(twice(value)));
    holder.value = value;
    holder.optional = value;
    sink.push(anyHolder[key], anyHolder[optionalKey], anyHolder.value, anyHolder.optional, (doubles as any)[i]);
    if (round === 2) console.log(sink.map(describe).join(" | "));
  }
}
