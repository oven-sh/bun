// https://github.com/oven-sh/bun/issues/45699
// One-shot digests of short strings, by algorithm name.
import crypto from "node:crypto";
import { bench, run } from "../runner.mjs";

const short = "AWS4-HMAC-SHA256/20261016/us-east-1/s3/aws4_request"; // 51 bytes
const long =
  "GET\n/photos/2026/cat.jpg\n\nhost:my-bucket.s3.us-east-1.amazonaws.com\nx-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nx-amz-date:20261016T220000Z\n\nhost;x-amz-content-sha256;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // 284 bytes
const shortBuffer = Buffer.from(short);

bench("crypto.hash(sha256, 51 B string, hex)", () => crypto.hash("sha256", short, "hex"));
bench("crypto.hash(sha256, 284 B string, hex)", () => crypto.hash("sha256", long, "hex"));
bench("crypto.hash(sha256, 51 B buffer, hex)", () => crypto.hash("sha256", shortBuffer, "hex"));
bench("crypto.hash(md5, 51 B string, hex)", () => crypto.hash("md5", short, "hex"));
bench("crypto.hash(shake128, 51 B string, hex)", () => crypto.hash("shake128", short, "hex"));
bench("createHash(sha256).update(51 B string).digest(hex)", () =>
  crypto.createHash("sha256").update(short).digest("hex"),
);

if ("Bun" in globalThis) {
  bench("Bun.CryptoHasher.hash(sha256, 51 B string, hex)", () => Bun.CryptoHasher.hash("sha256", short, "hex"));
  bench("Bun.SHA256.hash(51 B string, hex)", () => Bun.SHA256.hash(short, "hex"));
  bench("new Bun.CryptoHasher(sha256).update(51 B string).digest(hex)", () =>
    new Bun.CryptoHasher("sha256").update(short).digest("hex"),
  );
  bench("new Bun.CryptoHasher(shake128)", () => new Bun.CryptoHasher("shake128"));
}

await run();
