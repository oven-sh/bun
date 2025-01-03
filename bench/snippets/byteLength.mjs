import { Buffer } from "node:buffer";
import { bench, run } from "../runner.mjs";

const variations = [
  ["latin1", "hello world"],
  ["utf16", "hello emoji 🤔"],
];

for (const [label, string] of variations) {
  const big = Buffer.alloc(1000000, string).toString();
  const small = Buffer.from(string).toString();
  const substring = big.slice(0, big.length - 2);

  bench(`${substring.length}`, () => {
    return Buffer.byteLength(substring, "utf8");
  });

  bench(`${small.length}`, () => {
    return Buffer.byteLength(small);
  });

  bench(`${big.length}`, () => {
    return Buffer.byteLength(big);
  });
}

await run();
