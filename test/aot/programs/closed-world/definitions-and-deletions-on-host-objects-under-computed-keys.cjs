// closed-world/stores-into-host-objects-under-computed-keys for the two changes that look for the property first: the host makes the value of a member when it is first looked for,
// and a deletion that finds a member makes every other member of the object too.
const print = console.log;
function attempt(label, action) {
  try { print(label + ": " + action()); } catch (error) { print(label + ": " + error.name + (error.code ? " " + error.code : "")); }
}
const names = JSON.parse(process.argv[2] ?? `["config", "features", "release", "versions", "allowedNodeEnvironmentFlags", "aNameOfMyOwn"]`);
for (const name of names) attempt("define process." + name, () => { Object.defineProperty(process, name, { value: "mine", configurable: true, writable: true, enumerable: true }); return "defined"; });
attempt("what a read that names the member finds", () => [process.config, process.release, process.aNameOfMyOwn].join(" "));
for (const name of names) attempt("delete process." + name, () => delete process[name]);
attempt("after the deletions", () => [typeof process.config, typeof process.release, typeof process.aNameOfMyOwn].join(" "));
attempt("the members that a deletion made", () => [typeof process.platform, typeof process.pid, typeof process.arch].join(" "));
