import { afterAll, test, vi } from "bun:test";
import say, { load, turn, turns } from "./count.mjs";
import * as count from "./count.mjs";
import { mail } from "./mail.cjs";

const readers = (globalThis.readers ??= []);
const read = () => `${load} ${turn()} ${turns} ${count.load} ${count.turns} ${say()} ${mail()}`;
readers.push(read);
function* steps() {
  for (;;) yield read();
}
const step = steps();
step.next();
readers.push(() => step.next().value);
async function later(wait) {
  await wait;
  return read();
}
readers.push(() => later(1));
class Reader {
  static from = load;
  get now() {
    return read();
  }
}
readers.push(() => `${Reader.from} ${new Reader().now}`);
afterAll(() => console.log("c ends", read()));

test("c", async () => {
  for (const each of readers) console.log("c", await each());
  vi.resetModules();
  Bun.gc(true);
  console.log("c behind the reset", read(), (await import("./count.mjs")).load);
});
