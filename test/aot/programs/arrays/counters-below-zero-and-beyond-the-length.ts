// Loops whose counter indexes an array, a typed array or a string while it is negative, inside the length, beyond it, or near the ends of the 32-bit integers: each read gives what plain Bun gives.
function describe(value: unknown): string {
  return value === undefined ? "u" : typeof value === "number" && value !== value ? "n" : String(value);
}

function fromZero(a: number[], end: number): string {
  let seen = "";
  for (let i = 0; i < end; i++) seen += describe(a[i]) + " ";
  return seen;
}

function fromBelowZero(a: number[], start: number, end: number): string {
  let seen = "";
  for (let i = start; i < end; i++) seen += describe(a[i]) + " ";
  return seen;
}

function downToBelowZero(a: number[], start: number, end: number): string {
  let seen = "";
  for (let i = start; i >= end; i--) seen += describe(a[i]) + " ";
  return seen;
}

function sumFromZero(a: number[], end: number): number {
  let sum = 0;
  for (let i = 0; i < end; i++) sum += a[i];
  return sum;
}

function sumOfPresent(a: number[], start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) {
    const element = a[i];
    if (element !== undefined) sum += element;
  }
  return sum;
}

function bytesAround(bytes: Uint8Array, start: number, end: number): string {
  let seen = "";
  for (let i = start; i < end; i++) seen += describe(bytes[i]) + " ";
  return seen;
}

function codesAround(text: string, start: number, end: number): string {
  let seen = "";
  for (let i = start; i < end; i++) seen += describe(text.charCodeAt(i)) + " ";
  return seen;
}

function storesAround(a: number[], start: number, end: number): string {
  for (let i = start; i < end; i++) a[i] = i * 2;
  return a.length + ": " + a.join(",") + " | " + Object.keys(a).join(",");
}

function nearLargestInteger(a: number[], steps: number): string {
  let seen = "";
  for (let i = 2147483645, step = 0; step < steps; i++, step++) seen += i + "=" + describe(a[i]) + " ";
  return seen;
}

function nearSmallestInteger(a: number[], steps: number): string {
  let seen = "";
  for (let i = -2147483646, step = 0; step < steps; i--, step++) seen += i + "=" + describe(a[i]) + " ";
  return seen;
}

function comparesCounterWithLength(a: number[], start: number, end: number): string {
  let seen = "";
  for (let i = start; i < end; i++) seen += (i < a.length ? "<" : i === a.length ? "=" : ">") + (i >= 0 ? "+" : "-");
  return seen;
}

const five = [10, 20, 30, 40, 50];
const bytes = new Uint8Array([1, 2, 3]);
for (let round = 0; round < 200; round++) {
  const last = round === 199;
  const lines = [
    fromZero(five, 0), fromZero(five, 5), fromZero(five, 8), fromZero([], 2),
    fromBelowZero(five, -3, 2), fromBelowZero(five, -1, 7), fromBelowZero(five, 3, 6),
    downToBelowZero(five, 4, 0), downToBelowZero(five, 6, -2), downToBelowZero(five, -1, -3),
    String(sumFromZero(five, 5)), String(sumFromZero(five, 6)), String(sumFromZero(five, 0)),
    String(sumOfPresent(five, -4, 9)), String(sumOfPresent(five, 2, 4)),
    bytesAround(bytes, -2, 5), bytesAround(bytes, 0, 3), bytesAround(new Uint8Array(0), -1, 1),
    codesAround("abc", -2, 5), codesAround("", -1, 1),
    storesAround([1, 2, 3], 1, 5), storesAround([1, 2, 3], -2, 1), storesAround([], 0, 3),
    nearLargestInteger(five, 5), nearSmallestInteger(five, 5),
    comparesCounterWithLength(five, -2, 8),
  ];
  if (last) for (const line of lines) console.log(line);
}
