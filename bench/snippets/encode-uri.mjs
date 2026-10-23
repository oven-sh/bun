// The six URI functions over a matrix of input shapes: short and long, 8-bit and 16-bit backed,
// with escapes and passthrough (nothing changes: the identity return fast path).
//
//   bun run bench/snippets/encode-uri.mjs
//   node bench/snippets/encode-uri.mjs
import { bench, group, run } from "../runner.mjs";

// A string decoded from UTF-16 bytes is 16-bit, whatever it holds.
const sixteenBit = string => Buffer.from(string, "utf16le").toString("utf16le");

const PLAIN_CHUNK = "the-quick-brown-fox-jumps-over-the-lazy-dog-1234567890.";
const ESCAPE_CHUNK = "my file (1) \u00e9+copy&x=1.jpg ";

const encodeInputs = [
  { name: "6 chars, passthrough", input: "photos" },
  { name: "28 chars, passthrough", input: "my-bucket-2026-10-16-cat.jpg" },
  { name: "26 chars, 7 escapes", input: "my file (1) \u00e9+copy&x=1.jpg" },
  { name: "60KB, passthrough", input: PLAIN_CHUNK.repeat(1100) },
  { name: "60KB, escapes", input: ESCAPE_CHUNK.repeat(2000) },
];

const decodeInputs = [
  { name: "6 chars, passthrough", input: "photos" },
  { name: "26 chars, 7 escapes", input: "my%20file%20(1)%20%C3%A9%2Bcopy%26x%3D1.jpg" },
  { name: "60KB, passthrough", input: PLAIN_CHUNK.repeat(1100) },
  { name: "60KB, escapes", input: "my%20file%20(1)%20%C3%A9%2Bcopy%26x%3D1.jpg%20".repeat(1400) },
];

const unescapeInputs = [
  { name: "6 chars, passthrough", input: "photos" },
  { name: "26 chars, 7 escapes", input: "my%20file%20%281%29%20%E9+copy%26x%3D1.jpg" },
  { name: "60KB, escapes", input: "my%20file%20%281%29%20%E9+copy%26x%3D1.jpg%20".repeat(1400) },
];

const cases = [
  [encodeURIComponent, encodeInputs],
  [encodeURI, encodeInputs],
  [escape, encodeInputs],
  [decodeURIComponent, decodeInputs],
  [decodeURI, decodeInputs],
  [unescape, unescapeInputs],
];

for (const [fn, inputs] of cases) {
  for (const { name, input } of inputs) {
    group(`${fn.name}: ${name}`, () => {
      bench("8-bit", () => fn(input));
      const wide = sixteenBit(input);
      bench("16-bit", () => fn(wide));
    });
  }
}

await run();
