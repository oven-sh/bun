// A store under a key that is computed at run time replaces a member of a host object. It runs none of the code that would make the member's value, so that code need not be in the executable.
// A definition and a deletion look for the property first, which makes the value, so they need it.
const print = console.log;
function attempt(label, action) {
  try { print(label + ": " + action()); } catch (error) { print(label + ": " + error.name + (error.code ? " " + error.code : "")); }
}
const lists = JSON.parse(process.argv[2] ?? `{
  "stored": ["allowedNodeEnvironmentFlags", "channel", "config", "features", "finalization", "report", "stdin", "binding", "openStdin", "send", "disconnect", "hrtime", "memoryUsage", "pid", "arch", "aNameOfMyOwn"],
  "refused": ["exitCode", "debugPort"],
  "ofConsole": ["table", "Console", "aNameOfMyOwn"]
}`);
for (const name of lists.stored) attempt("process." + name, () => { process[name] = "mine"; return "stored"; });
for (const name of lists.refused) attempt("process." + name, () => { process[name] = "mine"; return "stored"; });
for (const name of lists.ofConsole) attempt("console." + name, () => { console[name] = "mine"; return "stored"; });
attempt("in strict code", () => { "use strict"; for (const name of lists.stored) process[name] = "mine again"; return "stored"; });
attempt("what a read that names the member finds", () => [process.report, process.config, process.pid, process.aNameOfMyOwn, console.aNameOfMyOwn, console.table].join(" "));
attempt("a member that nothing was stored to", () => [typeof process.platform, typeof process.cwd(), typeof process.title].join(" "));
attempt("Reflect.set", () => lists.stored.map(name => Reflect.set(process, name, "by Reflect")).join(" "));
attempt("after Reflect.set", () => process.report);
