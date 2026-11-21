import "./first.mjs";
import zlib from "node:zlib";
import { EOL } from "node:os";
console.log("good.mjs runs", typeof zlib.gzipSync, JSON.stringify(EOL));
