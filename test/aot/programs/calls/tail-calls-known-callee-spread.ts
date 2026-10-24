// `return f(...list)`, `return f.apply(thisArg, list)` and `return Math.max(...list)` where f is a function declared in the program.
// The results are typed, and chains of such calls of any length run in constant space.
const lines: string[] = [];
function say(...parts: unknown[]) {
  lines.push(parts.map(part => (typeof part === "object" && part !== null ? JSON.stringify(part) : String(part))).join(" "));
}
const deep = 300000;
let sink: unknown;

function sum3(a: number, b: number, c: number): number {
  return a + b + c;
}
function join3(a: string, b: string, c: string): string {
  return a + b + c;
}
function pair(a: number, b: number): { a: number; b: number } {
  return { a, b };
}
function spreadIntoSum(three: [number, number, number]): number {
  return sum3(...three);
}
function spreadIntoJoin(three: [string, string, string]): string {
  return join3(...three);
}
function spreadIntoPair(two: [number, number]): { a: number; b: number } {
  return pair(...two);
}
function applySum(three: [number, number, number]): number {
  return sum3.apply(undefined, three);
}
function largest(numbers: number[]): number {
  return Math.max(...numbers);
}
function smallest(numbers: number[]): number {
  return Math.min.apply(Math, numbers);
}
function throughTwo(three: [number, number, number]): number {
  return spreadIntoSum(...([three] as [[number, number, number]]));
}
function viaClosure(three: [number, number, number], scale: number): number {
  const scaled = (a: number, b: number, c: number) => (a + b + c) * scale;
  return scaled(...three);
}
sink = [spreadIntoSum, spreadIntoJoin, spreadIntoPair, applySum, largest, smallest, throughTwo, viaClosure];
say(spreadIntoSum([1, 2, 3.5]) + 1, spreadIntoJoin(["a", "b", "c"]).length, spreadIntoPair([1, 2]).b, applySum([4, 5, 6.5]) + 1, largest([3, 9.5, 4]) + 1, smallest([3, 9.5, 4]) + 1);
say(throughTwo([1, 2, 3]) * 2, viaClosure([1, 2, 3], 1.5) + 1, largest([]), smallest([]), largest([NaN, 1]), largest([-0, 0]) === 0);
say((sink as ((list: any, scale?: any) => unknown)[]).map((f, i) => f(i === 1 ? ["x", "y", "z"] : [7, 8, 9], 2)));
function spreadAnything(list: any): number {
  return (sum3 as (...xs: number[]) => number)(...list);
}
const iterable = { *[Symbol.iterator]() { yield 4; yield 5; yield 6.5; } };
sink = spreadAnything;
say(spreadAnything(iterable), spreadAnything([1, 2, 3, 4]), spreadAnything(new Set([1, 2, 3])), spreadAnything("123".split("").map(Number)));

function downBySpread(n: number, acc: number): number {
  if (n === 0) return acc + 0.5;
  return upBySpread(...([n - 1, acc + 1] as [number, number]));
}
function upBySpread(n: number, acc: number): number {
  if (n === 0) return acc - 0.5;
  return downBySpread(...([n - 1, acc + 2] as [number, number]));
}
function selfBySpread(n: number, acc: number): number {
  if (n === 0) return acc + 0.25;
  return selfBySpread(...([n - 1, acc + 1] as [number, number]));
}
function downByApply(n: number, acc: string): string {
  if (n === 0) return acc + "!";
  return upByApply.apply(undefined, [n - 1, n % 100000 === 0 ? acc + "d" : acc]);
}
function upByApply(n: number, acc: string): string {
  if (n === 0) return acc + "?";
  return downByApply.apply(undefined, [n - 1, n % 100000 === 1 ? acc + "u" : acc]);
}
function viaForwarder(n: number, acc: number): number {
  if (n === 0) return acc;
  return forwarder(...([n, acc] as [number, number]));
}
function forwarder(n: number, acc: number): number {
  return viaForwarder(n - 1, acc + 1);
}
sink = [downBySpread, upBySpread, selfBySpread, downByApply, upByApply, viaForwarder, forwarder];
say(downBySpread(deep, 0), downBySpread(deep + 1, 0), selfBySpread(deep, 0), downByApply(deep, ""), downByApply(deep + 1, ""), viaForwarder(deep, 0));
say((sink as ((n: number, acc: any) => unknown)[]).map((f, i) => f(deep + i, i === 3 || i === 4 ? "" : 0)));

function thrower(a: number, b: number): number {
  if (a > b) throw new RangeError("out of order: " + a + " " + b);
  return b - a;
}
function spreadIntoThrower(two: [number, number]): number {
  return thrower(...two);
}
for (const call of [() => spreadIntoThrower([1, 2]), () => spreadIntoThrower([2, 1]), () => spreadAnything(5)]) {
  try {
    say(call());
  } catch (error) {
    say((error as Error).name, (error as Error).message);
  }
}

let total = 0;
for (let i = 0; i < 20000; i++) total += spreadIntoSum([i, 1, 0.5]) + applySum([i, 2, 0.25]) + largest([i, 3]) + spreadIntoJoin(["a", "b", String(i & 7)]).length + spreadIntoPair([i, 1]).a;
say(total);
console.log(lines.join("\n"));
