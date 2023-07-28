import { bench, run } from "./runner.mjs";
import { Buffer } from "node:buffer";

const bigBuffer = Buffer.from("hello world".repeat(10000));
const converted = bigBuffer.toString("base64");
bench("Buffer.toString('base64')", () => {
  return bigBuffer.toString("base64");
});

// bench("Buffer.from(str, 'base64')", () => {
//   return Buffer.from(converted, "base64");
// });

await run();
