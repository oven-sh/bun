// node:fs is loaded at the link, before any body of the graph: the first tick that a file in front of the import of node:fs asks for runs behind the promise jobs.
import { order } from "./first.mjs";
import fs from "node:fs";
console.log((await order).join(", "));
