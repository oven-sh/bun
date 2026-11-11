// The build keeps no variable for a name of a file of data that no written import reads. The name keeps a row: it names the variable of `default` and says that it was left out, so the run time lists it and hands nothing out under it.
// A file of which compiled code takes the namespace, or reads every name, has no such row.
// RUN(SHORT): link
// SHORT: module {{*}}short.json" kind=Data {{*}}exports=[{name="a" variable=[[a]]}, {name="b" variable=[[whole]] isOmitted=true}, {name="default" variable=[[whole]]}]
// RUN(WHOLE): link
// WHOLE: module {{*}}whole.json" kind=Data {{*}}exports=[{name="a" variable=[[a]]}, {name="b" variable=[[b]]}, {name="default" variable=[[whole]]}]
// RUN(READ): link
// READ: module {{*}}read.json" kind=Data {{*}}exports=[{name="a" variable=[[a]]}, {name="b" variable=[[b]]}, {name="default" variable=[[whole]]}]

// FILE: main.mjs
import { a } from "./short.json";
import * as whole from "./whole.json";
import { a as first, b as second } from "./read.json";
export const all = [a, whole, first, second];

// FILE: short.json
{ "a": 1, "b": 2 }

// FILE: whole.json
{ "a": 1, "b": 2 }

// FILE: read.json
{ "a": 1, "b": 2 }
