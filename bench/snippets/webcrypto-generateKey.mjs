import { bench, group, run } from "../runner.mjs";

const algorithms = [
  ["ECDSA P-256", { name: "ECDSA", namedCurve: "P-256" }, ["sign", "verify"]],
  ["ECDSA P-384", { name: "ECDSA", namedCurve: "P-384" }, ["sign", "verify"]],
  ["ECDSA P-521", { name: "ECDSA", namedCurve: "P-521" }, ["sign", "verify"]],
  [
    "RSA-PSS 2048",
    { name: "RSA-PSS", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    ["sign", "verify"],
  ],
];

for (const [name, params, usages] of algorithms) {
  group(name, () => {
    bench(`${name} sequential`, async () => {
      await crypto.subtle.generateKey(params, true, usages);
    });
    bench(`${name} Promise.all(16)`, async () => {
      await Promise.all(Array.from({ length: 16 }, () => crypto.subtle.generateKey(params, true, usages)));
    });
  });
}

await run();
