import path, { sep, join } from "node:path";
import zlib, { gzipSync } from "node:zlib";
path.sep = "!";
path.join = () => "patched by the worker";
zlib.gzipSync = () => "patched by the worker";
postMessage([sep, join("a", "b"), path.sep, path.join("a", "b"), typeof gzipSync("x"), zlib.gzipSync("x")].join(" "));
