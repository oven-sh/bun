// Every key that Object.keys(require.cache) lists can be read.
const lib: { greet(): string } = require("./lib.ts");
console.log(lib.greet());
const cache = require.cache as Record<string, unknown>;
let failedReads = 0;
for (const key of Object.keys(cache)) {
  try {
    void cache[key];
  } catch {
    failedReads++;
  }
}
console.log("failed reads:", failedReads);
