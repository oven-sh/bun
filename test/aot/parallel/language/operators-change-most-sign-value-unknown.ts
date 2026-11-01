// Applies the operators with one operand, and those whose other operand changes at most the sign, to values whose type the program doesn't say: once at the top of the file, in a loop and in a function. Prints the bytes of each result.
const bytes = new Uint8Array(8),
  number = new Float64Array(bytes.buffer);
const text = (value: number) => {
  number[0] = value;
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0"))
    .reverse()
    .join("");
};
const line = (...values: any[]) => values.map(text).join(" ");

const holder: any = (globalThis as any)[process.argv.length > 99 ? "Math" : "Number"];
const parsed: any = JSON.parse('[0, -0, 5, -0.5, 2147483648, -2147483648, 1e400, "x", "7", null, true, 0]');

console.log("read and negated", text(holder.NaN), text(-holder.NaN), text(-(-holder.NaN)), text(-holder.MAX_VALUE));

const a: any = holder.NaN;
console.log("NaN", line(-a, +a, -(-a), a - 0, 0 - a, a + 0, a * 1, a * -1, a / 1, a / -1, ~a));
parsed[11] = -holder.NaN;
const b: any = parsed[11];
console.log("-NaN", line(-b, +b, -(-b), b - 0, 0 - b, b + 0, b * 1, b * -1, b / 1, b / -1, ~b));
const c: any = parsed[0];
console.log("0", line(-c, +c, -(-c), c - 0, 0 - c, c + 0, c * 1, c * -1, c / 1, c / -1, ~c));
const d: any = parsed[1];
console.log("-0", line(-d, +d, -(-d), d - 0, 0 - d, d + 0, d * 1, d * -1, d / 1, d / -1, ~d));
const e: any = parsed[3];
console.log("-0.5", line(-e, +e, -(-e), e - 0, 0 - e, e + 0, e * 1, e * -1, e / 1, e / -1, ~e));
const f: any = parsed[4];
console.log("2 ** 31", line(-f, +f, -(-f), f - 0, 0 - f, f + 0, f * 1, f * -1, f / 1, f / -1, ~f));
const g: any = parsed[5];
console.log("-(2 ** 31)", line(-g, +g, -(-g), g - 0, 0 - g, g + 0, g * 1, g * -1, g / 1, g / -1, ~g));
const h: any = parsed[7];
console.log("a text", line(-h, +h, -(-h), h - 0, 0 - h, h * 1, h * -1, h / 1, h / -1, ~h));
const i: any = holder.nothing;
console.log("undefined", line(-i, +i, -(-i), i - 0, 0 - i, i + 0, i * 1, i * -1, i / 1, i / -1, ~i));

let up: any = holder.NaN,
  down: any = parsed[11];
up++;
down--;
console.log("counted", text(up), text(down), text(-up), text(-down));
const kept = -holder.NaN;
console.log("kept", text(kept), text(-kept), Object.is(kept, NaN), [kept].includes(NaN), String(kept));

const values: any[] = [holder.NaN, ...parsed, undefined];
for (const value of values)
  console.log(
    "in a loop",
    line(-value, +value, -(-value), value - 0, 0 - value, value * 1, value * -1, value / 1, value / -1, ~value),
  );

function apply(value: any) {
  return line(-value, +value, -(-value), value - 0, 0 - value, value * 1, value * -1, value / 1, value / -1, ~value);
}
for (const value of values) console.log("in a function", apply(value));
