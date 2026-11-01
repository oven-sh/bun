// Three exports of built-in modules of which the table of built-ins says only that they let in code nobody has seen: bound by name, and read in every place a binding is read in.
import { getProtectedObjects } from "bun:jsc";
import { _extensions, _load, runMain } from "node:module";

function kindOfRunMain() { return typeof runMain; }
function nameOfRunMain() { return runMain?.name; }
function lengthOfRunMain() { if (typeof runMain === "function") return runMain.length; return "no function"; }
console.log("runMain in a function:", kindOfRunMain(), nameOfRunMain(), lengthOfRunMain());

function kindOfEnumerator() { return typeof getProtectedObjects; }
function nameOfEnumerator() { return getProtectedObjects?.name; }
function lengthOfEnumerator() { if (typeof getProtectedObjects === "function") return getProtectedObjects.length; return "no function"; }
console.log("getProtectedObjects in a function:", kindOfEnumerator(), nameOfEnumerator(), lengthOfEnumerator());

function kindOfExtensions() { return typeof _extensions; }
function keysOfExtensions() { if (typeof _extensions === "object") return Object.keys(_extensions).includes(".js"); return "no object"; }
console.log("_extensions in a function:", kindOfExtensions(), keysOfExtensions());

function lengthOfLoad() { if (typeof _load === "function") return _load.length; return "no function"; }
console.log("_load in a function:", lengthOfLoad());

for (const [name, read] of Object.entries({ runMain: () => runMain, getProtectedObjects: () => getProtectedObjects, _extensions: () => _extensions, _load: () => _load })) {
  const list = [read()];
  let written;
  written = read();
  const map = new Map([["key", read()]]);
  const object = { held: read() };
  console.log(name, "handed on:", typeof list[0], typeof written, typeof map.get("key"), typeof object.held, list[0] === object.held);
}

const listOfRunMain = [runMain];
const mapOfRunMain = new Map([["key", runMain]]);
console.log("runMain at top level:", typeof runMain, typeof listOfRunMain[0], typeof mapOfRunMain.get("key"), { run: runMain }.run === runMain);
const listOfExtensions = [_extensions];
const mapOfExtensions = new Map([["key", _extensions]]);
console.log("_extensions at top level:", typeof _extensions, typeof listOfExtensions[0], typeof mapOfExtensions.get("key"), { held: _extensions }.held === _extensions);
const listOfEnumerator = [getProtectedObjects];
console.log("getProtectedObjects at top level:", typeof getProtectedObjects, typeof listOfEnumerator[0]);

class Holder {
  run = runMain;
  enumerate = getProtectedObjects;
  extensions = _extensions;
  load = _load;
}
const holder = new Holder();
console.log("initializers of fields:", typeof holder.run, typeof holder.enumerate, typeof holder.extensions, typeof holder.load);
console.log("called:", Array.isArray(getProtectedObjects()));
