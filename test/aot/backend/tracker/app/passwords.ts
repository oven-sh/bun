import { pbkdf2, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(pbkdf2);

/** PBKDF2-HMAC-SHA256, 100,000 rounds. */
export async function passwordMatches(password: string, salt: string, hash: string): Promise<boolean> {
  const derived = await derive(password, salt, 100_000, 32, "sha256");
  const expected = Buffer.from(hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
