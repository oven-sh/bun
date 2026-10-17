// Checks of the language that fail inside `try` (null and undefined where an object must be, variables read too early, what is no function, no constructor, not iterable, lengths out of range), with many values alive: the handler finds every value as it was.
interface Point { x: number; y: number; next?: Point | null }
const log: string[] = [];
function name(error: unknown): string {
  return error instanceof Error ? error.name : String(error);
}
function readsThroughNull(point: Point | null, a: number, b: number, c: number, d: number): string {
  let e = a + b, f = c * d, g = a - d, h = b / 4;
  try {
    e += point!.x;
    f += point!.next!.y;
    g += 100;
  } catch (error) {
    return [name(error), a, b, c, d, e, f, g, h].join();
  }
  return ["none", a, b, c, d, e, f, g, h].join();
}
function writesThroughNull(point: Point | null, a: number, b: number): string {
  const kept = a * b + 0.5;
  try {
    point!.x = a;
    point!.next!.y = b;
  } catch (error) {
    return [name(error), a, b, kept, point ? point.x : "no point"].join();
  }
  return ["none", a, b, kept].join();
}
function readsTooEarly(flag: boolean, a: number): string {
  const kept = a * 3;
  const read = () => late;
  try {
    if (flag) return "early " + read();
    log.push("not read");
  } catch (error) {
    return name(error) + " " + kept + " " + a;
  }
  const late = a + 1;
  return "none " + late + " " + kept;
}
function callsWhatIsNoFunction(callee: (() => number) | undefined, a: number, b: number): string {
  const kept = a ^ b;
  try {
    return "returned " + (callee!() + kept);
  } catch (error) {
    return [name(error), a, b, kept].join();
  }
}
function callsMethodOfNothing(holder: { run?: (n: number) => number } | null, a: number): string {
  const kept = a + 0.25;
  try {
    return "returned " + holder!.run!(a);
  } catch (error) {
    return [name(error), a, kept].join();
  }
}
class Plain { value = 1; }
function callsClass(a: number): string {
  const kept = a * 9;
  try {
    return String((Plain as unknown as () => number)());
  } catch (error) {
    return name(error) + " " + kept;
  }
}
function constructsArrow(a: number): string {
  const arrow = () => a;
  const kept = a * 7;
  try {
    return String(new (arrow as unknown as new () => object)());
  } catch (error) {
    return name(error) + " " + kept;
  }
}
function iteratesNothing(list: number[] | null | undefined, a: number, b: number): string {
  let sum = a;
  const kept = b * 2;
  try {
    for (const item of list!) sum += item;
  } catch (error) {
    return [name(error), a, b, sum, kept].join();
  }
  return ["none", sum, kept].join();
}
function destructuresNothing(pair: [number, number] | null, record: { p: number } | undefined, a: number): string {
  const kept = a - 0.5;
  try {
    const [first, second] = pair!;
    const { p } = record!;
    return ["none", first, second, p, kept].join();
  } catch (error) {
    return [name(error), a, kept].join();
  }
}
function lengthsOutOfRange(n: number, a: number): string {
  const kept = a * a;
  try {
    return "made " + new Array<number>(n).length + " " + "ab".repeat(n).length + " " + kept;
  } catch (error) {
    return [name(error), n, a, kept].join();
  }
}
function instanceOfNothing(value: object, a: number): string {
  const kept = a * 1.5;
  try {
    return String(value instanceof (undefined as unknown as typeof Plain)) + kept;
  } catch (error) {
    return name(error) + " " + kept;
  }
}
function inLoops(points: Array<Point | null>): string {
  let sum = 0, caught = 0, product = 1;
  for (let round = 0; round < 300; round++) {
    for (let i = 0; i < points.length; i++) {
      product = (product * 7 + i) % 1000003;
      try {
        sum += points[i]!.x + points[i]!.next!.y;
      } catch (error) {
        caught++;
      } finally {
        sum++;
      }
    }
  }
  return [sum, caught, product].join();
}
async function inAsync(point: Point | null, a: number): Promise<string> {
  const before = a * 3;
  await null;
  try {
    return "none " + point!.x;
  } catch (error) {
    return [name(error), a, before].join();
  }
}
async function main(): Promise<void> {
  const far: Point = { x: 1, y: 2, next: { x: 3, y: 4 } }, near: Point = { x: 5, y: 6 }, ends: Point = { x: 7, y: 8, next: null };
  for (const point of [far, near, ends, null]) console.log(readsThroughNull(point, 1, 2, 3, 4), writesThroughNull(point ? { ...point } : null, 5, 6));
  console.log(readsTooEarly(true, 4), readsTooEarly(false, 4), log.join());
  console.log(callsWhatIsNoFunction(() => 2, 3, 4), callsWhatIsNoFunction(undefined, 3, 4), callsMethodOfNothing({ run: n => n * 2 }, 5), callsMethodOfNothing({}, 5), callsMethodOfNothing(null, 5));
  console.log(callsClass(2), constructsArrow(3));
  console.log(iteratesNothing([1, 2], 3, 4), iteratesNothing(null, 3, 4), iteratesNothing(undefined, 3, 4));
  console.log(destructuresNothing([1, 2], { p: 3 }, 4), destructuresNothing(null, { p: 3 }, 4), destructuresNothing([1, 2], undefined, 4));
  console.log(lengthsOutOfRange(2, 3), lengthsOutOfRange(-1, 3), lengthsOutOfRange(1.5, 3));
  console.log(instanceOfNothing({}, 6));
  console.log(inLoops([far, near, null, ends, far]));
  console.log(await inAsync(far, 2), await inAsync(null, 2));
}
main();
