// Nothing names a function of node:path here. The object that holds them goes into native code and comes back as a value nobody knows,
// and its own values are read there: by Object.values, Object.entries, a spread and Object.assign. They have to be in the executable.
import * as path from "node:path";

function callAll(label, values) {
  const found = [];
  for (const value of values) {
    if (typeof value !== "function") continue;
    try {
      found.push(JSON.stringify(value("/some/where/file.txt")));
    } catch (error) {
      found.push(error.constructor.name);
    }
  }
  console.log(label, found.join(" "));
}

const target = new EventTarget();
target.addEventListener("values", event => callAll("values", Object.values(event.detail)));
target.addEventListener("entries", event => callAll("entries", Object.entries(event.detail).map(entry => entry[1])));
target.addEventListener("spread", event => {
  const copy = { ...event.detail };
  const values = [];
  for (const key in copy) values.push(copy[key]);
  callAll("spread", values);
});
target.addEventListener("assign", event => {
  const copy = Object.assign({}, event.detail);
  const values = [];
  for (const key in copy) values.push(copy[key]);
  callAll("assign", values);
});

for (const type of ["values", "entries", "spread", "assign"]) target.dispatchEvent(new CustomEvent(type, { detail: path.posix }));
