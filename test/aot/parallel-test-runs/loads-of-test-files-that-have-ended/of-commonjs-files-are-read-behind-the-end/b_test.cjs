const { afterAll, test, vi } = require("bun:test");
const { load, say, turn } = require("./count.cjs");
const count = require("./count.cjs");

exports.name = "b";
const readers = (globalThis.readers ??= []);
const own = module;
const read = () => `${load} ${turn()} ${count.load} ${say()} ${exports.name} ${module.exports.name} ${module === own} ${typeof require}`;
readers.push(read);
function* steps() {
  for (;;) yield read();
}
const step = steps();
step.next();
readers.push(() => step.next().value);
readers.push(() => ((q) => [1].map(() => q + read()).join())("q "));
afterAll(() => console.log("b ends", read()));

test("b", async () => {
  for (const each of readers) console.log("b", await each());
  vi.resetModules();
  Bun.gc(true);
  console.log("b behind the reset", read(), require("./count.cjs").load);
});
