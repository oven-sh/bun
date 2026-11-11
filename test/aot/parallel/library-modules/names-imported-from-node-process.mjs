// As a-name-imported-from-bun-jsc.mjs. One of the names is a loader, which is called under a name made at run time.
import { argv, getBuiltinModule, platform } from "node:process";
console.log(Array.isArray(argv), typeof platform, typeof getBuiltinModule(["node", "path"].join(":")).join);
