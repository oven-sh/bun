// Errors whose message is a sum are thrown where the catch clause never reads what it caught. What converting an operand of the sum does is seen all the same.
const log: string[] = [];

function fold(sum: number, value: unknown): number {
  const n = typeof value === "number" ? value : String(value).length + 0.0625;
  return (sum * 31 + n) % 1000003;
}
function show(value: unknown): string {
  return typeof value === "bigint" ? value + "n" : String(value);
}
function callee(x: number): number {
  if (x === 4) throw new RangeError("turn " + show(x));
  return x % 7;
}
async function drive(to: number): Promise<void> {
  let sum = 0;
  let i: number = 0;
  do {
    try {
      sum = fold(sum, await callee(i));
    } catch (error) {}
  } while ((i++, i <= to));
}

function convertible(value: number): unknown {
  switch (value % 5) {
    case 0:
      return {
        toString() {
          log.push("toString " + value);
          return "text";
        },
      };
    case 1:
      return {
        valueOf() {
          log.push("valueOf " + value);
          return value;
        },
      };
    case 2:
      return {
        [Symbol.toPrimitive](hint: string) {
          log.push("toPrimitive " + hint + " " + value);
          return value;
        },
      };
    case 3:
      return {
        toString() {
          log.push("toString throws " + value);
          throw new TypeError("no text");
        },
      };
    default:
      return new Proxy(
        {},
        {
          get(target, key) {
            log.push("get " + String(key));
            return undefined;
          },
        },
      );
  }
}
function throwConverted(to: number): void {
  for (let i = 0; i <= to; i++) {
    try {
      throw new RangeError("turn " + convertible(i));
    } catch {}
    try {
      throw "turn " + convertible(i);
    } catch {}
    try {
      throw `turn ${convertible(i)}`;
    } catch {}
  }
}

function pick(x: number): unknown {
  return x === 0 ? Symbol("s") : x === 1 ? 10n : x === 2 ? 1.5 : x === 3 ? null : "text";
}
function throwJoined(x: number): number {
  log.push("joined " + x);
  if (x < 5) throw new RangeError("turn " + (pick(x) as string));
  return x;
}
function throwAdded(x: number): number {
  log.push("added " + x);
  if (x < 5) throw new RangeError(String((pick(x) as number) + 1));
  return x;
}
async function driveBoth(to: number): Promise<void> {
  let i = 0;
  do {
    try {
      await throwJoined(i);
      log.push("completed " + i);
    } catch (error) {}
    try {
      await throwAdded(i);
      log.push("completed the sum " + i);
    } catch {}
  } while ((i++, i <= to));
}

function joinTexts(a: string, b: string): number {
  try {
    throw new RangeError(a + b);
  } catch {
    return a.length + b.length;
  }
}

let kept: unknown;
async function keep(to: number): Promise<void> {
  let i = 0;
  do {
    try {
      await callee(i);
    } catch (error) {
      kept = error;
    }
  } while ((i++, i <= to));
}

await drive(4);
throwConverted(4);
await driveBoth(5);
log.push("lengths " + joinTexts(show(12n), show(log.length)));
await keep(4);
log.push((kept as Error).name + ": " + (kept as Error).message);
console.log(log.join("\n"));
