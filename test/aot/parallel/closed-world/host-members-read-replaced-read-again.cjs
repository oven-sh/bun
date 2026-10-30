// A member of a host object, or a global that holds one, is read, replaced and read again, in every way to replace it: by its name, under a computed key, through a receiver that the compiler
// cannot follow, by a definition, by a deletion, by Reflect.set, by Object.assign, from evaluated text. Every read behind a replacement finds the new value.
const print = console.log;
function attempt(label, action) {
  try { print(label + ": " + action()); } catch (error) { print(label + ": " + error.name + (error.code ? " " + error.code : "")); }
}
const words = JSON.parse(process.argv[2] ?? `{ "env": "env", "argv0": "argv0", "versions": "versions", "release": "release", "config": "config", "features": "features", "nextTick": "nextTick", "hrtime": "hrtime", "arch": "arch" }`);
const hidden = value => new Proxy({ value }, {}).value;
const kind = value => value === null ? "null" : typeof value === "object" || typeof value === "function" ? (value.mine ?? typeof value) : String(value);

function readEnv() { return kind(process.env); }
function readVersions() { return kind(process.versions); }
function readRelease() { return kind(process.release); }
function readConfig() { return kind(process.config); }
function readFeatures() { return kind(process.features); }
function readNextTick() { return kind(process.nextTick); }
function readHrtime() { return kind(process.hrtime); }
function readArgv0() { return typeof process.argv0; }

const realEnv = process.env, realNextTick = process.nextTick;
attempt("env, before", readEnv);
attempt("env, by its name", () => { process.env = { mine: "named" }; return readEnv(); });
attempt("env, under a computed key", () => { process[words.env] = { mine: "computed" }; return readEnv(); });
attempt("env, through a receiver nobody follows", () => { hidden(process)[words.env] = { mine: "hidden" }; return readEnv(); });
attempt("env, by a definition", () => { Object.defineProperty(process, words.env, { value: { mine: "defined" }, configurable: true, writable: true }); return readEnv(); });
attempt("env, by Reflect.set", () => { Reflect.set(process, words.env, { mine: "reflected" }); return readEnv(); });
attempt("env, by Object.assign", () => { Object.assign(process, JSON.parse(`{ "env": { "mine": "assigned" } }`)); return readEnv(); });
attempt("env, by a getter", () => { Object.defineProperty(process, "env", { get: () => ({ mine: "from a getter" }), configurable: true }); return readEnv(); });
attempt("env, deleted", () => { delete process[words.env]; return readEnv(); });
attempt("env, put back", () => { process.env = realEnv; return readEnv() + " " + (process.env === realEnv); });

attempt("versions, replaced before the first read, under a computed key", () => { process[words.versions] = { mine: "computed" }; return readVersions(); });
attempt("release, replaced before the first read, through a receiver nobody follows", () => { hidden(process)[words.release] = { mine: "hidden" }; return readRelease(); });
attempt("config, defined before the first read", () => { Object.defineProperty(hidden(process), words.config, { value: { mine: "defined" }, configurable: true }); return readConfig(); });
attempt("features, deleted before the first read", () => { delete hidden(process)[words.features]; return readFeatures(); });

attempt("nextTick, before", readNextTick);
attempt("nextTick, under a computed key", () => { const mine = () => {}; mine.mine = "computed"; process[words.nextTick] = mine; return readNextTick(); });
attempt("nextTick, put back", () => { process.nextTick = realNextTick; return readNextTick(); });
attempt("hrtime, in a loop that replaces it half way", () => {
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(readHrtime());
    if (i === 1) hidden(process)[words.hrtime] = { mine: "replaced in round " + i };
  }
  return seen.join(" | ");
});
attempt("argv0", readArgv0);
/* Output:
env, before: object
env, by its name: named
env, under a computed key: computed
env, through a receiver nobody follows: hidden
env, by a definition: defined
env, by Reflect.set: reflected
env, by Object.assign: assigned
env, by a getter: from a getter
env, deleted: undefined
env, put back: object true
versions, replaced before the first read, under a computed key: TypeError
release, replaced before the first read, through a receiver nobody follows: TypeError
config, defined before the first read: defined
features, deleted before the first read: undefined
nextTick, before: function
nextTick, under a computed key: computed
nextTick, put back: function
hrtime, in a loop that replaces it half way: function | function | replaced in round 1 | replaced in round 1
argv0: string
*/
