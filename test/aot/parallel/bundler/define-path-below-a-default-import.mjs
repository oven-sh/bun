// A `--define` whose value is a dotted path reads a member of the default import of "node:crypto" that has its first name.
// Flags: --define HASH=crypto.createHash
import crypto from "node:crypto";
console.log(typeof HASH);
