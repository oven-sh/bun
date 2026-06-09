// so it can run in environments without node module resolution
import { bench, run } from "../runner.mjs";

const pw = "correct horse battery staple";
const argonHash = await Bun.password.hash(pw); // argon2id defaults
const bcryptHash = await Bun.password.hash(pw, { algorithm: "bcrypt", cost: 4 });

bench("password.hashSync argon2id (pure compute)", () => Bun.password.hashSync(pw));
bench("password.hash argon2id", async () => await Bun.password.hash(pw));
bench("password.verify argon2id", async () => await Bun.password.verify(pw, argonHash));
bench("password.hash bcrypt cost=4", async () => await Bun.password.hash(pw, { algorithm: "bcrypt", cost: 4 }));
bench("password.verify bcrypt cost=4", async () => await Bun.password.verify(pw, bcryptHash));
bench("password.hash argon2id x8 concurrent", async () => {
  await Promise.all(Array.from({ length: 8 }, () => Bun.password.hash(pw)));
});

bench("password.hash argon2id x32 concurrent", async () => {
  await Promise.all(Array.from({ length: 32 }, () => Bun.password.hash(pw)));
});

// Promise stacking: N pending password promises in flight at once, settled
// together. bcrypt cost=4 keeps per-op compute small (~0.67 ms) so queue,
// wake, and completion machinery dominate as N grows.
for (const n of [8, 32, 128, 512]) {
  bench(`bcrypt x${n} Promise.all`, async () => {
    await Promise.all(
      Array.from({ length: n }, () => Bun.password.hash(pw, { algorithm: "bcrypt", cost: 4 })),
    );
  });
}

await run();
