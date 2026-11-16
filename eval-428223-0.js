process.argv.splice(1, 1);const { expect } = require("bun:test");
// 540M "\u00e9" chars = 1.08e9 UTF-8 bytes, just past the 2^30 cap.
const big = Buffer.alloc(540_000_000, 0xe9).toString("latin1");
expect.extend({ hugeFailureMessage() { return { pass: false, message: () => big }; } });
let caught;
try { expect(1).hugeFailureMessage(); } catch (e) { caught = e; }
// Never print caught.message: it is over a gigabyte.
console.log(JSON.stringify({
  type: typeof caught?.message,
  hasPrefix: caught?.message.includes(big.slice(0, 64)),
  length: caught?.message.length,
}));