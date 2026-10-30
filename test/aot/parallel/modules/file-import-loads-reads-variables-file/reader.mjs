import * as all from "./waiting.mjs";
import {
  Kind,
  call,
  changing,
  count,
  fixed,
  flag,
  fraction,
  half,
  list,
  never,
  readChanging,
  record,
  text,
  truth,
} from "./waiting.mjs";
const names = [
  "count",
  "fraction",
  "flag",
  "text",
  "record",
  "never",
  "changing",
  "half",
  "truth",
  "fixed",
  "list",
  "Kind",
  "call",
  "readChanging",
];
function show(where, name, read) {
  try {
    const value = read();
    console.log(where, name, typeof value, typeof value === "function" ? "" : JSON.stringify(value));
  } catch (error) {
    console.log(where, name, error.name);
  }
}
show("name", "count", () => count + 1);
show("name", "fraction", () => fraction + 1);
show("name", "flag", () => flag);
show("name", "text", () => text);
show("name", "record", () => record);
show("name", "never", () => never);
show("name", "changing", () => changing + 1);
show("name", "half", () => half + 1);
show("name", "truth", () => truth);
show("name", "fixed", () => fixed + 1);
show("name", "list", () => list);
show("name", "Kind", () => Kind.z);
show("name", "call", () => call());
show("name", "readChanging", () => readChanging());
for (const name of names) show("key", name, () => all[name]);
setTimeout(() => {
  for (const name of names) show("later", name, () => all[name]);
  show("later", "Kind.z", () => Kind.z);
  show("later", "Kind.late", () => Kind.late);
  show("later", "call", () => call() + readChanging());
}, 1);
