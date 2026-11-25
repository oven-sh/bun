// The program queues ticks and never names node:async_hooks. A file that it writes and loads at run time enables a hook that hears of every tick.
// Flags: --aot-allow-code-from-disk
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// The compiler can't see text that is decoded at run time.
const decoded = text => Buffer.from(text).toString();

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "code-beside-ticks-"));
const file = path.join(folder, "hooks.cjs");
fs.writeFileSync(
  file,
  `
const { createHook } = require("node:async_hooks");
const heard = [];
const hook = createHook({
  init(id, type) {
    if (type === "TickObject") heard.push(type);
  },
});
module.exports = { begin: () => hook.enable(), end: () => (hook.disable(), heard.length) };
`,
);

function tick(...operands) {
  return new Promise(resolve => process.nextTick((...given) => resolve(given.join(",")), ...operands));
}

async function main() {
  console.log("before", await tick(), await tick(1), await tick(1, 2, 3, 4, 5));
  const hooks = require(decoded(file));
  hooks.begin();
  console.log("hooked", await tick(), await tick(1), await tick(1, 2), await tick(1, 2, 3), await tick(1, 2, 3, 4));
  console.log("heard of", hooks.end());
  console.log("after", await tick(7));
  fs.rmSync(folder, { recursive: true });
}
main();
