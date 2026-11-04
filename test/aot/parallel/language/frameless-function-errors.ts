// Errors raised in small leaf functions, which run without a frame of their own: what the caller catches, and its live locals after the catch.
interface Box {
  width: number;
  height: number;
}
type Leaf = "width" | "limit" | "raise";

function widthOf(box: Box | null): number {
  return box!.width;
}
function readLimit(): number {
  return limit;
}
function toNumber(value: unknown): number {
  return value as number;
}
function raiseIf(shouldThrow: boolean, value: unknown): unknown {
  if (shouldThrow) throw value;
  return value;
}

// The message of a read from null differs in compiled code, so only the value and the property name are compared.
function describeCaught(error: unknown, thrown: unknown): string {
  if (!(error instanceof Error)) return `caught ${typeof error} ${String(error)}, same value ${Object.is(error, thrown)}`;
  const message = error instanceof TypeError ? `names null ${error.message.includes("null")}, names width ${error.message.includes("width")}` : error.message;
  return `caught ${error.name}, TypeError ${error instanceof TypeError}, ReferenceError ${error instanceof ReferenceError}, ${message}`;
}

function attemptDirectly(leaf: Leaf, box: Box | null, shouldThrow: boolean, value: unknown, seed: number): string {
  let a = seed, b = seed * 3, c = seed ^ 21, x = seed * 0.5, y = seed + 0.25, z = seed / 8;
  let outcome = "";
  try {
    a++;
    x += 0.5;
    switch (leaf) {
      case "width":
        outcome = "returned " + widthOf(box);
        break;
      case "limit":
        outcome = "returned " + readLimit();
        break;
      case "raise":
        outcome = "returned " + String(raiseIf(shouldThrow, value));
        break;
    }
    b++;
    y += 0.5;
  } catch (error) {
    outcome = describeCaught(error, value);
    c++;
    z += 0.5;
  }
  return [outcome, a, b, c, x, y, z].join(" ");
}

function attempt(leaf: () => unknown, thrown: unknown, seed: number): string {
  let a = seed, b = seed * 3, c = seed ^ 21, x = seed * 0.5, y = seed + 0.25, z = seed / 8;
  let outcome = "";
  try {
    a++;
    x += 0.5;
    outcome = "returned " + String(leaf());
    b++;
    y += 0.5;
  } catch (error) {
    outcome = describeCaught(error, thrown);
    c++;
    z += 0.5;
  }
  return [outcome, a, b, c, x, y, z].join(" ");
}

function describeNumber(value: unknown): string {
  if (typeof value === "number") return "number " + value;
  return value == null ? "nullish " + String(value) : "not a number";
}
function describeFailedCast(error: unknown): string {
  return error instanceof TypeError ? "not a number" : "unexpected " + String(error);
}

// A cast that fails throws only where types are checked. Both outcomes print the same, and no local depends on which one it was.
function attemptCast(convert: (value: unknown) => number, value: unknown, seed: number): string {
  let a = seed, b = seed * 3, c = seed ^ 21, x = seed * 0.5, y = seed + 0.25, z = seed / 8;
  let direct = "";
  let indirect = "";
  try {
    a++;
    x += 0.5;
    direct = describeNumber(toNumber(value));
  } catch (error) {
    direct = describeFailedCast(error);
  }
  try {
    b++;
    y += 0.5;
    indirect = describeNumber(convert(value));
  } catch (error) {
    indirect = describeFailedCast(error);
  }
  return [direct, "|", indirect, a, b, c, x, y, z].join(" ");
}

const box: Box = { width: 7, height: 9 };
const thrownValues: unknown[] = [undefined, 0, null, false, "", NaN, "text", 12.5, box, new RangeError("out of range"), new Error("plain")];
const castValues: unknown[] = [42, 1.5, -0, "text", "", true, box, null, undefined];
const converters: ((value: unknown) => number)[] = [toNumber, value => value as number];
const leaves: ((turn: number) => number)[] = [
  turn => widthOf(turn % 5 === 0 ? null : box),
  turn => readLimit() + turn,
  turn => raiseIf(turn % 7 === 0, turn) as number,
];

function sweep(turns: number): string {
  let a = 1, b = 2, c = 3, x = 0.5, y = 1.25, z = 2.75, errors = 0, values = 0;
  for (let turn = 0; turn < turns; turn++) {
    try {
      a = (a + leaves[turn % 3]!(turn)) | 0;
    } catch (error) {
      if (error instanceof Error) errors++;
      else values++;
    }
    b = (b + (a & 15)) | 0;
    c ^= b;
    x += y * 0.25;
    y += (c & 1) * 0.5;
    z = z * 0.5 + x;
  }
  return [a, b, c, x, y, z, errors, values].join(" ");
}

function report(): void {
  console.log(attemptDirectly("width", null, false, undefined, 1));
  console.log(attemptDirectly("width", box, false, undefined, 2));
  console.log(attemptDirectly("limit", box, false, undefined, 3));
  console.log(attempt(() => widthOf(null), undefined, 4));
  console.log(attempt(() => widthOf(box), undefined, 5));
  console.log(attempt(readLimit, undefined, 6));
  thrownValues.forEach((value, index) => {
    console.log(attemptDirectly("raise", box, true, value, 10 + index));
    console.log(attemptDirectly("raise", box, false, value, 30 + index));
    console.log(attempt(() => raiseIf(true, value), value, 50 + index));
    console.log(attempt(() => raiseIf(false, value), value, 70 + index));
  });
  castValues.forEach((value, index) => console.log(attemptCast(converters[index % 2]!, value, 90 + index)));
  console.log(sweep(3000));
}

console.log("limit is in its dead zone");
report();
const limit = box.height * 2;
console.log("limit is initialized");
report();
export {};
