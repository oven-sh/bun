// `target.set(source, offset)` and `source.copy(target, targetStart, sourceStart, sourceEnd)` move elements from one typed
// array or Buffer to another, in a loop, so that the call may be compiled in place. Each scene picks the two views (the same
// kind of element or not, over one buffer or two, overlapping, of length 0, on a buffer that can grow or was detached, a
// subclass, a plain list as the source) and the offsets (inside, at the end, past it, negative, a fraction, NaN, missing,
// an object). The lengths, `byteOffset` and every byte afterwards are printed, and so is the error if the call throws.
import type { Random } from "./random";

const kinds = ["Uint8Array", "Int8Array", "Uint8ClampedArray", "Uint16Array", "Int32Array", "Float32Array", "Float64Array", "BigInt64Array"]; // prettier-ignore

/** Statements that declare `target` and `source`. KIND and OTHER are typed array classes. */
const pairs = [
  "const target = new KIND(8);\nconst source = KIND.from(VALUES);",
  "const target = new KIND(8);\nconst source = KIND.from(VALUES);",
  "const target = new KIND(40);\nconst source = new KIND(36).fill(ONE);",
  "const target = new KIND(8);\nconst source = OTHER.from(OTHERVALUES);",
  "const whole = KIND.from(LONGVALUES);\nconst target = whole.subarray(2);\nconst source = whole.subarray(0, 4);",
  "const whole = KIND.from(LONGVALUES);\nconst target = whole.subarray(0, 6);\nconst source = whole.subarray(2, 6);",
  "const whole = KIND.from(LONGVALUES);\nconst target = whole;\nconst source = whole;",
  "const target = new KIND(8);\nconst source = new KIND(0);",
  "const target = new KIND(0);\nconst source = KIND.from(VALUES);",
  "const growing = new ArrayBuffer(8 * KIND.BYTES_PER_ELEMENT, { maxByteLength: 64 * KIND.BYTES_PER_ELEMENT });\nconst target = new KIND(growing);\nconst source = KIND.from(VALUES);",
  "const growing = new ArrayBuffer(8 * KIND.BYTES_PER_ELEMENT, { maxByteLength: 64 * KIND.BYTES_PER_ELEMENT });\nconst target = new KIND(8);\nconst source = new KIND(growing, 0, 3);",
  "const target = new KIND(8);\nconst source = KIND.from(VALUES);\nif (round === LAST) source.buffer.transfer();",
  "const target = new KIND(8);\nconst source = KIND.from(VALUES);\nif (round === LAST) target.buffer.transfer();",
  "class Below extends KIND {}\nconst target = new Below(8);\nconst source = Below.from(VALUES);",
  "const target = new KIND(8);\nconst source = VALUES;",
  "const target = new KIND(8);\nconst source = { length: 2, 0: ONE, 1: ONE };",
  "const target = new KIND(8);\nconst source = round === LAST ? VALUES : KIND.from(VALUES);",
  "const target = new KIND(8);\nconst source = round === LAST ? OTHER.from(OTHERVALUES) : KIND.from(VALUES);",
];

const bufferPairs = [
  "const target = Buffer.alloc(8);\nconst source = Buffer.from([1, 2, 3]);",
  "const target = new Uint8Array(8);\nconst source = Buffer.from([1, 2, 3]);",
  "const whole = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);\nconst target = whole.subarray(2);\nconst source = whole.subarray(0, 4);",
  "const target = Buffer.alloc(40);\nconst source = Buffer.alloc(36, 7);",
  "const target = Buffer.alloc(0);\nconst source = Buffer.from([1, 2, 3]);",
  "const target = round === LAST ? new Uint16Array(4) : Buffer.alloc(8);\nconst source = Buffer.from([1, 2, 3]);",
];

const offsets = ["0", "1", "5", "6", "8", "9", "-1", "1.9", "-0.5", "NaN", "undefined", "Infinity", '"2"', "null", "{ valueOf: () => 2 }", "round % 3", "2 ** 32", "2 ** 32 + 1"]; // prettier-ignore

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 5); scene < total; scene++) {
    const rounds = random.pick([1, 3, 300, 3000]);
    const isBuffer = random.chance(0.3);
    const kind = random.pick(kinds);
    const other = random.pick(kinds.filter(each => each !== kind && (each === "BigInt64Array") === (kind === "BigInt64Array")).concat(kind === "BigInt64Array" ? ["BigUint64Array"] : [])); // prettier-ignore
    const big = kind === "BigInt64Array";
    const list = (values: number[]) =>
      `[${values.map(value => (big ? `${Math.trunc(value)}n` : String(value))).join(", ")}]`;
    const pair = (isBuffer ? random.pick(bufferPairs) : random.pick(pairs))
      .replaceAll("OTHERVALUES", list([300, -2, 3.5]))
      .replaceAll("LONGVALUES", list([1, 2, 3, 4, 5, 6, 7, 8]))
      .replaceAll("VALUES", list([1, 2, 3]))
      .replaceAll("ONE", big ? "7n" : "7")
      .replaceAll("OTHER", other)
      .replaceAll("KIND", kind)
      .replaceAll("LAST", String(rounds - 1));
    const offset = () => random.pick(offsets);
    const move = isBuffer
      ? random.pick([
          `source.copy(target)`,
          `source.copy(target, ${offset()})`,
          `source.copy(target, ${offset()}, ${offset()})`,
          `source.copy(target, ${offset()}, ${offset()}, ${offset()})`,
          `target.set(source, ${offset()})`,
        ])
      : random.pick([`target.set(source)`, `target.set(source, ${offset()})`, `target.set(source, ${offset()})`]);
    const change = pair.includes("growing") ? random.pick(["", `if (round === ${rounds - 1}) growing.resize(2 * ${kind}.BYTES_PER_ELEMENT);`, `if (round === ${rounds - 1}) growing.resize(16 * ${kind}.BYTES_PER_ELEMENT);`]) : ""; // prettier-ignore
    scenes.push(`function scene${scene}(round) {
  ${pair.replaceAll("\n", "\n  ")}
  ${change}
  const answer = told(() => ${move});
  return [answer, target.length, target.byteLength, target.byteOffset, told(() => Array.from(target).join("+")), source.length, source.byteOffset].join(" ");
}
{
  const seen = new Set();
  let last;
  for (let round = 0; round < ${rounds}; round++) seen.add((last = scene${scene}(round)));
  console.log("scene ${scene}", seen.size, [...seen].slice(0, 3).join(" | "), "| last", last);
}`);
  }
  return `function told(ask) {
  try {
    return ask();
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
