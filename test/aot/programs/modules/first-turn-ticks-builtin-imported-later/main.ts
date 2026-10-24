// The module that schedules is evaluated ahead of the one that imports node:fs. Both belong to one graph, whose builtin modules are all loaded before any of it is evaluated.
import "./schedules.ts";
import { kind } from "./imports-builtin.ts";
console.log(kind);
