// Methods of a host class are called one after another on the same instance, and the receiver is what a chainable method answers.
import { CryptoHasher, Glob, SHA256 } from "bun";

const mac = (data: string): string => new CryptoHasher("sha256", "k").update(data).digest("base64url");
console.log("mac", mac("x"), mac(""));

const hasher = new CryptoHasher("sha256");
const same = hasher.update("abc") === hasher && hasher.update(new Uint8Array([1, 2])) === hasher;
const copied = hasher.copy();
console.log("same", same, "byteLength", hasher.byteLength, copied.byteLength);

const into = new Uint8Array(64);
console.log("hex", hasher.digest("hex"));
console.log("copy into", copied.copy().digest(into) === into, Buffer.from(into.subarray(0, 32)).toString("hex"));
console.log("copy without output", Buffer.from(copied.digest()).toString("hex"));

const sha = new SHA256();
console.log("sha", sha.update("abc") === sha, sha.update("def").digest("base64"));

const glob = new Glob("*.ts");
console.log("glob", glob.match("a.ts"), glob.match("a.js"), glob.match("b.ts"));
