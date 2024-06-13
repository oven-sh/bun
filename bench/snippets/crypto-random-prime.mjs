// so it can run in environments without node module resolution
import { bench, run } from "./runner.mjs";

import { promisify } from "node:util";

import crypto from "node:crypto";

bench("crypto.generatePrimeSync(1024)", () => {
  crypto.generatePrimeSync(1024);
});

const generatePrime = promisify(crypto.generatePrime);

bench("crypto.generatePrimeSync(1024)", async () => {
  await generatePrime(1024);
});

await run();
