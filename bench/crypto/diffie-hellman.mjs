import crypto from "node:crypto";
import { bench, run } from "../runner.mjs";

// Pre-generate DH params to avoid including setup in benchmarks
const dhSize = 1024; // Reduced from 2048 for faster testing
const dh = crypto.createDiffieHellman(dhSize);
const dhPrime = dh.getPrime();
const dhGenerator = dh.getGenerator();

// Classical Diffie-Hellman
bench("DH - generateKeys", () => {
  const alice = crypto.createDiffieHellman(dhPrime, dhGenerator);
  return alice.generateKeys();
});

bench("DH - computeSecret", () => {
  // Setup
  const alice = crypto.createDiffieHellman(dhPrime, dhGenerator);
  const aliceKey = alice.generateKeys();
  const bob = crypto.createDiffieHellman(dhPrime, dhGenerator);
  const bobKey = bob.generateKeys();

  // Benchmark just the secret computation
  return alice.computeSecret(bobKey);
});

// ECDH with prime256v1 (P-256)
bench("ECDH-P256 - generateKeys", () => {
  const ecdh = crypto.createECDH("prime256v1");
  return ecdh.generateKeys();
});

bench("ECDH-P256 - computeSecret", () => {
  // Setup
  const alice = crypto.createECDH("prime256v1");
  const aliceKey = alice.generateKeys();
  const bob = crypto.createECDH("prime256v1");
  const bobKey = bob.generateKeys();

  // Benchmark just the secret computation
  return alice.computeSecret(bobKey);
});

// ECDH with secp384r1 (P-384)
bench("ECDH-P384 - computeSecret", () => {
  const alice = crypto.createECDH("secp384r1");
  const aliceKey = alice.generateKeys();
  const bob = crypto.createECDH("secp384r1");
  const bobKey = bob.generateKeys();
  return alice.computeSecret(bobKey);
});

await run();
