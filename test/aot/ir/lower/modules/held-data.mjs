// require() answers the namespace object of a file of data once an import has loaded the file, and its value until then. Where both name the file, the run time says which,
// and the namespace object has every key. A file that only one of them names has one answer. A file that stands for a string answers `{ default }`, held or not.
// RUN(BOTH): link
// BOTH: module {{*}}both.json" kind=Data requireResult=NamespaceIfImported {{*}}exports=[{name="a" variable=[[a]]}, {name="default"
// RUN(CALL): link
// CALL: module {{*}}later.toml" kind=Data requireResult=NamespaceIfImported
// RUN(TEXT): link
// TEXT: module {{*}}note.txt" kind=Data body=
// RUN(IMPORTED): link
// IMPORTED: module {{*}}imported.json" kind=Data requireResult=DefaultExport {{*}}exports=[{name="default"
// RUN(REQUIRED): link
// REQUIRED: module {{*}}required.json" kind=Data requireResult=DefaultExport {{*}}exports=[{name="default"

// FILE: main.mjs
import both from "./both.json";
import imported from "./imported.json";
import note from "./note.txt";
export const all = [both, imported, note, require("./both.json"), require("./required.json"), require("./note.txt")];
export const later = () => [import("./later.toml"), require("./later.toml")];

// FILE: both.json
{ "a": 1 }

// FILE: imported.json
{ "a": 1 }

// FILE: required.json
{ "a": 1 }

// FILE: later.toml
a = 1

// FILE: note.txt
text
