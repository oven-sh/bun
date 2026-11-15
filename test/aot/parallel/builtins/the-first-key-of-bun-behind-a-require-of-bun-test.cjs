// `bun run` answers require("bun:test") by a call of Bun.jest, so that member is the first that Bun lists behind a copy.
const { expect } = require("bun:test");
const { ...copy } = Bun;
console.log(typeof expect, typeof copy.jest, Reflect.ownKeys(Bun)[0]);
process.exit(0);
