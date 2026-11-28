import "./first.mjs";
import zlib from "node:zlib";
import { nope } from "node:os";
console.log("bad.mjs runs", typeof zlib, typeof nope);
