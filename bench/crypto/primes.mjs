import { checkPrime, checkPrimeSync, generatePrime, generatePrimeSync } from "node:crypto";
import { bench, run } from "../runner.mjs";

const prime512 = generatePrimeSync(512);
const prime2048 = generatePrimeSync(2048);

bench("checkPrimeSync 512", () => {
  return checkPrimeSync(prime512);
});

bench("checkPrimeSync 2048", () => {
  return checkPrimeSync(prime2048);
});

bench("checkPrime 512", async () => {
  const promises = Array.from({ length: 10 }, () => new Promise(resolve => checkPrime(prime512, resolve)));
  await Promise.all(promises);
});

bench("checkPrime 2048", async () => {
  const promises = Array.from({ length: 10 }, () => new Promise(resolve => checkPrime(prime2048, resolve)));
  await Promise.all(promises);
});

bench("generatePrimeSync 512", () => {
  return generatePrimeSync(512);
});

bench("generatePrimeSync 2048", () => {
  return generatePrimeSync(2048);
});

bench("generatePrime 512", async () => {
  const promises = Array.from({ length: 10 }, () => new Promise(resolve => generatePrime(512, resolve)));
  await Promise.all(promises);
});

bench("generatePrime 2048", async () => {
  const promises = Array.from({ length: 10 }, () => new Promise(resolve => generatePrime(2048, resolve)));
  await Promise.all(promises);
});

await run();
