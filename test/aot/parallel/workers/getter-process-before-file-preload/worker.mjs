import * as all from "node:process";
import "./file.cjs";
log.push("the entry point " + typeof all.custom);
postMessage(log.join(", "));
