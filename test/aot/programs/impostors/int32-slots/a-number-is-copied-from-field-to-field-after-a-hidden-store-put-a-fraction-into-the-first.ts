// The only stores in sight put small integers into the first field; the second field gets what is read from the first, the third what is read from the second, directly, through a helper and through a closure.
// So all three look like int32 fields. Stores that the build cannot attribute, under a computed key, by Object.assign, Reflect.set and Object.defineProperty, put other numbers into the first one.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Source { n = 0; }
class Middle { n = 0; }
class Target { n = 0; viaHelper = 0; viaClosure = 0; sum = 0; }
function id<T>(x: T): T {
  return x;
}
function copy(source: Source, middle: Middle, target: Target) {
  middle.n = source.n;
  target.n = middle.n;
  target.viaHelper = id(source.n);
  const captured = middle.n;
  (() => { target.viaClosure = captured; })();
  target.sum = source.n + middle.n;
}
function three(): [Source, Middle, Target] {
  const all: [Source, Middle, Target] = [new Source(), new Middle(), new Target()];
  all.forEach(handOver);
  return all;
}
const key: string = JSON.parse('"n"');
const routes: [string, (source: Source, value: number) => void][] = [
  ["a computed key", (source, value) => { (source as any)[key] = value; }],
  ["Object.assign", (source, value) => { Object.assign(source, { [key]: value }); }],
  ["Reflect.set", (source, value) => { Reflect.set(source, key, value); }],
  ["Object.defineProperty", (source, value) => { Object.defineProperty(source, key, { value }); }],
  ["a parsed record", (source, value) => { Object.assign(source, JSON.parse(`{"n":${JSON.stringify(Number.isFinite(value) && !Object.is(value, -0) ? value : 0.125)}}`)); }],
];
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const [source, middle, target] = three();
  source.n = i & 127;
  copy(source, middle, target);
  sum += target.n + target.viaHelper + target.viaClosure + target.sum;
}
console.log("warm", sum);
for (const [label, put] of routes) {
  const lines: string[] = [];
  for (const value of odd) {
    const [source, middle, target] = three();
    put(source, value);
    const held = source.n;
    copy(source, middle, target);
    const right = [middle.n, target.n, target.viaHelper, target.viaClosure].every(stored => Object.is(stored, held)) && Object.is(target.sum, held + held);
    lines.push(`${exact(held)} ${right} ${JSON.stringify(target)}`);
  }
  console.log(label + ":", lines.join(" | "));
}
