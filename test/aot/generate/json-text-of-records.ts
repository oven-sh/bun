// The programs of json-text-of-records that are a table written out: records whose keys are as long as what is written into the text at once, a little shorter and a little longer, in five alphabets.
import { programsOf } from "../generate";

const keyLengths = [1, 3, 4, 5, 12, 13, 120, 121, 124, 125, 128, 1000, 4084, 4085, 4086, 4087, 4088, 4089, 4090, 4091, 4092, 4093, 4096, 4097];
const alphabets: Record<string, string> = { plain: "k", quotes: '\\"', controls: "\\u0001", latin: "\\xe9", wide: "\\u4e2d" };

const prelude = `function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
const numbers = [0, -0, 1, 99999999, 100000000, -1, 1.7976931348623157e308, -1.7976931348623157e308, -0.000001234567890123, 5e-324, 1e21, 123456789012345680000, NaN, Infinity, -9007199254740991];
const texts = ["", "s", "quote\\"back\\\\slash", "\\u0000\\u001f", "\\u4e2d\\ud83d\\ude00", "\\ud800", "\\udc00x", "\\xe9\\xff", "x".repeat(4095), "\\n".repeat(700), "y".repeat(70000)];
const dates = [new Date(0), new Date(8.64e15), new Date(-8.64e15), new Date(NaN), new Date(-62198755200000), new Date(253402300800000)];
let sum = 0;
`;

function programOf(letter: string): string {
  const types: string[] = [];
  const calls: string[] = [];
  for (const length of keyLengths) {
    const first = `"${letter.repeat(length)}"`;
    const second = `"z${letter.repeat(length)}"`;
    types.push(`interface Record${length} { a: number; ${first}: number; b: boolean; ${second}: string; c?: number; d: Date; e: number | null }`);
    types.push(`function textOf${length}(record: Record${length}): string { return JSON.stringify(record); }`);
    calls.push(`for (const n of numbers) for (const s of texts) for (const d of dates) {
  const record: Record${length} = { a: n, ${first}: -n, b: n > 0, ${second}: s, d, e: n > 5 ? null : n };
  sum = (sum + hash(textOf${length}(record))) >>> 0;
  record.c = n;
  sum = (sum + hash(textOf${length}(record))) >>> 0;
}
console.log(${length}, sum);`);
  }
  return `${types.join("\n")}\n${prelude}${calls.join("\n")}\nexport {};\n`;
}

export const programs = () =>
  programsOf(Object.fromEntries(Object.entries(alphabets).map(([name, letter]) => [`keys-of-every-length-near-four-thousand-in-${name}-letters.ts`, programOf(letter)])));
