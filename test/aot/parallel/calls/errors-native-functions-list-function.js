// An error that a native function without a receiver makes lists that function first in its stack.
import dns from "node:dns";

function namesIn(error) {
  const names = String(error.stack)
    .split("\n")
    .slice(1, 4)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*$/, ""));
  return names.map(name => (/[\\/:]/.test(name) ? "<file>" : name)).join(" < ");
}

function attempt(name, run) {
  try {
    run();
    console.log(name + ": returned");
  } catch (error) {
    console.log(name + ": " + error.name + " " + (error.code ?? "") + " | " + namesIn(error));
  }
}

for (let turn = 0; turn < 3; turn++) {
  attempt("sleepSync", () => Bun.sleepSync(-1));
  attempt("sleepSync of a text", () => Bun.sleepSync("soon"));
  attempt("nanoseconds", () => Bun.nanoseconds());
  attempt("atob", () => atob("***"));
  attempt("btoa", () => btoa("Ā"));
  attempt("structuredClone", () => structuredClone(() => {}));
  attempt("fileURLToPath", () => Bun.fileURLToPath("http://example.com/"));
  attempt("pathToFileURL", () => Bun.pathToFileURL());
  attempt("gunzipSync", () => Bun.gunzipSync(new Uint8Array([0xff, 0xfe])));
  attempt("inflateSync", () => Bun.inflateSync(new Uint8Array([0xff, 0xfe])));
  attempt("queueMicrotask", () => queueMicrotask(1));
  attempt("setTimeout", () => setTimeout());
  attempt("randomUUIDv7", () => Bun.randomUUIDv7("no-such-encoding"));
  attempt("getRandomValues", () => crypto.getRandomValues(1));
  attempt("chdir", () => process.chdir("/nonexistent-directory/entry"));
  // Signal 0 only asks whether the process is there.
  attempt("kill", () => process.kill("nobody", 0));
  attempt("hrtime", () => process.hrtime(1));
  attempt("Buffer.alloc", () => Buffer.alloc(-1));
  attempt("Buffer.byteLength", () => Buffer.byteLength(1));
  attempt("setJITPolicy", () => Bun.unsafe.setJITPolicy(-1));
  attempt("setJITPolicy of NaN", () => Bun.unsafe.setJITPolicy(NaN));
  attempt("lookupService", () => dns.lookupService("not an address", 80, () => {}));
  attempt("Response.json", () => Response.json(1n));
  attempt("Response.redirect", () => Response.redirect("http://example.com/", 200));
  attempt("indexOfLine", () => Bun.indexOfLine(1, 2.5));
}
