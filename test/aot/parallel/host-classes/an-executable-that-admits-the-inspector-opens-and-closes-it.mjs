// Flags: --compile-inspector
// The inspector opens on a port that the system picks, takes commands of a session for the debugger and closes: only the kinds are printed.
import inspector from "node:inspector";
// The line that open() writes names the port.
const written = [];
const write = process.stderr.write;
process.stderr.write = text => (written.push(text), true);
const opened = inspector.open(0, "127.0.0.1");
process.stderr.write = write;
console.log(written.length, /^Debugger listening on ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+\n$/.test(written[0]));
console.log(typeof opened, typeof inspector.url(), inspector.url().startsWith("ws://127.0.0.1:"), process.debugPort > 0);
const session = new inspector.Session();
session.connect();
const post = (method, params) =>
  new Promise(done => session.post(method, params, (error, result) => done(error ? "refused: " + error.code : JSON.stringify(result))));
console.log(await post("Debugger.setSkipAllPauses", { skip: true }), await post("Debugger.setBreakpointsActive", { active: false }));
session.disconnect();
try { inspector.open(0, "127.0.0.1"); } catch (error) { console.log(error.code); }
console.log(inspector.close(), inspector.url(), inspector.close());
process.exit(0);
