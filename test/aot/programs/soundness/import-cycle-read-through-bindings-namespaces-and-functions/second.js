import { log, attempt } from "./log.js";
import def, { hoisted, scoped, fixed, Kind, declared, readsScoped, changed, change, renamed } from "./first.js";
import * as all from "./first.js";
import * as again from "./again.js";
function direct() { const t = hoisted; return t === undefined ? "missing" : t + 1; }
function viaNamespace() { const t = all.hoisted; return t === undefined ? "missing" : t + 1; }
function viaRenamed() { const t = renamed; return t === undefined ? "missing" : t + 1; }
function viaReexport() { const t = again.hoisted; return t === undefined ? "missing" : t + 1; }
function viaKey(k) { const t = all[k]; return t === undefined ? "missing" : t + 1; }
var lateKey; const table = { a: () => "early", undefined: () => { const t = hoisted; return t === undefined ? "missing" : t + 1; } };
function report(when) {
  log.push(when + " direct " + direct());
  log.push(when + " namespace " + viaNamespace());
  log.push(when + " renamed " + viaRenamed());
  log.push(when + " reexport " + viaReexport());
  log.push(when + " key " + viaKey("hoisted"));
  log.push(when + " declared " + declared());
  log.push(when + " scoped " + attempt(() => scoped + 1));
  log.push(when + " scoped in first " + attempt(readsScoped));
  log.push(when + " scoped namespace " + attempt(() => all.scoped + 1));
  log.push(when + " fixed " + attempt(() => fixed + 1));
  log.push(when + " default " + attempt(def));
  log.push(when + " class " + attempt(() => Kind.n + 1));
  log.push(when + " keys " + attempt(() => Object.keys(all).join()));
  log.push(when + " in " + ("scoped" in all));
  log.push(when + " values " + attempt(() => Object.values(all).length));
  log.push(when + " late " + table[lateKey]());
  log.push(when + " changed " + attempt(() => changed + 1));
}
report("before");
var lateKey = "a";
export function after() { report("after"); change(); log.push("changed " + (changed + 1) + " " + (all.changed + 1)); }
