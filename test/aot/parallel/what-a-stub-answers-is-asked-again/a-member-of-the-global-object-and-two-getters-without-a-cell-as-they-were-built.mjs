// Flags: --aot-testing=CheckWalkAtRunTime
// The library asks whether globalThis.AbortController, abort(), the getter of signal and the getter of aborted are as built. The program writes each of them at its end, so each is asked
// by its byte while the program runs, and under the word that checks the walk every yes is held to the object: the member of globalThis to the global object itself, the two getters, which
// no cell names, to what the host has laid.
// COUNTER: FastPathResultsVerified >= 4
import "node:http";
import { pipeline, Readable, Writable } from "node:stream";
const run = () =>
  new Promise(done =>
    pipeline(
      Readable.from(["made", "up"]),
      new Writable({
        write(chunk, encoding, written) {
          written();
        },
      }),
      error => done(error ? error.name : "ended"),
    ),
  );
for (let round = 0; round < 3; round++) console.log(await run());
const Usual = AbortController;
const signal = Object.getOwnPropertyDescriptor(Usual.prototype, "signal");
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted");
let asked = 0;
globalThis.AbortController = class extends Usual {};
console.log(await run());
globalThis.AbortController = Usual;
Object.defineProperty(Usual.prototype, "signal", {
  configurable: true,
  get() {
    asked++;
    return signal.get.call(this);
  },
});
console.log(await run(), asked);
Object.defineProperty(AbortSignal.prototype, "aborted", {
  configurable: true,
  get() {
    asked++;
    return aborted.get.call(this);
  },
});
console.log(await run(), asked);
