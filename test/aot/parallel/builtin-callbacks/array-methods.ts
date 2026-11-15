function show(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(show).join(" ")}]`;
  if (typeof value === "symbol") return "symbol";
  return `${typeof value}:${Object.is(value, -0) ? "-0" : String(value)}`;
}

function total(line: string): number {
  const [from, to, weight] = line.split(" ").map(Number);
  let sum = 0;
  for (const part of line.split(" ").map(Number)) sum += part;
  return sum + from - to * weight;
}
console.log(show(total("1 2 3")), show(total("4 x 5")), show(total("")), show(total("7")));

console.log(show(["1", "2.5", "x", ""].map(Number)));
console.log(show([1, -0, 2.5].map(String)));
console.log(show([0, 1, "", "a", null, undefined, NaN].filter(Boolean)));
console.log(show(["10", "10", "10"].map(parseInt)));
console.log(show(["1.5", "2"].map(parseFloat)));
console.log(show([1.5, -0.5].map(Math.floor)));
console.log(show(["a b"].map(encodeURIComponent as any)));
console.log(show([[1], 2].map(Array.isArray)));
console.log(show([{ a: 1 }].map(Object.keys as any)));
console.log(show(["a", "b"].map(Symbol as any)));
console.log(show([1, 2].map(BigInt as any)));
console.log(show([3, 4].map(Array as any)));
console.log(show(["1"].some(Number)), show(["0"].every(Number)), show(["x", "2"].find(Number)), show(["x", "2"].findIndex(Number)));
console.log(show(["1", "2"].flatMap(Number as any)));
console.log(show([4, 9].reduce(Math.max as any)), show([4, 9].reduceRight(Math.min as any, 5)));
console.log(show(Array.from(["5", "6"], Number)), show(Array.from("78", Number)));
console.log(show([, 1, , 2].map(String)));
["seen"].forEach(String as any);

for (const notCallable of [Math, JSON, Reflect, undefined, {}, 5]) {
  try {
    console.log(show([1].map(notCallable as any)));
  } catch (error) {
    console.log((error as Error).name);
  }
}
for (const needsNew of [Map, Promise, Uint8Array, class {}]) {
  try {
    console.log(show(["1"].map(needsNew as any)));
  } catch (error) {
    console.log((error as Error).name);
  }
}

const picked: (value: string) => unknown = process.argv.length > 50 ? String : Number;
console.log(show(["8", "9"].map(picked)));
const inField = { convert: Number as (value: string) => number };
console.log(show(["8", "9"].map(inField.convert)));
