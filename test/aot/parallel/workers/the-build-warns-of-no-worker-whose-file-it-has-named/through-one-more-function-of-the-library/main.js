// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// Each name goes through one more function of the library on its way to the constructor. The load reads what that function answers with, from the folder of the file that writes the name.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { starts } from "./below/starts.js";
for (const [how, start] of starts) {
  const worker = await start();
  const answer = await new Promise(done => {
    worker.onmessage = event => done(event.data);
    worker.on?.("message", done);
    worker.onerror = event => (event.preventDefault?.(), done("error"));
    worker.on?.("error", () => done("error"));
  });
  console.log(how + ": " + answer);
  await worker.terminate();
}
