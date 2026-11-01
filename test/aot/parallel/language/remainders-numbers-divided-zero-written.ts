// Divides whole numbers and fractions by zero and prints the bytes of the remainders.
const bytes = new Uint8Array(8),
  number = new Float64Array(bytes.buffer);
const text = () =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, "0"))
    .reverse()
    .join("");
const boxes: unknown[] = [];

function remainderOfInt32s(dividend: number, divisor: number) {
  return (dividend | 0) % (divisor | 0);
}

function remainderOfUnsignedNumbers(dividend: number, divisor: number) {
  return (dividend >>> 0) % (divisor >>> 0);
}

function remainderAboveInt32(list: number[], other: number[]) {
  return (list.length + 4294967296) % (other.length + other.length);
}

function remainderBelowInt32(list: number[], other: number[]) {
  return (list.length - 4294967299) % (other.length - other.length);
}

function remainderOfWholeNumbers(dividend: number, divisor: number) {
  return Math.trunc(dividend) % Math.trunc(divisor);
}

function remainderOfNumbers(dividend: number, divisor: number) {
  return dividend % divisor;
}

function remainderOfAnything(dividend: any, divisor: any) {
  return dividend % divisor;
}

for (const dividend of [-2147483648, -7, -1, 0, 1, 7, 2147483647, 4294967296, -9007199254740991]) {
  const none = dividend - dividend;
  const row: string[] = [];
  number[0] = remainderOfInt32s(dividend, none);
  row.push(text());
  number[0] = remainderOfWholeNumbers(dividend, none);
  row.push(text());
  number[0] = remainderOfNumbers(dividend, none);
  row.push(text());
  number[0] = remainderOfAnything(dividend, none);
  row.push(text());
  number[0] = (dividend | 0) % 0;
  row.push(text());
  number[0] = dividend % 0;
  row.push(text());
  number[0] = (dividend + 0.5) % none;
  row.push(text());
  boxes[0] = remainderOfInt32s(dividend, none);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = (dividend | 0) % (none | 0);
  number[0] = boxes[0] as number;
  row.push(text());
  let left = dividend | 0;
  left %= none;
  number[0] = left;
  row.push(text());
  let whole = dividend | 0;
  whole %= none | 0;
  number[0] = whole;
  row.push(text());
  number[0] = remainderOfUnsignedNumbers(dividend, none);
  row.push(text());
  console.log(dividend, row.join(" "));
}

const three = [1, 2, 3],
  empty: number[] = [];
number[0] = remainderAboveInt32(three, empty);
const above = text();
number[0] = remainderBelowInt32(three, empty);
console.log("lengths", above, text());
